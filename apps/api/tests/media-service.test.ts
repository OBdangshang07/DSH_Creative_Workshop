import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountStore, type GitHubPluginRecord } from '../src/auth-store.ts'
import { MediaService, MediaUnavailableError } from '../src/media-service.ts'

const stores: AccountStore[] = []

function plugin(previewUrls?: string[]): GitHubPluginRecord {
  return {
    id: 'github.community.media', fullName: 'community/media', name: '@community/media', packageName: '@community/media', packagePath: '.',
    author: 'community', description: 'A verified DeepSeek Harness media fixture used for deterministic tests.',
    url: 'https://github.com/community/media', stars: 1, forks: 0, language: 'TypeScript', updatedAt: '2026-08-14T00:00:00Z', pushedAt: '2026-08-14T00:00:00Z',
    topics: ['dsh-plugin'], kind: 'bundle', surfaces: ['web'], ...(previewUrls === undefined ? {} : { previewUrls }), source: 'github-topic', securityReviewed: false,
    verification: { status: 'verified_bundle', commitSha: 'fixedcommit123', packageJsonPath: 'package.json', patchPath: 'patch.yml', checkedAt: '2026-08-14T00:00:00Z', verifierVersion: '2.1.0', entryIds: ['media'], moduleSpecifiers: ['@community/media'] },
  }
}

async function setup(fetcher: typeof fetch, record = plugin()) {
  const store = new AccountStore(); stores.push(store)
  await store.initialize(undefined, [record]); await store.moderatePlugin('system', record.id, { status: 'approved' })
  return { store, service: new MediaService(store, { fetcher }) }
}

afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('same-origin plugin media service', () => {
  it('always renders a deterministic SVG shell around optional remote media', async () => {
    const { service } = await setup((async () => new Response('image', { headers: { 'Content-Type': 'image/png' } })) as typeof fetch)
    expect(service.coverSvg('github.community.media')).toContain('<svg')
    expect(service.coverSvg('github.community.media')).not.toContain('/api/v1/plugins/github.community.media/media/0')
    await service.asset('github.community.media', 0)
    expect(service.coverSvg('github.community.media')).toContain('/api/v1/plugins/github.community.media/media/0')
    expect(service.coverSvg('missing')).toBeUndefined()
  })

  it.each([404, 429])('falls back without exposing upstream HTTP %s failures', async status => {
    const { store, service } = await setup((async () => new Response('', { status })) as typeof fetch)
    await expect(service.asset('github.community.media', 0)).rejects.toBeInstanceOf(MediaUnavailableError)
    expect(store.adminMedia().items[0]).toMatchObject({ status: 'fallback', error: `HTTP_${status}` })
  })

  it('rejects timeouts, SVG payloads and oversized declarations', async () => {
    const cases: Array<typeof fetch> = [
      (async () => { throw new DOMException('timed out', 'TimeoutError') }) as typeof fetch,
      (async () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })) as typeof fetch,
      (async () => new Response('x', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(5 * 1024 * 1024) } })) as typeof fetch,
    ]
    for (const fetcher of cases) {
      const { service } = await setup(fetcher)
      await expect(service.asset('github.community.media', 0)).rejects.toBeInstanceOf(MediaUnavailableError)
    }
  })

  it('only fetches raw media pinned to the same repository and commit', async () => {
    const fetcher = vi.fn(async () => new Response('image', { headers: { 'Content-Type': 'image/png' } })) as unknown as typeof fetch
    const unsafe = plugin(['https://raw.githubusercontent.com/another/repository/fixedcommit123/cover.png'])
    const { service } = await setup(fetcher, unsafe)
    await expect(service.asset(unsafe.id, 0)).rejects.toBeInstanceOf(MediaUnavailableError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
