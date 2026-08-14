import { describe, expect, it } from 'vitest'
import { PresenceService } from '../src/presence-service.ts'

describe('PresenceService', () => {
  it('deduplicates tabs that share a cookie and expires inactive browsers', () => {
    const presence = new PresenceService(90_000)
    const startedAt = Date.parse('2026-08-14T00:00:00Z')
    const first = presence.heartbeat(undefined, '192.0.2.10', 'Mozilla/5.0', startedAt)

    expect(first).toMatchObject({ issued: true, online: 1, windowSeconds: 90 })
    expect(first.token).toEqual(expect.any(String))
    expect(presence.heartbeat(first.token, '192.0.2.10', 'Mozilla/5.0', startedAt + 30_000).online).toBe(1)
    expect(presence.heartbeat(first.token, '192.0.2.10', 'Mozilla/5.0', startedAt + 60_000).online).toBe(1)
    expect(presence.summary(startedAt + 149_999).online).toBe(1)
    expect(presence.summary(startedAt + 150_001).online).toBe(0)
  })

  it('filters bots, rate-limits anonymous token issuance and tracks the 24-hour peak', () => {
    const presence = new PresenceService(90_000, 60_000, 2)
    const startedAt = Date.parse('2026-08-14T00:00:00Z')

    expect(presence.heartbeat(undefined, '192.0.2.20', 'Googlebot', startedAt)).toMatchObject({ issued: false, online: 0 })
    expect(presence.heartbeat(undefined, '192.0.2.20', 'Browser A', startedAt).issued).toBe(true)
    expect(presence.heartbeat(undefined, '192.0.2.20', 'Browser B', startedAt + 1).issued).toBe(true)
    expect(presence.heartbeat(undefined, '192.0.2.20', 'Browser C', startedAt + 2)).toMatchObject({ issued: false, online: 2 })
    expect(presence.summary(startedAt + 90_003)).toMatchObject({ online: 0, peak24h: 2 })
    expect(presence.summary(startedAt + 24 * 60 * 60 * 1000 + 60_001).peak24h).toBe(0)
  })

  it('removes a browser immediately when it reports leaving', () => {
    const presence = new PresenceService()
    const heartbeat = presence.heartbeat(undefined, '192.0.2.30', 'Mozilla/5.0', 1_000)
    expect(presence.leave(heartbeat.token, 2_000)).toBe(0)
  })
})
