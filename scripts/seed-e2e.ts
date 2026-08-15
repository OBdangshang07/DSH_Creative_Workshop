import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AccountStore, type GitHubPluginRecord } from '../apps/api/src/auth-store.ts'

const fixture = (id: string, name: string, stars: number): GitHubPluginRecord => ({
  id, fullName: `dsh-e2e/${id.split('.').at(-1)}`, name, packageName: name, packagePath: '.', author: 'dsh-e2e',
  description: 'Browser-test fixture that follows the verified DeepSeek Harness Bundle contract.',
  url: `https://github.com/dsh-e2e/${id.split('.').at(-1)}`, stars, forks: 1, language: 'TypeScript', license: 'MIT',
  updatedAt: '2026-08-14T00:00:00Z', pushedAt: '2026-08-14T00:00:00Z', topics: ['dsh-plugin', 'browser-test'],
  kind: 'bundle', surfaces: ['web', 'headless'], declaredDependencies: ['@deepseek-ai/cordis'], dshDependencies: ['@deepseek-ai/cordis'],
  version: '1.1.4', releaseNotes: { version: '1.1.4', title: `${name} 1.1.4`, summary: 'A traceable browser-test release for the fixed revision.', changes: [{ type: 'changed', text: 'Updated the verified browser-test bundle.' }], breakingChanges: [], sourceType: 'declared', sourceUrl: `https://github.com/dsh-e2e/${id.split('.').at(-1)}/releases/tag/v1.1.4`, collectedAt: '2026-08-14T00:00:00Z' },
  source: 'github-topic', securityReviewed: false,
  verification: { status: 'verified_bundle', commitSha: `${id.replaceAll('.', '')}commit`, packageJsonPath: 'package.json', patchPath: 'dsh.bundle.patch.yml', checkedAt: '2026-08-14T00:00:00Z', verifierVersion: '2.0.0', entryIds: ['e2e'], moduleSpecifiers: [name] },
})

const fixtures = [fixture('github.e2e.primary', '@dsh-e2e/primary', 42), fixture('github.e2e.secondary', '@dsh-e2e/secondary', 8)]

const databaseFile = resolve('.visual-check/e2e.sqlite')
for (const suffix of ['', '-wal', '-shm']) await rm(`${databaseFile}${suffix}`, { force: true })
const store = new AccountStore(databaseFile)
await store.initialize(undefined, fixtures)
for (const plugin of fixtures) await store.moderatePlugin('e2e', plugin.id, { status: 'approved' })
await store.createUser('browser-user', 'browser@example.test', 'BrowserPassword123')
await store.createUser('browser-admin', 'browser-admin@example.test', 'BrowserAdminPassword123', 'admin')
await store.createUser('browser-profile', 'browser-profile@example.test', 'BrowserProfilePassword123')
store.close()
process.stdout.write(`Seeded ${fixtures.length} approved plugins for browser tests.\n`)
