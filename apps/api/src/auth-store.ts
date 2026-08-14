import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export type UserRole = 'user' | 'admin'
export type UserStatus = 'active' | 'disabled'
export type ModerationStatus = 'approved' | 'pending' | 'hidden' | 'rejected'
export type PluginVerificationStatus = 'verified_bundle'
export type SyncRunStatus = 'queued' | 'discovering' | 'verifying' | 'completed' | 'partially_failed' | 'failed'

export interface StoredUser {
  id: string
  username: string
  email: string
  passwordHash: string
  role: UserRole
  status: UserStatus
  favorites: string[]
  subscriptions: string[]
  createdAt: string
  lastLoginAt?: string
}

export interface UserCollection {
  id: string
  ownerId: string
  name: string
  description: string
  pluginIds: string[]
  createdAt: string
  updatedAt: string
}

export interface GitHubReview {
  id: string
  pluginId: string
  revisionId: string
  authorId: string
  authorName: string
  rating: number
  body: string
  createdAt: string
  updatedAt: string
}

export interface GitHubPluginRecord {
  id: string
  fullName: string
  name: string
  packageName?: string
  packagePath?: string
  author: string
  description: string
  url: string
  homepage?: string
  stars: number
  forks: number
  language?: string
  license?: string
  updatedAt: string
  pushedAt: string
  topics: string[]
  kind: string
  surfaces: string[]
  declaredDependencies?: string[]
  dshDependencies?: string[]
  source: 'github-topic'
  securityReviewed: false
  verification: PluginVerification
}

export interface PluginVerification {
  status: PluginVerificationStatus
  commitSha: string
  packageJsonPath: string
  patchPath: string
  checkedAt: string
  verifierVersion?: string
  entryIds?: string[]
  moduleSpecifiers?: string[]
}

export interface PluginModeration {
  revisionId: string
  status: ModerationStatus
  featured: boolean
  reason?: string
  updatedAt: string
  updatedBy: string
}

export interface SessionView {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  idleExpiresAt: string
  ip?: string
  userAgent?: string
  current: boolean
}

export interface AuditRecord {
  id: string
  actorId: string
  action: string
  target: string
  details: Record<string, unknown>
  ip?: string
  requestId?: string
  at: string
}

export interface SyncCandidateInput {
  repository: string
  commitSha?: string
  status: 'verified' | 'rejected' | 'failed'
  bundleCount: number
  reason?: string
  evidence?: Record<string, unknown>
}

export interface SyncRun {
  id: string
  actorId: string
  status: SyncRunStatus
  discovered: number
  verified: number
  rejected: number
  failed: number
  error?: string
  githubRemaining?: number
  githubResetAt?: string
  retryOf?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export interface BootstrapAdmin {
  username: string
  email: string
  password: string
}

interface LegacyData {
  users?: StoredUser[]
  sessions?: Array<{ tokenHash: string; userId: string; expiresAt: string; createdAt: string }>
  githubPlugins?: GitHubPluginRecord[]
  githubSyncedAt?: string
  pluginModeration?: Record<string, Omit<PluginModeration, 'revisionId'>>
  audit?: Array<{ id: string; actorId: string; action: string; target: string; at: string }>
  collections?: UserCollection[]
  githubReviews?: Array<Omit<GitHubReview, 'revisionId' | 'updatedAt'> & Partial<Pick<GitHubReview, 'revisionId' | 'updatedAt'>>>
}

export interface PluginCommunity {
  favoriteCount: number
  subscriptionCount: number
  reviewCount: number
  reviewScore: number
}

export interface PluginDependencyView {
  packageName: string
  resolved: boolean
  pluginId?: string
  name?: string
}

export interface CatalogQuery {
  q?: string
  status?: string
  kind?: string
  surface?: string
  topic?: string
  author?: string
  language?: string
  license?: string
  sort?: 'stars' | 'recent' | 'name' | 'rating' | 'subscriptions'
  page?: number
  pageSize?: number
}

export interface ReviewQuery {
  page?: number
  pageSize?: number
}

type SqlRow = Record<string, unknown>

const nowIso = () => new Date().toISOString()
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const revisionIdFor = (plugin: GitHubPluginRecord) => `${plugin.id}@${plugin.verification.commitSha}:${plugin.verification.packageJsonPath}`

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, expectedHex] = encoded.split('$')
  if (scheme !== 'scrypt' || salt === undefined || expectedHex === undefined) return false
  const actual = await scrypt(password, salt, 64) as Buffer
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function publicUser(user: StoredUser) {
  return {
    id: user.id, username: user.username, email: user.email, role: user.role, status: user.status,
    favorites: user.favorites, subscriptions: user.subscriptions, createdAt: user.createdAt,
    ...(user.lastLoginAt === undefined ? {} : { lastLoginAt: user.lastLoginAt }),
  }
}

export class AccountStore {
  private db: DatabaseSync | undefined
  private readonly databaseFile: string
  private readonly legacyFile?: string

  constructor(file?: string, legacyFile?: string) {
    if (file === undefined) {
      this.databaseFile = ':memory:'
    } else if (extname(file).toLowerCase() === '.json') {
      this.databaseFile = file.replace(/\.json$/i, '.sqlite')
      this.legacyFile = legacyFile ?? file
    } else {
      this.databaseFile = file
      if (legacyFile !== undefined) this.legacyFile = legacyFile
    }
  }

  private get database(): DatabaseSync {
    if (this.db === undefined) throw new Error('STORE_NOT_INITIALIZED')
    return this.db
  }

  async initialize(bootstrapAdmin?: BootstrapAdmin, seedPlugins: GitHubPluginRecord[] = []): Promise<void> {
    if (this.db !== undefined) {
      if (this.pluginCount() === 0 && seedPlugins.length > 0) await this.ingestVerifiedPlugins('system', seedPlugins)
      if (bootstrapAdmin !== undefined && this.adminCount() === 0) {
        await this.createUser(bootstrapAdmin.username, bootstrapAdmin.email, bootstrapAdmin.password, 'admin')
      }
      return
    }
    if (this.databaseFile !== ':memory:') await mkdir(dirname(this.databaseFile), { recursive: true })
    this.db = new DatabaseSync(this.databaseFile)
    if (this.databaseFile !== ':memory:') await chmod(this.databaseFile, 0o600)
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
    this.migrateSchema()
    await this.importLegacyIfNeeded()
    this.pruneSessions()
    if (this.pluginCount() === 0 && seedPlugins.length > 0) await this.ingestVerifiedPlugins('system', seedPlugins)
    if (bootstrapAdmin !== undefined && this.adminCount() === 0) {
      await this.createUser(bootstrapAdmin.username, bootstrapAdmin.email, bootstrapAdmin.password, 'admin')
    }
  }

  close(): void {
    this.db?.close()
    this.db = undefined
  }

  private migrateSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
        status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL, last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL,
        ip TEXT, user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS auth_attempts(
        key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at TEXT NOT NULL, blocked_until TEXT
      );
      CREATE TABLE IF NOT EXISTS plugins(
        id TEXT PRIMARY KEY, full_name TEXT NOT NULL, package_path TEXT NOT NULL, latest_revision_id TEXT,
        published_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(full_name, package_path)
      );
      CREATE TABLE IF NOT EXISTS plugin_revisions(
        id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        commit_sha TEXT NOT NULL, package_json_path TEXT NOT NULL, patch_path TEXT NOT NULL,
        record_json TEXT NOT NULL, verification_json TEXT NOT NULL, verified_at TEXT NOT NULL,
        UNIQUE(plugin_id, commit_sha, package_json_path)
      );
      CREATE TABLE IF NOT EXISTS moderation_decisions(
        revision_id TEXT PRIMARY KEY REFERENCES plugin_revisions(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('approved','pending','hidden','rejected')),
        featured INTEGER NOT NULL DEFAULT 0, reason TEXT, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS favorites(
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, PRIMARY KEY(user_id, plugin_id)
      );
      CREATE TABLE IF NOT EXISTS subscriptions(
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, PRIMARY KEY(user_id, plugin_id)
      );
      CREATE TABLE IF NOT EXISTS collections(
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_items(
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, position INTEGER NOT NULL,
        PRIMARY KEY(collection_id, plugin_id)
      );
      CREATE TABLE IF NOT EXISTS reviews(
        id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_name TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(plugin_id, author_id)
      );
      CREATE TABLE IF NOT EXISTS sync_runs(
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, status TEXT NOT NULL, discovered INTEGER NOT NULL DEFAULT 0,
        verified INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
        error TEXT, github_remaining INTEGER, github_reset_at TEXT, retry_of TEXT,
        created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_candidates(
        run_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE, repository TEXT NOT NULL, commit_sha TEXT,
        status TEXT NOT NULL, bundle_count INTEGER NOT NULL DEFAULT 0, reason TEXT, evidence_json TEXT,
        PRIMARY KEY(run_id, repository)
      );
      CREATE TABLE IF NOT EXISTS audit_logs(
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
        details_json TEXT NOT NULL, ip TEXT, request_id TEXT, at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_logs(at DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));
    `)
    const reviewColumns = (this.database.prepare('PRAGMA table_info(reviews)').all() as SqlRow[]).map(row => String(row.name))
    if (!reviewColumns.includes('revision_id')) {
      this.transaction(() => this.database.exec(`
        DROP TABLE IF EXISTS reviews_v2;
        CREATE TABLE reviews_v2(
          id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
          revision_id TEXT NOT NULL REFERENCES plugin_revisions(id) ON DELETE CASCADE,
          author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_name TEXT NOT NULL,
          rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(revision_id, author_id)
        );
        INSERT INTO reviews_v2(id,plugin_id,revision_id,author_id,author_name,rating,body,created_at,updated_at)
          SELECT rv.id,rv.plugin_id,COALESCE(p.published_revision_id,p.latest_revision_id),rv.author_id,rv.author_name,
                 rv.rating,rv.body,rv.created_at,rv.created_at
          FROM reviews rv JOIN plugins p ON p.id=rv.plugin_id
          WHERE COALESCE(p.published_revision_id,p.latest_revision_id) IS NOT NULL;
        DROP TABLE reviews;
        ALTER TABLE reviews_v2 RENAME TO reviews;
      `))
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS favorites_plugin_idx ON favorites(plugin_id);
      CREATE INDEX IF NOT EXISTS subscriptions_plugin_idx ON subscriptions(plugin_id);
      CREATE INDEX IF NOT EXISTS collection_items_plugin_idx ON collection_items(plugin_id);
      CREATE INDEX IF NOT EXISTS reviews_plugin_revision_idx ON reviews(plugin_id, revision_id, updated_at DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, datetime('now'));
    `)
  }

  private async importLegacyIfNeeded(): Promise<void> {
    if (this.legacyFile === undefined || this.scalar('SELECT COUNT(*) AS value FROM users') > 0 || this.scalar('SELECT COUNT(*) AS value FROM plugins') > 0) return
    try {
      await stat(this.legacyFile)
    } catch {
      return
    }
    const legacy = JSON.parse(await readFile(this.legacyFile, 'utf8')) as LegacyData
    const backup = `${this.legacyFile}.pre-sqlite-backup`
    try { await stat(backup) } catch { await copyFile(this.legacyFile, backup) }
    this.transaction(() => {
      for (const user of legacy.users ?? []) {
        this.database.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?,?,?)').run(
          user.id, user.username, user.email, user.passwordHash, user.role, user.status, user.createdAt, user.lastLoginAt ?? null,
        )
      }
      for (const session of legacy.sessions ?? []) {
        this.database.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run(
          `ses_legacy_${session.tokenHash.slice(0, 24)}`, session.tokenHash, session.userId, session.createdAt, session.createdAt,
          session.expiresAt, session.expiresAt, null, 'legacy-import',
        )
      }
      for (const plugin of legacy.githubPlugins ?? []) {
        if (plugin.verification?.status !== 'verified_bundle') continue
        this.ingestOne('legacy-import', plugin, legacy.pluginModeration?.[plugin.id])
      }
      for (const user of legacy.users ?? []) {
        for (const pluginId of user.favorites ?? []) this.insertRelation('favorites', user.id, pluginId)
        for (const pluginId of user.subscriptions ?? []) this.insertRelation('subscriptions', user.id, pluginId)
      }
      for (const collection of legacy.collections ?? []) {
        this.database.prepare('INSERT OR IGNORE INTO collections VALUES(?,?,?,?,?,?)').run(
          collection.id, collection.ownerId, collection.name, collection.description, collection.createdAt, collection.updatedAt,
        )
        collection.pluginIds.filter(pluginId => this.pluginExists(pluginId)).forEach((pluginId, index) => this.database.prepare(
          'INSERT OR IGNORE INTO collection_items VALUES(?,?,?)',
        ).run(collection.id, pluginId, index))
      }
      for (const review of legacy.githubReviews ?? []) {
        if (!this.pluginExists(review.pluginId) || !this.userExists(review.authorId)) continue
        const revision = this.database.prepare('SELECT COALESCE(published_revision_id,latest_revision_id) AS revision_id FROM plugins WHERE id=?').get(review.pluginId) as SqlRow | undefined
        if (revision?.revision_id === undefined || revision.revision_id === null) continue
        this.database.prepare('INSERT OR IGNORE INTO reviews VALUES(?,?,?,?,?,?,?,?,?)').run(
          review.id, review.pluginId, String(revision.revision_id), review.authorId, review.authorName,
          review.rating, review.body, review.createdAt, review.updatedAt ?? review.createdAt,
        )
      }
      for (const audit of legacy.audit ?? []) this.database.prepare(
        'INSERT OR IGNORE INTO audit_logs VALUES(?,?,?,?,?,?,?,?)',
      ).run(audit.id, audit.actorId, audit.action, audit.target, '{}', null, null, audit.at)
      if (legacy.githubSyncedAt !== undefined) this.database.prepare(`INSERT OR IGNORE INTO sync_runs(
        id,actor_id,status,discovered,verified,rejected,failed,created_at,started_at,finished_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        'sync_legacy_import', 'legacy-import', 'completed', (legacy.githubPlugins ?? []).length,
        (legacy.githubPlugins ?? []).filter(plugin => plugin.verification?.status === 'verified_bundle').length,
        0, 0, legacy.githubSyncedAt, legacy.githubSyncedAt, legacy.githubSyncedAt,
      )
    })
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (cause) {
      this.database.exec('ROLLBACK')
      throw cause
    }
  }

  private scalar(sql: string, ...params: Array<string | number | null>): number {
    const row = this.database.prepare(sql).get(...params) as SqlRow | undefined
    return Number(row?.value ?? 0)
  }

  private pluginCount(): number { return this.scalar('SELECT COUNT(*) AS value FROM plugins') }
  private adminCount(): number { return this.scalar("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND status='active'") }
  private pluginExists(pluginId: string): boolean { return this.scalar('SELECT COUNT(*) AS value FROM plugins WHERE id=?', pluginId) > 0 }
  private userExists(userId: string): boolean { return this.scalar('SELECT COUNT(*) AS value FROM users WHERE id=?', userId) > 0 }

  private userFromRow(row: SqlRow): StoredUser {
    const id = String(row.id)
    return {
      id, username: String(row.username), email: String(row.email), passwordHash: String(row.password_hash),
      role: String(row.role) as UserRole, status: String(row.status) as UserStatus,
      favorites: this.relationIds('favorites', id), subscriptions: this.relationIds('subscriptions', id),
      createdAt: String(row.created_at), ...(row.last_login_at === null ? {} : { lastLoginAt: String(row.last_login_at) }),
    }
  }

  private relationIds(table: 'favorites' | 'subscriptions', userId: string): string[] {
    return (this.database.prepare(`SELECT plugin_id FROM ${table} WHERE user_id=? ORDER BY created_at`).all(userId) as SqlRow[])
      .map(row => String(row.plugin_id))
  }

  private insertRelation(table: 'favorites' | 'subscriptions', userId: string, pluginId: string): void {
    if (this.scalar('SELECT COUNT(*) AS value FROM plugins WHERE id=?', pluginId) === 0) return
    this.database.prepare(`INSERT OR IGNORE INTO ${table}(user_id,plugin_id,created_at) VALUES(?,?,?)`).run(userId, pluginId, nowIso())
  }

  async createUser(username: string, email: string, password: string, role: UserRole = 'user'): Promise<StoredUser> {
    const user: StoredUser = {
      id: `usr_${randomUUID()}`, username: username.trim(), email: email.trim().toLowerCase(),
      passwordHash: await passwordHash(password), role, status: 'active', favorites: [], subscriptions: [], createdAt: nowIso(),
    }
    try {
      this.database.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,NULL)').run(
        user.id, user.username, user.email, user.passwordHash, user.role, user.status, user.createdAt,
      )
    } catch (cause) {
      const message = String(cause)
      if (message.includes('users.username')) throw new Error('AUTH_USERNAME_EXISTS')
      if (message.includes('users.email')) throw new Error('AUTH_EMAIL_EXISTS')
      throw cause
    }
    return user
  }

  allowAuthAttempt(key: string, maximum = 12, windowMs = 60_000, blockMs = 5 * 60_000): boolean {
    const row = this.database.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key) as SqlRow | undefined
    const now = Date.now()
    if (row !== undefined && row.blocked_until !== null && Date.parse(String(row.blocked_until)) > now) return false
    if (row === undefined || now - Date.parse(String(row.window_started_at)) >= windowMs) {
      this.database.prepare('INSERT INTO auth_attempts VALUES(?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET attempts=1,window_started_at=excluded.window_started_at,blocked_until=NULL')
        .run(key, 1, nowIso())
      return true
    }
    const attempts = Number(row.attempts) + 1
    const blockedUntil = attempts > maximum ? new Date(now + blockMs).toISOString() : null
    this.database.prepare('UPDATE auth_attempts SET attempts=?,blocked_until=? WHERE key=?').run(attempts, blockedUntil, key)
    return attempts <= maximum
  }

  clearAuthAttempts(key: string): void {
    this.database.prepare('DELETE FROM auth_attempts WHERE key=?').run(key)
  }

  async authenticate(identity: string, password: string): Promise<StoredUser | undefined> {
    const row = this.database.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(identity.trim(), identity.trim()) as SqlRow | undefined
    if (row === undefined || row.status !== 'active' || !await passwordMatches(password, String(row.password_hash))) return undefined
    const at = nowIso()
    this.database.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(at, String(row.id))
    return this.userFromRow({ ...row, last_login_at: at })
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<boolean> {
    const row = this.database.prepare('SELECT password_hash FROM users WHERE id=?').get(userId) as SqlRow | undefined
    if (row === undefined || !await passwordMatches(currentPassword, String(row.password_hash))) return false
    const nextHash = await passwordHash(nextPassword)
    this.transaction(() => {
      this.database.prepare('UPDATE users SET password_hash=? WHERE id=?').run(nextHash, userId)
      this.database.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
    })
    return true
  }

  async createSession(userId: string, context: { ip?: string; userAgent?: string } = {}): Promise<{ token: string; id: string; expiresAt: string }> {
    this.pruneSessions()
    const token = randomBytes(32).toString('base64url')
    const id = `ses_${randomUUID()}`
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const idleExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    this.database.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run(
      id, tokenHash(token), userId, createdAt, createdAt, expiresAt, idleExpiresAt, context.ip ?? null, context.userAgent?.slice(0, 500) ?? null,
    )
    return { token, id, expiresAt }
  }

  sessionUser(token: string | undefined): StoredUser | undefined {
    if (token === undefined) return undefined
    const hash = tokenHash(token)
    const row = this.database.prepare(`SELECT u.*,s.id AS session_id,s.expires_at,s.idle_expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hash) as SqlRow | undefined
    if (row === undefined || row.status !== 'active' || Date.parse(String(row.expires_at)) <= Date.now() || Date.parse(String(row.idle_expires_at)) <= Date.now()) {
      this.database.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash)
      return undefined
    }
    const current = nowIso()
    const idle = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    this.database.prepare('UPDATE sessions SET last_seen_at=?,idle_expires_at=? WHERE token_hash=?').run(current, idle, hash)
    return this.userFromRow(row)
  }

  private pruneSessions(): void {
    const now = nowIso()
    this.database.prepare('DELETE FROM sessions WHERE expires_at<=? OR idle_expires_at<=?').run(now, now)
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (token !== undefined) this.database.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token))
  }

  sessions(userId: string, currentToken?: string): SessionView[] {
    this.pruneSessions()
    const currentHash = currentToken === undefined ? '' : tokenHash(currentToken)
    return (this.database.prepare('SELECT * FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC').all(userId) as SqlRow[]).map(row => ({
      id: String(row.id), createdAt: String(row.created_at), lastSeenAt: String(row.last_seen_at),
      expiresAt: String(row.expires_at), idleExpiresAt: String(row.idle_expires_at),
      ...(row.ip === null ? {} : { ip: String(row.ip) }), ...(row.user_agent === null ? {} : { userAgent: String(row.user_agent) }),
      current: String(row.token_hash) === currentHash,
    }))
  }

  revokeSession(userId: string, sessionId: string): boolean {
    return Number(this.database.prepare('DELETE FROM sessions WHERE user_id=? AND id=?').run(userId, sessionId).changes) > 0
  }

  revokeOtherSessions(userId: string, currentToken: string): number {
    return Number(this.database.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId, tokenHash(currentToken)).changes)
  }

  users(query: { q?: string; role?: string; status?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (query.q) { clauses.push('(username LIKE ? OR email LIKE ?)'); params.push(`%${query.q}%`, `%${query.q}%`) }
    if (query.role) { clauses.push('role=?'); params.push(query.role) }
    if (query.status) { clauses.push('status=?'); params.push(query.status) }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const total = this.scalar(`SELECT COUNT(*) AS value FROM users ${where}`, ...params)
    const rows = this.database.prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => publicUser(this.userFromRow(row))), page, pageSize, total }
  }

  async updateUser(actorId: string, userId: string, update: { role?: UserRole; status?: UserStatus }, context: { ip?: string; requestId?: string } = {}): Promise<StoredUser | undefined> {
    const row = this.database.prepare('SELECT * FROM users WHERE id=?').get(userId) as SqlRow | undefined
    if (row === undefined) return undefined
    const nextRole = update.role ?? String(row.role) as UserRole
    const nextStatus = update.status ?? String(row.status) as UserStatus
    if (row.role === 'admin' && row.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active') && this.adminCount() <= 1) {
      throw new Error('ADMIN_LAST_ADMIN')
    }
    this.transaction(() => {
      this.database.prepare('UPDATE users SET role=?,status=? WHERE id=?').run(nextRole, nextStatus, userId)
      if (nextStatus === 'disabled') this.database.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
      this.audit(actorId, 'user.update', userId, { before: { role: row.role, status: row.status }, after: { role: nextRole, status: nextStatus } }, context)
    })
    return this.userFromRow({ ...row, role: nextRole, status: nextStatus })
  }

  async toggleFavorite(userId: string, pluginId: string): Promise<string[]> { return this.toggleRelation('favorites', userId, pluginId) }
  async toggleSubscription(userId: string, pluginId: string): Promise<string[]> { return this.toggleRelation('subscriptions', userId, pluginId) }

  userRelations(userId: string, relation: 'favorites' | 'subscriptions', query: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    const rows = this.database.prepare(`SELECT rel.plugin_id,rel.created_at FROM ${relation} rel
      JOIN plugins p ON p.id=rel.plugin_id JOIN moderation_decisions m ON m.revision_id=p.published_revision_id
      WHERE rel.user_id=? AND m.status='approved' ORDER BY rel.created_at DESC LIMIT ? OFFSET ?`)
      .all(userId, pageSize, (page - 1) * pageSize) as SqlRow[]
    const total = this.scalar(`SELECT COUNT(*) AS value FROM ${relation} rel
      JOIN plugins p ON p.id=rel.plugin_id JOIN moderation_decisions m ON m.revision_id=p.published_revision_id
      WHERE rel.user_id=? AND m.status='approved'`, userId)
    return {
      items: rows.flatMap(row => {
        const plugin = this.publicPlugin(String(row.plugin_id))
        return plugin === undefined ? [] : [{ plugin, savedAt: String(row.created_at) }]
      }),
      page, pageSize, total,
    }
  }

  private toggleRelation(table: 'favorites' | 'subscriptions', userId: string, pluginId: string): string[] {
    if (!this.isPublicPlugin(pluginId)) throw new Error('CATALOG_PLUGIN_NOT_PUBLIC')
    const exists = this.scalar(`SELECT COUNT(*) AS value FROM ${table} WHERE user_id=? AND plugin_id=?`, userId, pluginId) > 0
    if (exists) this.database.prepare(`DELETE FROM ${table} WHERE user_id=? AND plugin_id=?`).run(userId, pluginId)
    else this.insertRelation(table, userId, pluginId)
    return this.relationIds(table, userId)
  }

  userCollections(userId: string): UserCollection[] {
    return (this.database.prepare('SELECT * FROM collections WHERE owner_id=? ORDER BY updated_at DESC').all(userId) as SqlRow[]).map(row => ({
      id: String(row.id), ownerId: String(row.owner_id), name: String(row.name), description: String(row.description),
      pluginIds: (this.database.prepare('SELECT plugin_id FROM collection_items WHERE collection_id=? ORDER BY position').all(String(row.id)) as SqlRow[]).map(item => String(item.plugin_id)),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
  }

  async createCollection(userId: string, name: string, description: string, pluginIds: string[]): Promise<UserCollection> {
    const at = nowIso()
    const collection: UserCollection = { id: `col_${randomUUID()}`, ownerId: userId, name, description, pluginIds: [...new Set(pluginIds)].filter(id => this.isPublicPlugin(id)).slice(0, 100), createdAt: at, updatedAt: at }
    this.transaction(() => {
      this.database.prepare('INSERT INTO collections VALUES(?,?,?,?,?,?)').run(collection.id, userId, name, description, at, at)
      collection.pluginIds.forEach((pluginId, position) => this.database.prepare('INSERT INTO collection_items VALUES(?,?,?)').run(collection.id, pluginId, position))
    })
    return collection
  }

  async updateCollection(userId: string, collectionId: string, update: { name: string; description: string; pluginIds: string[] }): Promise<UserCollection | undefined> {
    const existing = this.database.prepare('SELECT id FROM collections WHERE id=? AND owner_id=?').get(collectionId, userId) as SqlRow | undefined
    if (existing === undefined) return undefined
    const pluginIds = [...new Set(update.pluginIds)].filter(id => this.isPublicPlugin(id)).slice(0, 100)
    const updatedAt = nowIso()
    this.transaction(() => {
      this.database.prepare('UPDATE collections SET name=?,description=?,updated_at=? WHERE id=? AND owner_id=?').run(
        update.name, update.description, updatedAt, collectionId, userId,
      )
      this.database.prepare('DELETE FROM collection_items WHERE collection_id=?').run(collectionId)
      pluginIds.forEach((pluginId, position) => this.database.prepare('INSERT INTO collection_items VALUES(?,?,?)').run(collectionId, pluginId, position))
    })
    return this.userCollections(userId).find(collection => collection.id === collectionId)
  }

  async deleteCollection(userId: string, collectionId: string): Promise<boolean> {
    return Number(this.database.prepare('DELETE FROM collections WHERE id=? AND owner_id=?').run(collectionId, userId).changes) > 0
  }

  reviews(pluginId: string, query: ReviewQuery = {}) {
    const plugin = this.publicPluginBase(pluginId)
    if (plugin === undefined) return undefined
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const revisionId = plugin.revisionId
    const total = this.scalar('SELECT COUNT(*) AS value FROM reviews WHERE plugin_id=? AND revision_id=?', pluginId, revisionId)
    const aggregate = this.database.prepare('SELECT AVG(rating) AS score FROM reviews WHERE plugin_id=? AND revision_id=?').get(pluginId, revisionId) as SqlRow | undefined
    const rows = this.database.prepare('SELECT * FROM reviews WHERE plugin_id=? AND revision_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(pluginId, revisionId, pageSize, (page - 1) * pageSize) as SqlRow[]
    return {
      summary: { count: total, score: total === 0 ? 0 : Math.round(Number(aggregate?.score ?? 0) * 10) / 10 },
      items: rows.map(row => this.reviewFromRow(row)), page, pageSize, total, revisionId,
    }
  }

  async addReview(userId: string, pluginId: string, rating: number, body: string): Promise<GitHubReview> {
    const plugin = this.publicPluginBase(pluginId)
    if (plugin === undefined) throw new Error('CATALOG_PLUGIN_NOT_PUBLIC')
    const user = this.database.prepare('SELECT username FROM users WHERE id=?').get(userId) as SqlRow
    const existing = this.database.prepare('SELECT id,created_at FROM reviews WHERE revision_id=? AND author_id=?').get(plugin.revisionId, userId) as SqlRow | undefined
    const at = nowIso()
    const review: GitHubReview = {
      id: existing === undefined ? `ghreview_${randomUUID()}` : String(existing.id), pluginId, revisionId: plugin.revisionId,
      authorId: userId, authorName: String(user.username), rating, body,
      createdAt: existing === undefined ? at : String(existing.created_at), updatedAt: at,
    }
    this.database.prepare(`INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(revision_id,author_id) DO UPDATE SET author_name=excluded.author_name,rating=excluded.rating,body=excluded.body,updated_at=excluded.updated_at`).run(
      review.id, pluginId, review.revisionId, userId, review.authorName, rating, body, review.createdAt, review.updatedAt,
    )
    return review
  }

  pluginState(userId: string, pluginId: string) {
    const plugin = this.publicPluginBase(pluginId)
    if (plugin === undefined) return undefined
    const collectionRows = this.database.prepare(`SELECT c.id FROM collections c JOIN collection_items ci ON ci.collection_id=c.id
      WHERE c.owner_id=? AND ci.plugin_id=? ORDER BY c.updated_at DESC`).all(userId, pluginId) as SqlRow[]
    const reviewRow = this.database.prepare('SELECT * FROM reviews WHERE revision_id=? AND author_id=?').get(plugin.revisionId, userId) as SqlRow | undefined
    return {
      pluginId, revisionId: plugin.revisionId,
      favorited: this.scalar('SELECT COUNT(*) AS value FROM favorites WHERE user_id=? AND plugin_id=?', userId, pluginId) > 0,
      subscribed: this.scalar('SELECT COUNT(*) AS value FROM subscriptions WHERE user_id=? AND plugin_id=?', userId, pluginId) > 0,
      collectionIds: collectionRows.map(row => String(row.id)),
      review: reviewRow === undefined ? null : this.reviewFromRow(reviewRow),
    }
  }

  private reviewFromRow(row: SqlRow): GitHubReview {
    return {
      id: String(row.id), pluginId: String(row.plugin_id), revisionId: String(row.revision_id),
      authorId: String(row.author_id), authorName: String(row.author_name), rating: Number(row.rating), body: String(row.body),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  private pluginFromRevision(row: SqlRow): GitHubPluginRecord & { revisionId: string; moderation: PluginModeration; publication: 'published' | 'candidate' } {
    const record = JSON.parse(String(row.record_json)) as GitHubPluginRecord
    const moderation: PluginModeration = {
      revisionId: String(row.revision_id), status: String(row.moderation_status ?? 'pending') as ModerationStatus,
      featured: Number(row.featured ?? 0) === 1, ...(row.reason === null || row.reason === undefined ? {} : { reason: String(row.reason) }),
      updatedAt: String(row.moderation_updated_at ?? record.updatedAt), updatedBy: String(row.updated_by ?? 'system'),
    }
    return { ...record, revisionId: String(row.revision_id), moderation, publication: String(row.published_revision_id) === String(row.revision_id) ? 'published' : 'candidate' }
  }

  private publicPluginBase(pluginId: string) {
    const row = this.database.prepare(`SELECT p.published_revision_id,r.id AS revision_id,r.record_json,
      m.status AS moderation_status,m.featured,m.reason,m.updated_at AS moderation_updated_at,m.updated_by
      FROM plugins p JOIN plugin_revisions r ON r.id=p.published_revision_id
      JOIN moderation_decisions m ON m.revision_id=r.id
      WHERE p.id=? AND m.status='approved'`).get(pluginId) as SqlRow | undefined
    return row === undefined ? undefined : this.pluginFromRevision(row)
  }

  private communityFor(pluginId: string, revisionId: string): PluginCommunity {
    const aggregate = this.database.prepare('SELECT COUNT(*) AS count,AVG(rating) AS score FROM reviews WHERE plugin_id=? AND revision_id=?').get(pluginId, revisionId) as SqlRow | undefined
    const reviewCount = Number(aggregate?.count ?? 0)
    return {
      favoriteCount: this.scalar('SELECT COUNT(*) AS value FROM favorites WHERE plugin_id=?', pluginId),
      subscriptionCount: this.scalar('SELECT COUNT(*) AS value FROM subscriptions WHERE plugin_id=?', pluginId),
      reviewCount,
      reviewScore: reviewCount === 0 ? 0 : Math.round(Number(aggregate?.score ?? 0) * 10) / 10,
    }
  }

  private dependencyViews(plugin: GitHubPluginRecord): PluginDependencyView[] {
    return (plugin.dshDependencies ?? []).map(packageName => {
      const row = this.database.prepare(`SELECT p.published_revision_id,r.id AS revision_id,r.record_json,
        m.status AS moderation_status,m.featured,m.reason,m.updated_at AS moderation_updated_at,m.updated_by
        FROM plugins p JOIN plugin_revisions r ON r.id=p.published_revision_id
        JOIN moderation_decisions m ON m.revision_id=r.id
        WHERE json_extract(r.record_json,'$.packageName')=? AND m.status='approved' LIMIT 1`).get(packageName) as SqlRow | undefined
      if (row === undefined) return { packageName, resolved: false }
      const dependency = this.pluginFromRevision(row)
      return { packageName, resolved: true, pluginId: dependency.id, name: dependency.name }
    })
  }

  private withCommunity<T extends GitHubPluginRecord & { revisionId: string }>(plugin: T) {
    return { ...plugin, community: this.communityFor(plugin.id, plugin.revisionId) }
  }

  private publicFacets() {
    const base = `FROM plugins p JOIN plugin_revisions r ON r.id=p.published_revision_id
      JOIN moderation_decisions m ON m.revision_id=r.id WHERE m.status='approved'`
    const grouped = (expression: string) => (this.database.prepare(`SELECT ${expression} AS value,COUNT(*) AS count ${base} GROUP BY value ORDER BY count DESC,value`).all() as SqlRow[])
      .filter(row => row.value !== null && String(row.value) !== '').map(row => ({ value: String(row.value), count: Number(row.count) }))
    const arrayValues = (path: string) => (this.database.prepare(`SELECT item.value AS value,COUNT(*) AS count
      FROM plugins p JOIN plugin_revisions r ON r.id=p.published_revision_id
      JOIN moderation_decisions m ON m.revision_id=r.id JOIN json_each(r.record_json,?) item
      WHERE m.status='approved' GROUP BY item.value ORDER BY count DESC,item.value`).all(path) as SqlRow[])
      .map(row => ({ value: String(row.value), count: Number(row.count) }))
    return {
      kinds: grouped("json_extract(r.record_json,'$.kind')"),
      authors: grouped("json_extract(r.record_json,'$.author')"),
      languages: grouped("json_extract(r.record_json,'$.language')"),
      licenses: grouped("json_extract(r.record_json,'$.license')"),
      surfaces: arrayValues('$.surfaces'), topics: arrayValues('$.topics'),
    }
  }

  githubSnapshot(admin = false, query: CatalogQuery = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? (admin ? 25 : 100)))
    const revisionColumn = admin ? 'p.latest_revision_id' : 'p.published_revision_id'
    const clauses = admin ? ['1=1'] : ["m.status='approved'", 'p.published_revision_id IS NOT NULL']
    const params: Array<string | number> = []
    if (query.status) { clauses.push('m.status=?'); params.push(query.status) }
    if (query.q) {
      clauses.push(`(p.full_name LIKE ? OR json_extract(r.record_json,'$.name') LIKE ? OR json_extract(r.record_json,'$.description') LIKE ? OR json_extract(r.record_json,'$.packageName') LIKE ?)`)
      params.push(...Array.from({ length: 4 }, () => `%${query.q}%`))
    }
    if (query.kind) { clauses.push("json_extract(r.record_json,'$.kind')=?"); params.push(query.kind) }
    if (query.surface) { clauses.push("EXISTS(SELECT 1 FROM json_each(r.record_json,'$.surfaces') WHERE value=?)"); params.push(query.surface) }
    if (query.topic) { clauses.push("EXISTS(SELECT 1 FROM json_each(r.record_json,'$.topics') WHERE value=?)"); params.push(query.topic) }
    if (query.author) { clauses.push("json_extract(r.record_json,'$.author')=? COLLATE NOCASE"); params.push(query.author) }
    if (query.language) { clauses.push("json_extract(r.record_json,'$.language')=? COLLATE NOCASE"); params.push(query.language) }
    if (query.license) { clauses.push("json_extract(r.record_json,'$.license')=? COLLATE NOCASE"); params.push(query.license) }
    const from = `FROM plugins p JOIN plugin_revisions r ON r.id=${revisionColumn} LEFT JOIN moderation_decisions m ON m.revision_id=r.id WHERE ${clauses.join(' AND ')}`
    const total = this.scalar(`SELECT COUNT(*) AS value ${from}`, ...params)
    const publicOrder: Record<NonNullable<CatalogQuery['sort']>, string> = {
      stars: "json_extract(r.record_json,'$.stars') DESC",
      recent: "json_extract(r.record_json,'$.pushedAt') DESC",
      name: "json_extract(r.record_json,'$.name') COLLATE NOCASE ASC",
      rating: '(SELECT COALESCE(AVG(rv.rating),0) FROM reviews rv WHERE rv.revision_id=r.id) DESC',
      subscriptions: '(SELECT COUNT(*) FROM subscriptions sub WHERE sub.plugin_id=p.id) DESC',
    }
    const order = admin ? "json_extract(r.record_json,'$.stars') DESC" : publicOrder[query.sort ?? 'stars']
    const rows = this.database.prepare(`SELECT p.published_revision_id,r.id AS revision_id,r.record_json,m.status AS moderation_status,m.featured,m.reason,m.updated_at AS moderation_updated_at,m.updated_by ${from} ORDER BY m.featured DESC,${order} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    const items = rows.map(row => {
      const plugin = this.pluginFromRevision(row)
      return admin ? plugin : this.withCommunity(plugin)
    })
    return { syncedAt: this.latestCompletedSyncAt(), items, page, pageSize, total, ...(admin ? {} : { facets: this.publicFacets() }) }
  }

  publicPlugin(pluginId: string) {
    const plugin = this.publicPluginBase(pluginId)
    return plugin === undefined ? undefined : { ...this.withCommunity(plugin), dependencies: this.dependencyViews(plugin) }
  }

  private latestCompletedSyncAt(): string | undefined {
    const row = this.database.prepare("SELECT finished_at FROM sync_runs WHERE status IN ('completed','partially_failed') ORDER BY created_at DESC LIMIT 1").get() as SqlRow | undefined
    return row?.finished_at === undefined || row.finished_at === null ? undefined : String(row.finished_at)
  }

  isPublicPlugin(pluginId: string): boolean {
    return this.scalar(`SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.published_revision_id WHERE p.id=? AND m.status='approved'`, pluginId) > 0
  }

  async ingestVerifiedPlugins(actorId: string, plugins: GitHubPluginRecord[]): Promise<void> {
    this.transaction(() => plugins.filter(plugin => plugin.verification.status === 'verified_bundle').forEach(plugin => this.ingestOne(actorId, plugin)))
  }

  // Backward-compatible entry point used by existing deployment scripts.
  async replaceGitHubPlugins(actorId: string, plugins: GitHubPluginRecord[]): Promise<void> { await this.ingestVerifiedPlugins(actorId, plugins) }

  private ingestOne(actorId: string, plugin: GitHubPluginRecord, legacyModeration?: Omit<PluginModeration, 'revisionId'>): void {
    const revisionId = revisionIdFor(plugin)
    const packagePath = plugin.packagePath ?? plugin.verification.packageJsonPath
    const at = nowIso()
    this.database.prepare(`INSERT INTO plugins(id,full_name,package_path,latest_revision_id,published_revision_id,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,package_path=excluded.package_path,latest_revision_id=excluded.latest_revision_id,updated_at=excluded.updated_at`).run(
      plugin.id, plugin.fullName, packagePath, revisionId, at, at,
    )
    this.database.prepare(`INSERT INTO plugin_revisions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,verification_json=excluded.verification_json,verified_at=excluded.verified_at`).run(
      revisionId, plugin.id, plugin.verification.commitSha, plugin.verification.packageJsonPath, plugin.verification.patchPath,
      JSON.stringify(plugin), JSON.stringify(plugin.verification), plugin.verification.checkedAt,
    )
    const moderation = legacyModeration ?? { status: 'pending' as const, featured: false, updatedAt: at, updatedBy: actorId }
    this.database.prepare('INSERT OR IGNORE INTO moderation_decisions VALUES(?,?,?,?,?,?)').run(
      revisionId, moderation.status, moderation.featured ? 1 : 0, 'reason' in moderation ? moderation.reason ?? null : null, moderation.updatedAt, moderation.updatedBy,
    )
    if (moderation.status === 'approved') this.database.prepare('UPDATE plugins SET published_revision_id=? WHERE id=?').run(revisionId, plugin.id)
  }

  async moderatePlugin(actorId: string, pluginId: string, update: { revisionId?: string; status?: ModerationStatus; featured?: boolean; reason?: string }, context: { ip?: string; requestId?: string } = {}): Promise<boolean> {
    const plugin = this.database.prepare('SELECT * FROM plugins WHERE id=?').get(pluginId) as SqlRow | undefined
    if (plugin === undefined) return false
    const revisionId = update.revisionId ?? String(plugin.latest_revision_id)
    const current = this.database.prepare(`SELECT m.* FROM moderation_decisions m JOIN plugin_revisions r ON r.id=m.revision_id WHERE m.revision_id=? AND r.plugin_id=?`).get(revisionId, pluginId) as SqlRow | undefined
    if (current === undefined) return false
    const status = update.status ?? String(current.status) as ModerationStatus
    const featured = update.featured ?? Number(current.featured) === 1
    const reason = update.reason ?? (current.reason === null ? undefined : String(current.reason))
    this.transaction(() => {
      this.database.prepare('UPDATE moderation_decisions SET status=?,featured=?,reason=?,updated_at=?,updated_by=? WHERE revision_id=?').run(
        status, featured ? 1 : 0, reason ?? null, nowIso(), actorId, revisionId,
      )
      if (status === 'approved') this.database.prepare('UPDATE plugins SET published_revision_id=? WHERE id=?').run(revisionId, pluginId)
      else if (String(plugin.published_revision_id) === revisionId) this.database.prepare('UPDATE plugins SET published_revision_id=NULL WHERE id=?').run(pluginId)
      this.audit(actorId, 'plugin.moderate', pluginId, { revisionId, before: current.status, after: status, reason, featured }, context)
    })
    return true
  }

  summary() {
    return {
      users: this.scalar('SELECT COUNT(*) AS value FROM users'), activeUsers: this.scalar("SELECT COUNT(*) AS value FROM users WHERE status='active'"),
      admins: this.adminCount(), sessions: this.scalar('SELECT COUNT(*) AS value FROM sessions'), plugins: this.pluginCount(),
      approvedPlugins: this.scalar("SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.published_revision_id WHERE m.status='approved'"),
      pendingPlugins: this.scalar("SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.latest_revision_id WHERE m.status='pending'"),
      rejectedPlugins: this.scalar("SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.latest_revision_id WHERE m.status IN ('rejected','hidden')"),
      githubSyncedAt: this.latestCompletedSyncAt() ?? null, latestSync: this.listSyncRuns(1).items[0] ?? null,
      audit: this.auditRecords({ pageSize: 20 }).items,
    }
  }

  createSyncRun(actorId: string, retryOf?: string, context: { ip?: string; requestId?: string } = {}): SyncRun {
    if (this.scalar("SELECT COUNT(*) AS value FROM sync_runs WHERE status IN ('queued','discovering','verifying')") > 0) throw new Error('SYNC_ALREADY_RUNNING')
    const run: SyncRun = { id: `sync_${randomUUID()}`, actorId, status: 'queued', discovered: 0, verified: 0, rejected: 0, failed: 0, ...(retryOf === undefined ? {} : { retryOf }), createdAt: nowIso() }
    this.database.prepare('INSERT INTO sync_runs(id,actor_id,status,discovered,verified,rejected,failed,retry_of,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      run.id, actorId, run.status, 0, 0, 0, 0, retryOf ?? null, run.createdAt,
    )
    this.audit(actorId, 'sync.create', run.id, { retryOf }, context)
    return run
  }

  updateSyncRun(id: string, update: Partial<Omit<SyncRun, 'id' | 'actorId' | 'createdAt'>>): void {
    const entries = Object.entries(update).filter(([, value]) => value !== undefined)
    if (entries.length === 0) return
    const names: Record<string, string> = { githubRemaining: 'github_remaining', githubResetAt: 'github_reset_at', startedAt: 'started_at', finishedAt: 'finished_at' }
    const sets = entries.map(([key]) => `${names[key] ?? key}=?`).join(',')
    this.database.prepare(`UPDATE sync_runs SET ${sets} WHERE id=?`).run(...entries.map(([, value]) => value as string | number), id)
  }

  recordSyncCandidate(runId: string, candidate: SyncCandidateInput): void {
    this.database.prepare(`INSERT INTO sync_candidates VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,repository) DO UPDATE SET commit_sha=excluded.commit_sha,status=excluded.status,bundle_count=excluded.bundle_count,reason=excluded.reason,evidence_json=excluded.evidence_json`).run(
      runId, candidate.repository, candidate.commitSha ?? null, candidate.status, candidate.bundleCount, candidate.reason ?? null, JSON.stringify(candidate.evidence ?? {}),
    )
  }

  syncRun(id: string) {
    const row = this.database.prepare('SELECT * FROM sync_runs WHERE id=?').get(id) as SqlRow | undefined
    if (row === undefined) return undefined
    return { ...this.syncRunFromRow(row), candidates: (this.database.prepare('SELECT * FROM sync_candidates WHERE run_id=? ORDER BY repository').all(id) as SqlRow[]).map(candidate => ({
      repository: String(candidate.repository), commitSha: candidate.commit_sha === null ? undefined : String(candidate.commit_sha), status: String(candidate.status), bundleCount: Number(candidate.bundle_count),
      ...(candidate.reason === null ? {} : { reason: String(candidate.reason) }), evidence: JSON.parse(String(candidate.evidence_json ?? '{}')) as Record<string, unknown>,
    })) }
  }

  listSyncRuns(limit = 20) {
    const rows = this.database.prepare('SELECT * FROM sync_runs ORDER BY created_at DESC LIMIT ?').all(Math.min(100, limit)) as SqlRow[]
    return { items: rows.map(row => this.syncRunFromRow(row)) }
  }

  recoverableSyncRuns(): SyncRun[] {
    return (this.database.prepare("SELECT * FROM sync_runs WHERE status IN ('queued','discovering','verifying') ORDER BY created_at").all() as SqlRow[]).map(row => this.syncRunFromRow(row))
  }

  private syncRunFromRow(row: SqlRow): SyncRun {
    return {
      id: String(row.id), actorId: String(row.actor_id), status: String(row.status) as SyncRunStatus,
      discovered: Number(row.discovered), verified: Number(row.verified), rejected: Number(row.rejected), failed: Number(row.failed),
      ...(row.error === null ? {} : { error: String(row.error) }), ...(row.github_remaining === null ? {} : { githubRemaining: Number(row.github_remaining) }),
      ...(row.github_reset_at === null ? {} : { githubResetAt: String(row.github_reset_at) }), ...(row.retry_of === null ? {} : { retryOf: String(row.retry_of) }),
      createdAt: String(row.created_at), ...(row.started_at === null ? {} : { startedAt: String(row.started_at) }), ...(row.finished_at === null ? {} : { finishedAt: String(row.finished_at) }),
    }
  }

  auditRecords(query: { q?: string; action?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (query.q) { clauses.push('(actor_id LIKE ? OR target LIKE ?)'); params.push(`%${query.q}%`, `%${query.q}%`) }
    if (query.action) { clauses.push('action=?'); params.push(query.action) }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const total = this.scalar(`SELECT COUNT(*) AS value FROM audit_logs ${where}`, ...params)
    const rows = this.database.prepare(`SELECT * FROM audit_logs ${where} ORDER BY at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => ({ id: String(row.id), actorId: String(row.actor_id), action: String(row.action), target: String(row.target), details: JSON.parse(String(row.details_json)), ...(row.ip === null ? {} : { ip: String(row.ip) }), ...(row.request_id === null ? {} : { requestId: String(row.request_id) }), at: String(row.at) } satisfies AuditRecord)), page, pageSize, total }
  }

  private audit(actorId: string, action: string, target: string, details: Record<string, unknown> = {}, context: { ip?: string; requestId?: string } = {}): void {
    this.database.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)').run(
      `audit_${randomUUID()}`, actorId, action, target, JSON.stringify(details), context.ip ?? null, context.requestId ?? null, nowIso(),
    )
  }
}
