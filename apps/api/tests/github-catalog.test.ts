import { describe, expect, it } from 'vitest'
import { verifyGitHubRepository } from '../src/github-catalog.ts'

const repository = {
  name: 'example-plugin',
  full_name: 'community/example-plugin',
  description: 'A test repository carrying the dsh-plugin discovery topic.',
  html_url: 'https://github.com/community/example-plugin',
  stargazers_count: 10,
  forks_count: 1,
  language: 'TypeScript',
  updated_at: '2026-08-14T00:00:00Z',
  pushed_at: '2026-08-14T00:00:00Z',
  topics: ['dsh-plugin'],
  archived: false,
  fork: false,
  default_branch: 'main',
  owner: { login: 'community' },
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
  }
}

function fixtureFetch(files: Record<string, string>) {
  return async (input: string | URL) => {
    const url = String(input)
    if (url.includes('/commits/')) return response({ sha: 'abc123fixedcommit' })
    if (url.includes('/git/trees/')) {
      return response({
        sha: 'tree123', truncated: false,
        tree: Object.entries(files).map(([path, content]) => ({ path, type: 'blob', size: content.length })),
      })
    }
    const file = Object.keys(files).find(path => url.endsWith(`/${path}`))
    return file === undefined ? response('', 404) : response(files[file])
  }
}

describe('DeepSeek Harness GitHub bundle verification', () => {
  it('rejects a repository that only carries the discovery topic', async () => {
    const plugin = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: 'ordinary-app', dependencies: { fastify: '*' } }),
      'README.md': '# not a DSH bundle',
    }))
    expect(plugin).toBeUndefined()
  })

  it('accepts a DSH bundle only when its declared Cordis patch exists and parses', async () => {
    const plugin = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/example-plugin', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      'cordis.patch.yml': '- insert:\n    - id: example\n      name: "@community/example-plugin"\n',
    }))
    expect(plugin?.verification).toMatchObject({
      status: 'verified_bundle', commitSha: 'abc123fixedcommit', packageJsonPath: 'package.json', patchPath: 'cordis.patch.yml',
    })
  })

  it('rejects a missing, invalid or escaping patch', async () => {
    const missing = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ dsh: { bundle: { patch: './missing.yml' } } }),
    }))
    const invalid = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      'cordis.patch.yml': 'title: documentation-only',
    }))
    const escaping = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'packages/plugin/package.json': JSON.stringify({ dsh: { bundle: { patch: '../../../cordis.patch.yml' } } }),
      'cordis.patch.yml': '- insert:\n    - id: fake\n      name: fake\n',
    }))
    expect([missing, invalid, escaping]).toEqual([undefined, undefined, undefined])
  })

  it('rejects the DeepSeek Harness upstream repository itself', async () => {
    const plugin = await verifyGitHubRepository({ ...repository, full_name: 'deepseek-ai/deepseek-harness' }, undefined, fixtureFetch({}))
    expect(plugin).toBeUndefined()
  })
})
