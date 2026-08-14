import { randomBytes } from 'node:crypto'

interface PresenceEntry {
  lastSeen: number
}

interface IssuanceWindow {
  count: number
  startedAt: number
}

export interface PresenceHeartbeat {
  token?: string
  issued: boolean
  online: number
  sampledAt: string
  windowSeconds: number
}

export class PresenceService {
  private readonly entries = new Map<string, PresenceEntry>()
  private readonly issuance = new Map<string, IssuanceWindow>()
  private readonly samples: Array<{ at: number; online: number }> = []

  constructor(
    private readonly activeWindowMs = 90_000,
    private readonly issuanceWindowMs = 60_000,
    private readonly issuanceLimit = 12,
  ) {}

  heartbeat(token: string | undefined, ip: string, userAgent = '', at = Date.now()): PresenceHeartbeat {
    this.prune(at)
    if (this.isBot(userAgent)) return this.result(undefined, false, at)

    let activeToken = token !== undefined && this.entries.has(token) ? token : undefined
    let issued = false
    if (activeToken === undefined && this.allowIssuance(ip, at)) {
      activeToken = randomBytes(24).toString('base64url')
      issued = true
    }
    if (activeToken !== undefined) this.entries.set(activeToken, { lastSeen: at })
    this.recordSample(at)
    return this.result(activeToken, issued, at)
  }

  leave(token: string | undefined, at = Date.now()): number {
    if (token !== undefined) this.entries.delete(token)
    this.prune(at)
    this.recordSample(at)
    return this.entries.size
  }

  summary(at = Date.now()) {
    this.prune(at)
    const since = at - 24 * 60 * 60 * 1000
    while (this.samples.length > 0 && this.samples[0]!.at < since) this.samples.shift()
    const peak24h = this.samples.reduce((peak, sample) => Math.max(peak, sample.online), this.entries.size)
    return {
      online: this.entries.size,
      peak24h,
      sampledAt: new Date(at).toISOString(),
      windowSeconds: Math.round(this.activeWindowMs / 1000),
    }
  }

  private result(token: string | undefined, issued: boolean, at: number): PresenceHeartbeat {
    return {
      ...(token === undefined ? {} : { token }), issued, online: this.entries.size,
      sampledAt: new Date(at).toISOString(), windowSeconds: Math.round(this.activeWindowMs / 1000),
    }
  }

  private prune(at: number): void {
    for (const [token, entry] of this.entries) if (at - entry.lastSeen > this.activeWindowMs) this.entries.delete(token)
    for (const [ip, window] of this.issuance) if (at - window.startedAt > this.issuanceWindowMs) this.issuance.delete(ip)
  }

  private allowIssuance(ip: string, at: number): boolean {
    const current = this.issuance.get(ip)
    if (current === undefined || at - current.startedAt >= this.issuanceWindowMs) {
      this.issuance.set(ip, { count: 1, startedAt: at })
      return true
    }
    current.count += 1
    return current.count <= this.issuanceLimit
  }

  private recordSample(at: number): void {
    const latest = this.samples.at(-1)
    if (latest !== undefined && at - latest.at < 60_000) {
      latest.online = Math.max(latest.online, this.entries.size)
      return
    }
    this.samples.push({ at, online: this.entries.size })
  }

  private isBot(userAgent: string): boolean {
    return /(?:bot|crawler|spider|slurp|headlesschrome|lighthouse|preview)/i.test(userAgent)
  }
}
