import type { AccountStore, SyncRun } from './auth-store.js'
import { fetchGitHubTopicDetailed, type Fetcher } from './github-catalog.js'

export class CatalogSyncService {
  private running = false

  constructor(
    private readonly store: AccountStore,
    private readonly githubToken?: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  recover(): void {
    for (const run of this.store.recoverableSyncRuns()) {
      this.store.updateSyncRun(run.id, { status: 'queued', error: 'RECOVERED_AFTER_RESTART' })
      this.schedule(run)
    }
  }

  create(actorId: string, retryOf?: string, context: { ip?: string; requestId?: string } = {}): SyncRun {
    const run = this.store.createSyncRun(actorId, retryOf, context)
    this.schedule(run)
    return run
  }

  private schedule(run: SyncRun): void {
    queueMicrotask(() => void this.execute(run))
  }

  private async execute(run: SyncRun): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      this.store.updateSyncRun(run.id, { status: 'discovering', startedAt: new Date().toISOString() })
      const result = await fetchGitHubTopicDetailed(this.githubToken, this.fetcher, progress => {
        this.store.updateSyncRun(run.id, {
          status: progress.phase,
          discovered: progress.discovered,
        })
      })
      await this.store.ingestVerifiedPlugins(run.actorId, result.plugins)
      for (const candidate of result.candidates) this.store.recordSyncCandidate(run.id, candidate)
      this.store.updateSyncRun(run.id, {
        status: result.failed > 0 ? 'partially_failed' : 'completed',
        discovered: result.discovered,
        verified: result.verified,
        rejected: result.rejected,
        failed: result.failed,
        ...(result.rateLimit.remaining === undefined ? {} : { githubRemaining: result.rateLimit.remaining }),
        ...(result.rateLimit.resetAt === undefined ? {} : { githubResetAt: result.rateLimit.resetAt }),
        finishedAt: new Date().toISOString(),
      })
    } catch (cause) {
      this.store.updateSyncRun(run.id, {
        status: 'failed',
        error: cause instanceof Error ? cause.message.slice(0, 500) : 'UNKNOWN_SYNC_FAILURE',
        finishedAt: new Date().toISOString(),
      })
    } finally {
      this.running = false
      const next = this.store.recoverableSyncRuns().find(candidate => candidate.id !== run.id)
      if (next !== undefined) this.schedule(next)
    }
  }
}
