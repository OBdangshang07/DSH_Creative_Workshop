import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountStore, type GitHubPluginRecord } from '../src/auth-store.ts'

const temporaryDirectories: string[] = []
const bundle = (id: string, commitSha: string): GitHubPluginRecord => ({
  id, fullName: 'community/versioned-bundle', name: '@community/versioned-bundle', packageName: '@community/versioned-bundle', packagePath: '.',
  author: 'community', description: 'A versioned DeepSeek Harness bundle used to test the catalog data model.',
  url: 'https://github.com/community/versioned-bundle', stars: 1, forks: 0, language: 'TypeScript', updatedAt: '2026-08-14T00:00:00Z', pushedAt: '2026-08-14T00:00:00Z',
  topics: ['dsh-plugin'], kind: 'bundle', surfaces: ['headless'], source: 'github-topic', securityReviewed: false,
  verification: { status: 'verified_bundle', commitSha, packageJsonPath: 'package.json', patchPath: 'patch.yml', checkedAt: '2026-08-14T00:00:00Z', verifierVersion: '2.0.0', entryIds: ['bundle'], moduleSpecifiers: ['@community/versioned-bundle'] },
})

async function temporaryPath(name: string) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-workshop-test-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

afterEach(async () => { while (temporaryDirectories.length) await rm(temporaryDirectories.pop()!, { recursive: true, force: true }) })

describe('SQLite account and catalog store', () => {
  it('creates a SQLite WAL database with foreign keys and migrations', async () => {
    const databaseFile = await temporaryPath('workshop.sqlite')
    const store = new AccountStore(databaseFile)
    await store.initialize()
    store.close()
    const database = new DatabaseSync(databaseFile, { readOnly: true })
    expect(database.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
    expect(database.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
    expect(database.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }])
    expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get()).toMatchObject({ count: 32 })
    database.close()
  })

  it('migrates legacy plugin-level reviews onto the published revision', async () => {
    const databaseFile = await temporaryPath('legacy-reviews.sqlite')
    const plugin = bundle('github.community.legacy-review', 'legacy-review-sha')
    const revisionId = `${plugin.id}@${plugin.verification.commitSha}:${plugin.verification.packageJsonPath}`
    const database = new DatabaseSync(databaseFile)
    database.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,last_login_at TEXT);
      CREATE TABLE plugins(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,package_path TEXT NOT NULL,latest_revision_id TEXT,published_revision_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(full_name,package_path));
      CREATE TABLE plugin_revisions(id TEXT PRIMARY KEY,plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,commit_sha TEXT NOT NULL,package_json_path TEXT NOT NULL,patch_path TEXT NOT NULL,record_json TEXT NOT NULL,verification_json TEXT NOT NULL,verified_at TEXT NOT NULL,UNIQUE(plugin_id,commit_sha,package_json_path));
      CREATE TABLE reviews(id TEXT PRIMARY KEY,plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,author_name TEXT NOT NULL,rating INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(plugin_id,author_id));
    `)
    database.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('usr_legacy_review', 'legacy-reviewer', 'legacy-review@example.test', 'scrypt$00$00', 'user', 'active', '2026-01-01T00:00:00Z', null)
    database.prepare('INSERT INTO plugins VALUES(?,?,?,?,?,?,?)').run(plugin.id, plugin.fullName, '.', revisionId, revisionId, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    database.prepare('INSERT INTO plugin_revisions VALUES(?,?,?,?,?,?,?,?)').run(revisionId, plugin.id, plugin.verification.commitSha, plugin.verification.packageJsonPath, plugin.verification.patchPath, JSON.stringify(plugin), JSON.stringify(plugin.verification), plugin.verification.checkedAt)
    database.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)').run('review_legacy', plugin.id, 'usr_legacy_review', 'legacy-reviewer', 4, 'Legacy review body', '2026-01-02T00:00:00Z')
    database.close()

    const store = new AccountStore(databaseFile)
    await store.initialize()
    store.close()
    const migrated = new DatabaseSync(databaseFile, { readOnly: true })
    expect((migrated.prepare('PRAGMA table_info(reviews)').all() as Array<{ name: string }>).map(column => column.name)).toContain('revision_id')
    expect(migrated.prepare('SELECT revision_id,created_at,updated_at FROM reviews').get()).toEqual({ revision_id: revisionId, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' })
    migrated.close()
  })

  it('migrates legacy JSON once and creates a byte-for-byte backup', async () => {
    const legacyFile = await temporaryPath('data.json')
    const databaseFile = legacyFile.replace('.json', '.sqlite')
    const legacyPlugin = bundle('github.community.migrated', 'legacy-sha')
    const legacy = {
      version: 1,
      users: [{ id: 'usr_legacy', username: 'legacy-admin', email: 'legacy@example.test', passwordHash: 'scrypt$00$00', role: 'admin', status: 'active', favorites: [legacyPlugin.id], subscriptions: [legacyPlugin.id], createdAt: '2026-01-01T00:00:00Z' }],
      sessions: [], githubPlugins: [legacyPlugin], githubSyncedAt: '2026-08-13T00:00:00Z',
      pluginModeration: { [legacyPlugin.id]: { status: 'approved', featured: true, updatedAt: '2026-08-13T00:00:00Z', updatedBy: 'usr_legacy' } },
      audit: [], collections: [], githubReviews: [],
    }
    const source = JSON.stringify(legacy, null, 2)
    await import('node:fs/promises').then(fs => fs.writeFile(legacyFile, source, 'utf8'))
    const store = new AccountStore(databaseFile, legacyFile)
    await store.initialize()
    expect(store.summary()).toMatchObject({ users: 1, admins: 1, plugins: 1, approvedPlugins: 1, githubSyncedAt: '2026-08-13T00:00:00Z' })
    expect(store.users().items[0]).toMatchObject({ username: 'legacy-admin', favorites: [legacyPlugin.id], subscriptions: [legacyPlugin.id] })
    expect(store.githubSnapshot().items[0].id).toBe(legacyPlugin.id)
    store.close()
    expect(await readFile(`${legacyFile}.pre-sqlite-backup`, 'utf8')).toBe(source)
    expect((await stat(databaseFile)).size).toBeGreaterThan(0)
  })

  it('keeps an approved old revision public when a new revision arrives pending', async () => {
    const store = new AccountStore()
    const first = bundle('github.community.versioned', 'commit-one')
    const second = bundle(first.id, 'commit-two')
    await store.initialize(undefined, [first])
    await store.moderatePlugin('system', first.id, { status: 'approved' })
    await store.ingestVerifiedPlugins('sync', [second])
    expect(store.githubSnapshot().items[0].verification.commitSha).toBe('commit-one')
    const candidate = store.githubSnapshot(true).items[0]
    expect(candidate.verification.commitSha).toBe('commit-two')
    expect(candidate.moderation.status).toBe('pending')
    expect(candidate.publication).toBe('candidate')
    await store.moderatePlugin('admin', first.id, { revisionId: candidate.revisionId, status: 'approved' })
    expect(store.githubSnapshot().items[0].verification.commitSha).toBe('commit-two')
    store.close()
  })

  it('does not allow a revision from another plugin to be moderated through the wrong ID', async () => {
    const store = new AccountStore()
    const first = bundle('github.community.first', 'first-sha')
    const second = { ...bundle('github.community.second', 'second-sha'), fullName: 'community/second', name: '@community/second' }
    await store.initialize(undefined, [first, second])
    const secondRevision = store.githubSnapshot(true, { q: 'second' }).items[0].revisionId
    expect(await store.moderatePlugin('admin', first.id, { revisionId: secondRevision, status: 'approved' })).toBe(false)
    expect(store.githubSnapshot().items).toEqual([])
    store.close()
  })

  it('protects the final active administrator at the data layer', async () => {
    const store = new AccountStore()
    await store.initialize({ username: 'root-admin', email: 'root@example.test', password: 'AdminPassword12345' })
    const admin = store.users({ role: 'admin' }).items[0]
    await expect(store.updateUser(admin.id, admin.id, { role: 'user' })).rejects.toThrow('ADMIN_LAST_ADMIN')
    await expect(store.updateUser(admin.id, admin.id, { status: 'disabled' })).rejects.toThrow('ADMIN_LAST_ADMIN')
    store.close()
  })

  it('persists IP and identity rate limits across store restarts', async () => {
    const databaseFile = await temporaryPath('rate-limit.sqlite')
    const first = new AccountStore(databaseFile)
    await first.initialize()
    expect(first.allowAuthAttempt('login:identity:test', 2)).toBe(true)
    expect(first.allowAuthAttempt('login:identity:test', 2)).toBe(true)
    expect(first.allowAuthAttempt('login:identity:test', 2)).toBe(false)
    first.close()
    const second = new AccountStore(databaseFile)
    await second.initialize()
    expect(second.allowAuthAttempt('login:identity:test', 2)).toBe(false)
    second.clearAuthAttempts('login:identity:test')
    expect(second.allowAuthAttempt('login:identity:test', 2)).toBe(true)
    second.close()
  })

  it('stores only session token hashes and supports per-device revocation', async () => {
    const databaseFile = await temporaryPath('sessions.sqlite')
    const store = new AccountStore(databaseFile)
    await store.initialize()
    const user = await store.createUser('session-user', 'session@example.test', 'SessionPassword123')
    const first = await store.createSession(user.id, { ip: '127.0.0.1', userAgent: 'browser one' })
    const second = await store.createSession(user.id, { ip: '127.0.0.2', userAgent: 'browser two' })
    expect(store.sessions(user.id, first.token)).toHaveLength(2)
    expect(store.revokeOtherSessions(user.id, first.token)).toBe(1)
    expect(store.sessionUser(second.token)).toBeUndefined()
    store.close()
    const database = new DatabaseSync(databaseFile, { readOnly: true })
    const serialized = JSON.stringify(database.prepare('SELECT token_hash FROM sessions').all())
    expect(serialized).not.toContain(first.token)
    database.close()
  })

  it('tracks sync concurrency, candidates and terminal state without changing the existing catalog', async () => {
    const store = new AccountStore()
    const published = bundle('github.community.stable', 'stable-sha')
    await store.initialize(undefined, [published])
    await store.moderatePlugin('system', published.id, { status: 'approved' })
    const run = store.createSyncRun('admin', undefined, { ip: '127.0.0.1', requestId: 'sync-request' })
    expect(() => store.createSyncRun('admin')).toThrow('SYNC_ALREADY_RUNNING')
    store.recordSyncCandidate(run.id, { repository: 'community/broken', status: 'failed', bundleCount: 0, reason: 'TREE_FETCH_500' })
    store.updateSyncRun(run.id, { status: 'partially_failed', discovered: 1, failed: 1, finishedAt: new Date().toISOString() })
    expect(store.syncRun(run.id)).toMatchObject({ status: 'partially_failed', candidates: [{ repository: 'community/broken', reason: 'TREE_FETCH_500' }] })
    expect(store.githubSnapshot().items[0].id).toBe(published.id)
    expect(store.auditRecords({ action: 'sync.create' }).items[0]).toMatchObject({ requestId: 'sync-request', ip: '127.0.0.1' })
    store.close()
  })
})
