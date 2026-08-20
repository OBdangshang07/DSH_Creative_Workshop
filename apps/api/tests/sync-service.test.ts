import { describe, expect, it } from 'vitest'
import { AccountStore, type GitHubPluginRecord } from '../src/auth-store.ts'
import type { Fetcher } from '../src/github-catalog.ts'
import { CatalogSyncService } from '../src/sync-service.ts'

const repository = (name: string) => ({
  name, full_name: `community/${name}`, description: `A DeepSeek Harness candidate repository named ${name}.`,
  html_url: `https://github.com/community/${name}`, stargazers_count: 3, forks_count: 0, language: 'TypeScript',
  updated_at: '2026-08-14T00:00:00Z', pushed_at: '2026-08-14T00:00:00Z', topics: ['dsh-plugin'],
  archived: false, fork: false, default_branch: 'main', owner: { login: 'community' },
})

const response = (body: unknown, status = 200, rateLimit = false) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get(name: string) { if (!rateLimit) return null; return name === 'x-ratelimit-remaining' ? '42' : name === 'x-ratelimit-reset' ? '1786665600' : null } },
  async json() { return body }, async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
})

async function terminalRun(store: AccountStore, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = store.syncRun(runId)
    if (run && ['completed', 'partially_failed', 'failed'].includes(run.status)) return run
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('SYNC_TEST_TIMEOUT')
}

describe('asynchronous catalog synchronization', () => {
  it('returns immediately, records candidate failures and preserves the public catalog', async () => {
    const store = new AccountStore()
    const existing: GitHubPluginRecord = {
      id: 'github.community.stable', fullName: 'community/stable', name: '@community/stable', packageName: '@community/stable', packagePath: '.',
      author: 'community', description: 'An existing public bundle that must survive partial synchronization failures.',
      url: 'https://github.com/community/stable', stars: 1, forks: 0, updatedAt: '2026-08-14T00:00:00Z', pushedAt: '2026-08-14T00:00:00Z',
      topics: ['dsh-plugin'], kind: 'bundle', surfaces: ['headless'], source: 'github-topic', securityReviewed: false,
      verification: { status: 'verified_bundle', commitSha: 'stable-sha', packageJsonPath: 'package.json', patchPath: 'patch.yml', checkedAt: '2026-08-14T00:00:00Z' },
    }
    await store.initialize(undefined, [existing])
    await store.moderatePlugin('system', existing.id, { status: 'approved' })

    const fetcher: Fetcher = async input => {
      const url = String(input)
      if (url.includes('/search/repositories')) return response({ total_count: 2, items: [repository('valid'), repository('broken')] }, 200, true)
      if (url.includes('/community/broken/commits/')) return response({}, 500)
      if (url.includes('/community/valid/commits/')) return response({ sha: 'valid-fixed-sha' })
      if (url.includes('/community/valid/git/trees/')) return response({ truncated: false, tree: [{ path: 'package.json', type: 'blob', size: 150 }, { path: 'patch.yml', type: 'blob', size: 80 }] })
      if (url.endsWith('/package.json')) return response(JSON.stringify({ name: '@community/valid', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }))
      if (url.endsWith('/patch.yml')) return response('- insert:\n    - id: valid\n      name: "@community/valid"\n')
      return response({}, 404)
    }

    const service = new CatalogSyncService(store, undefined, fetcher)
    const queued = service.create('admin', undefined, { requestId: 'async-sync' })
    expect(queued.status).toBe('queued')
    expect(() => service.create('admin')).toThrow('SYNC_ALREADY_RUNNING')
    const completed = await terminalRun(store, queued.id)
    expect(completed).toMatchObject({ status: 'partially_failed', discovered: 2, verified: 1, failed: 1, githubRemaining: 42 })
    expect(completed.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: 'community/valid', status: 'verified', bundleCount: 1 }),
      expect.objectContaining({ repository: 'community/broken', status: 'failed', reason: 'COMMIT_FETCH_500' }),
    ]))
    expect(store.githubSnapshot().items.map(plugin => plugin.id)).toEqual([existing.id])
    expect(store.githubSnapshot(true, { q: 'community/valid' }).items[0]).toMatchObject({ moderation: { status: 'pending' }, verification: { commitSha: 'valid-fixed-sha' } })
    store.close()
  })

  it('defers work to the available anonymous budget and retries only unfinished repositories', async () => {
    const store = new AccountStore()
    await store.initialize()
    const fetcher: Fetcher = async input => {
      const url = String(input)
      if (url.includes('/search/repositories')) return response({ total_count: 2, items: [repository('valid-a'), repository('valid-b')] }, 200, true)
      if (url === 'https://api.github.com/repos/community/valid-b') return response(repository('valid-b'))
      if (url.endsWith('/rate_limit')) return response({ resources: { core: { remaining: 8, reset: 1_786_665_600 } } })
      if (url.includes('/commits/')) return response({ sha: url.includes('valid-b') ? 'valid-b-sha' : 'valid-a-sha' })
      if (url.includes('/git/trees/')) return response({ truncated: false, tree: [{ path: 'package.json', type: 'blob', size: 150 }, { path: 'patch.yml', type: 'blob', size: 80 }] })
      if (url.includes('/releases?')) return response([])
      if (url.endsWith('/package.json')) {
        const name = url.includes('valid-b') ? '@community/valid-b' : '@community/valid-a'
        return response(JSON.stringify({ name, dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }))
      }
      if (url.endsWith('/patch.yml')) return response('- insert:\n    - id: valid\n      name: "@community/valid"\n')
      return response({}, 404)
    }

    const service = new CatalogSyncService(store, undefined, fetcher)
    const first = await terminalRun(store, service.create('admin').id)
    expect(first).toMatchObject({ status: 'partially_failed', discovered: 2, verified: 1, deferred: 1, bundlesFound: 1, failed: 0, githubAuthenticated: false })
    expect(first.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: 'community/valid-b', status: 'deferred', reason: 'SYNC_BATCH_DEFERRED' }),
    ]))
    expect(store.retryableSyncRepositories(first.id)).toEqual(['community/valid-b'])

    const retry = await terminalRun(store, service.create('admin', first.id).id)
    expect(retry).toMatchObject({ status: 'completed', discovered: 1, verified: 1, deferred: 0, bundlesFound: 1, retryOf: first.id })
    expect(retry.candidates).toHaveLength(1)
    expect(retry.candidates[0]).toMatchObject({ repository: 'community/valid-b', status: 'verified' })
    store.close()
  })
})
