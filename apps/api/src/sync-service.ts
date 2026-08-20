import type { AccountStore, SyncRun } from './auth-store.js'
import { fetchGitHubTopicDetailed, verifyExactGitHubRepositoryDetailed, type Fetcher, type RepositoryVerificationResult } from './github-catalog.js'

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

  async verifySubmission(actorId: string, repository: string): Promise<RepositoryVerificationResult> {
    if (this.running) throw new Error('SYNC_ALREADY_RUNNING')
    this.running = true
    try {
      const result = await verifyExactGitHubRepositoryDetailed(repository, this.githubToken, this.fetcher)
      if (result.status === 'verified') await this.store.ingestVerifiedPlugins(actorId, result.plugins)
      return result
    } finally {
      this.running = false
    }
  }

  private schedule(run: SyncRun): void {
    queueMicrotask(() => void this.execute(run))
  }

  private async execute(run: SyncRun): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      this.store.updateSyncRun(run.id, { status: 'discovering', startedAt: new Date().toISOString() })
      const retryRepositories = run.retryOf === undefined ? undefined : this.store.retryableSyncRepositories(run.retryOf)
      if (run.retryOf !== undefined && retryRepositories?.length === 0) throw new Error('SYNC_NOTHING_TO_RETRY')
      const result = await fetchGitHubTopicDetailed(this.githubToken, this.fetcher, progress => {
        this.store.updateSyncRun(run.id, {
          status: progress.phase,
          discovered: progress.discovered,
        })
      }, {
        ...(retryRepositories === undefined ? {} : { repositories: retryRepositories }),
        maxRepositories: this.githubToken === undefined ? 15 : 60,
      })
      await this.store.ingestVerifiedPlugins(run.actorId, result.plugins)
      for (const candidate of result.candidates) this.store.recordSyncCandidate(run.id, candidate)
      this.store.updateSyncRun(run.id, {
        status: result.failed > 0 || result.deferred > 0 ? 'partially_failed' : 'completed',
        discovered: result.discovered,
        verified: result.verified,
        rejected: result.rejected,
        failed: result.failed,
        deferred: result.deferred,
        bundlesFound: result.bundlesFound,
        githubAuthenticated: result.githubAuthenticated,
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
