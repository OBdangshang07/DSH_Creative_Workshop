import { describe, expect, it } from 'vitest'
import { discoverGitHubTopic, verifyGitHubRepository, verifyGitHubRepositoryDetailed } from '../src/github-catalog.ts'

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
  it('uses authenticated pagination to extend the candidate window', async () => {
    const calls: string[] = []
    const candidates = Array.from({ length: 100 }, (_, index) => ({ ...repository, name: `dsh-plugin-${index}`, full_name: `community/dsh-plugin-${index}` }))
    const discovered = await discoverGitHubTopic('token', async input => {
      const url = new URL(String(input)); calls.push(url.toString())
      const page = Number(url.searchParams.get('page'))
      return response({ total_count: 101, items: page === 1 ? candidates : [{ ...repository, name: 'dsh-plugin-page-two', full_name: 'community/dsh-plugin-page-two' }] })
    })
    expect(calls.some(url => new URL(url).searchParams.get('page') === '2')).toBe(true)
    expect(discovered.repositories).toHaveLength(101)
    expect(discovered.repositories.some(item => item.full_name === 'community/dsh-plugin-page-two')).toBe(true)
  })

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

  it('collects a version-matched changelog without inventing missing entries', async () => {
    const plugin = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/example-plugin', version: '1.2.0', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      'cordis.patch.yml': '- insert:\n    - id: example\n      name: "@community/example-plugin"\n',
      'CHANGELOG.md': '# Changelog\n\n## 1.2.0\n\nRelease summary for this fixed revision.\n\n### Added\n\n- Added a verified web entry.\n\n### Fixed\n\n- Fixed startup ordering.\n',
    }))
    expect(plugin).toMatchObject({
      version: '1.2.0',
      releaseNotes: {
        sourceType: 'changelog', summary: 'Release summary for this fixed revision.',
        changes: [{ type: 'added', text: 'Added a verified web entry.' }, { type: 'fixed', text: 'Fixed startup ordering.' }],
      },
    })
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

  it('requires an explicit DSH or Cordis package dependency', async () => {
    const result = await verifyGitHubRepositoryDetailed(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/config-only', dsh: { bundle: { patch: './patch.yml' } } }),
      'patch.yml': '- insert:\n    - id: config-only\n      config: {}\n',
    }))
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('DSH_DEPENDENCY_EVIDENCE_WEAK')
  })

  it('collects package-local previews pinned to the verified commit', async () => {
    const plugin = await verifyGitHubRepository(repository, undefined, fixtureFetch({
      'packages/alpha/package.json': JSON.stringify({ name: '@community/alpha', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'packages/alpha/patch.yml': '- insert:\n    - id: alpha\n      name: "@community/alpha"\n',
      'packages/alpha/preview/cover.webp': 'image bytes are not fetched while verifying',
      'packages/alpha/screenshots/demo.png': 'image bytes are not fetched while verifying',
      'packages/beta/cover.png': 'belongs to another package',
    }))
    expect(plugin?.previewUrls).toEqual([
      'https://raw.githubusercontent.com/community/example-plugin/abc123fixedcommit/packages/alpha/preview/cover.webp',
      'https://raw.githubusercontent.com/community/example-plugin/abc123fixedcommit/packages/alpha/screenshots/demo.png',
    ])
  })

  it('accepts installable private local Bundles, excludes templates and deduplicates package names', async () => {
    const result = await verifyGitHubRepositoryDetailed(repository, undefined, fixtureFetch({
      'packages/real/package.json': JSON.stringify({ name: '@community/shared', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'packages/real/patch.yml': '- insert:\n    - id: real\n      name: "@community/shared"\n',
      'packages/real/generated/copy/package.json': JSON.stringify({ name: '@community/shared', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'packages/real/generated/copy/patch.yml': '- insert:\n    - id: duplicate\n      name: "@community/shared"\n',
      'packages/private/package.json': JSON.stringify({ name: '@community/private', private: true, dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'packages/private/patch.yml': '- insert:\n    - id: private\n      name: "@community/private"\n',
      'templates/starter/package.json': JSON.stringify({ name: '@community/template', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'templates/starter/patch.yml': '- insert:\n    - id: template\n      name: "@community/template"\n',
    }))
    expect(result.plugins).toHaveLength(2)
    expect(result.plugins.find(plugin => plugin.verification.packageJsonPath === 'packages/private/package.json')).toMatchObject({ kind: 'local-bundle', verification: { status: 'verified_local_bundle' } })
    expect(result.plugins.find(plugin => plugin.verification.packageJsonPath === 'packages/real/package.json')).toMatchObject({ kind: 'bundle' })
    expect(result.evidence.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ packageJsonPath: 'packages/real/generated/copy/package.json', reason: 'DUPLICATE_PACKAGE_NAME' }),
    ]))
  })

  it('does not accept unrelated dependency names that merely contain dsh letters', async () => {
    const result = await verifyGitHubRepositoryDetailed(repository, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/topic-spam', dependencies: { redshift: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'patch.yml': '- insert:\n    - id: topic-spam\n      name: "@community/topic-spam"\n',
    }))
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('DSH_DEPENDENCY_EVIDENCE_WEAK')
  })

  it('rejects upstream, forks and archives while allowing strict verification without a topic', async () => {
    const variants = [
      { ...repository, full_name: 'deepseek-ai/deepseek-harness' }, { ...repository, fork: true },
      { ...repository, archived: true },
    ]
    for (const candidate of variants) expect(await verifyGitHubRepository(candidate, undefined, fixtureFetch({}))).toBeUndefined()
    const withoutTopic = await verifyGitHubRepository({ ...repository, topics: [] }, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: '@community/direct', dependencies: { cordis: '*' }, dsh: { bundle: { patch: './patch.yml' } } }),
      'patch.yml': '- insert:\n    - id: direct\n      name: "@community/direct"\n',
    }))
    expect(withoutTopic).toMatchObject({ name: '@community/direct', kind: 'bundle' })
  })

  it('classifies Git submodule aggregators as suites', async () => {
    const result = await verifyGitHubRepositoryDetailed({ ...repository, full_name: 'community/routing-suite', name: 'routing-suite', topics: [] }, undefined, fixtureFetch({
      '.gitmodules': '[submodule "injector"]\n  path = injector\n  url = https://github.com/community/injector.git\n[submodule "preset"]\n  path = preset\n  url = https://github.com/community/router-preset.git\n[submodule "boost"]\n  path = mode-boost\n  url = https://github.com/community/mode-boost.git\n',
      'README.md': '# DeepSeek Harness routing suite',
    }))
    expect(result.status).toBe('verified')
    expect(result.plugins[0]).toMatchObject({ kind: 'suite', verification: { status: 'verified_suite' }, components: [
      expect.objectContaining({ path: 'injector', role: 'bundle' }),
      expect.objectContaining({ path: 'preset', role: 'preset' }),
      expect.objectContaining({ path: 'mode-boost', role: 'extension' }),
    ] })
  })

  it('does not classify an unrelated git-submodule repository as a DSH suite', async () => {
    const result = await verifyGitHubRepositoryDetailed({ ...repository, full_name: 'community/general-monorepo', name: 'general-monorepo', description: 'A generic collection of command line tools.', topics: [] }, undefined, fixtureFetch({
      '.gitmodules': '[submodule "alpha"]\n  path = alpha\n  url = https://github.com/community/alpha.git\n[submodule "beta"]\n  path = beta\n  url = https://github.com/community/beta.git\n',
    }))
    expect(result.status).toBe('rejected')
    expect(result.plugins).toEqual([])
  })

  it('classifies paired DSH preset manifests without pretending they are Bundles', async () => {
    const result = await verifyGitHubRepositoryDetailed({ ...repository, full_name: 'community/dsh-router-standard', topics: [] }, undefined, fixtureFetch({
      'package.json': JSON.stringify({ name: 'dsh-router-standard', version: '0.3.0' }),
      'preset/router-standard/preset.yml': 'name: router-standard',
      'preset/router-standard/agent.cordis.yml': 'name: router-standard-agent',
    }))
    expect(result.status).toBe('verified')
    expect(result.plugins[0]).toMatchObject({ kind: 'preset', version: '0.3.0', verification: { status: 'verified_preset', patchPath: 'preset/router-standard/preset.yml' } })
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
