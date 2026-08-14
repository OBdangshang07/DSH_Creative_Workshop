import { describe, expect, it } from 'vitest'
import { verifyGitHubRepository, verifyGitHubRepositoryDetailed } from '../src/github-catalog.ts'

const repository = {
  name: 'example-plugin', full_name: 'community/example-plugin',
  description: 'A test repository carrying the dsh-plugin discovery topic.', html_url: 'https://github.com/community/example-plugin',
  stargazers_count: 10, forks_count: 1, language: 'TypeScript', updated_at: '2026-08-14T00:00:00Z', pushed_at: '2026-08-14T00:00:00Z',
  topics: ['dsh-plugin'], archived: false, fork: false, default_branch: 'main', owner: { login: 'community' },
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return body }, async text() { return typeof body === 'string' ? body : JSON.stringify(body) } }
}

function fixtureFetch(files: Record<string, string>) {
  return async (input: string | URL) => {
    const url = String(input)
    if (url.includes('/commits/')) return response({ sha: 'abc123fixedcommit' })
    if (url.includes('/git/trees/')) return response({ sha: 'tree123', truncated: false, tree: Object.entries(files).map(([path, content]) => ({ path, type: 'blob', size: content.length })) })
    const file = Object.keys(files).find(path => url.endsWith(`/${path}`))
    return file === undefined ? response('', 404) : response(files[file])
  }
}

describe('DeepSeek Harness GitHub bundle verification', () => {
  it('rejects a repository that only carries the discovery topic', async () => {
    expect(await verifyGitHubRepository(repository, undefined, fixtureFetch({ 'package.json': JSON.stringify({ name: 'ordinary-app', dependencies: { fastify: '*' } }) }))).toBeUndefined()
  })

  it('pins a valid Bundle to its commit and records Cordis evidence', async () => {
    const plugin = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/example-plugin', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      'cordis.patch.yml': '- insert:\n    - id: example\n      name: "@community/example-plugin"\n',
    }))
    expect(plugin?.verification).toMatchObject({ status: 'verified_bundle', commitSha: 'abc123fixedcommit', packageJsonPath: 'package.json', patchPath: 'cordis.patch.yml', entryIds: ['example'], moduleSpecifiers: ['@community/example-plugin'] })
    expect(plugin?.securityReviewed).toBe(false)
  })

  it('finds multiple independently addressable Bundles in a monorepo', async () => {
    const result = await verifyGitHubRepositoryDetailed(repository, undefined, fixtureFetch({
      'packages/alpha/package.json': JSON.stringify({ name: '@community/alpha', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'packages/alpha/patch.yml': '- insert:\n    - id: alpha\n      name: "@community/alpha"\n',
      'packages/beta/package.json': JSON.stringify({ name: '@community/beta', peerDependencies: { '@deepseek-ai/core': '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'packages/beta/patch.yml': '- insert:\n    - id: beta\n      name: "@community/beta"\n',
    }))
    expect(result.status).toBe('verified')
    expect(result.plugins).toHaveLength(2)
    expect(new Set(result.plugins.map(plugin => plugin.id)).size).toBe(2)
    expect(result.plugins.map(plugin => plugin.verification.packageJsonPath)).toEqual(['packages/alpha/package.json', 'packages/beta/package.json'])
  })

  it('rejects missing, malformed, escaping or structurally empty patches', async () => {
    const fixtures = [
      { 'package.json': JSON.stringify({ name: 'missing', dsh: { bundle: { patch: './missing.yml' } } }) },
      { 'package.json': JSON.stringify({ name: 'bad-yaml', dsh: { bundle: { patch: './patch.yml' } } }), 'patch.yml': '[not valid' },
      { 'packages/plugin/package.json': JSON.stringify({ name: 'escaping', dsh: { bundle: { patch: '../../../patch.yml' } } }), 'patch.yml': '- insert:\n    - id: fake\n      name: fake\n' },
      { 'package.json': JSON.stringify({ name: 'empty', dsh: { bundle: { patch: './patch.yml' } } }), 'patch.yml': 'title: documentation-only' },
    ]
    for (const files of fixtures) expect(await verifyGitHubRepository(repository, undefined, fixtureFetch(files))).toBeUndefined()
  })

  it('requires DSH or Cordis dependency/module evidence', async () => {
    const result = await verifyGitHubRepositoryDetailed(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/config-only', dsh: { bundle: { patch: './patch.yml' } } }),
      'patch.yml': '- insert:\n    - id: config-only\n      config: {}\n',
    }))
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('DSH_DEPENDENCY_EVIDENCE_WEAK')
  })

  it('rejects upstream, forks, archives and repositories without the topic', async () => {
    const variants = [
      { ...repository, full_name: 'deepseek-ai/deepseek-harness' }, { ...repository, fork: true },
      { ...repository, archived: true }, { ...repository, topics: [] },
    ]
    for (const candidate of variants) expect(await verifyGitHubRepository(candidate, undefined, fixtureFetch({}))).toBeUndefined()
  })

  it('does not scan fixture, example or node_modules manifests', async () => {
    const result = await verifyGitHubRepositoryDetailed(repository, undefined, fixtureFetch({
      'examples/fake/package.json': JSON.stringify({ name: 'fake', dsh: { bundle: { patch: './patch.yml' } } }),
      'examples/fake/patch.yml': '- insert:\n    - id: fake\n      name: fake\n',
      'node_modules/fake/package.json': '{}',
    }))
    expect(result.plugins).toEqual([])
  })
})
