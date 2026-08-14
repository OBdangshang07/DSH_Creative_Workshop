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
export type CollectionVisibility = 'private' | 'public'
export type CollectionModerationStatus = 'visible' | 'hidden'
export type DiscussionStatus = 'open' | 'locked' | 'hidden' | 'deleted'
export type ReplyStatus = 'visible' | 'hidden' | 'deleted'
export type ReportStatus = 'pending' | 'resolved' | 'dismissed'
export type RevisionChangeSource = 'declared' | 'github_release' | 'changelog' | 'commit' | 'missing' | 'manual'

export interface RevisionChangeItem {
  type: 'added' | 'changed' | 'fixed' | 'removed' | 'security' | 'other'
  text: string
}

export interface CollectedReleaseNotes {
  version?: string
  title: string
  summary: string
  changes: RevisionChangeItem[]
  breakingChanges: string[]
  sourceType: RevisionChangeSource
  sourceUrl?: string
  collectedAt: string
}

export interface PluginRevisionChange extends CollectedReleaseNotes {
  revisionId: string
  previousRevisionId?: string
  compareUrl?: string
  updatedAt: string
}

export interface WorkshopRelease {
  version: string
  title: string
  summary: string
  changes: RevisionChangeItem[]
  publishedAt: string
}

export interface NotificationPreferences {
  pluginUpdates: boolean
  discussionReplies: boolean
  collectionUpdates: boolean
  platformReleases: boolean
}

export interface SavedSearch {
  id: string
  name: string
  query: Record<string, string>
  createdAt: string
  updatedAt: string
}

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
  visibility: CollectionVisibility
  moderationStatus: CollectionModerationStatus
  ownerName?: string
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface DiscussionThread {
  id: string
  pluginId?: string
  pluginName?: string
  authorId: string
  authorName: string
  title: string
  body: string
  status: DiscussionStatus
  replyCount: number
  createdAt: string
  updatedAt: string
}

export interface DiscussionReply {
  id: string
  threadId: string
  authorId: string
  authorName: string
  body: string
  status: ReplyStatus
  createdAt: string
  updatedAt: string
}

export interface NotificationView {
  id: string
  type: string
  pluginId?: string
  threadId?: string
  payload: Record<string, unknown>
  readAt?: string
  createdAt: string
}

export interface ActivityEvent {
  id: string
  type: string
  pluginId?: string
  collectionId?: string
  threadId?: string
  payload: Record<string, unknown>
  createdAt: string
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
  version?: string
  releaseNotes?: CollectedReleaseNotes
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
  status: 'verified' | 'rejected' | 'failed' | 'deferred'
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
  deferred: number
  bundlesFound: number
  githubAuthenticated: boolean
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
  discussionCount: number
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
        name TEXT NOT NULL, description TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
        moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_status IN ('visible','hidden')),
        published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
    const collectionColumns = (this.database.prepare('PRAGMA table_info(collections)').all() as SqlRow[]).map(row => String(row.name))
    if (!collectionColumns.includes('visibility')) this.database.exec("ALTER TABLE collections ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public'))")
    if (!collectionColumns.includes('moderation_status')) this.database.exec("ALTER TABLE collections ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_status IN ('visible','hidden'))")
    if (!collectionColumns.includes('published_at')) this.database.exec('ALTER TABLE collections ADD COLUMN published_at TEXT')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS discussion_threads(
        id TEXT PRIMARY KEY, plugin_id TEXT REFERENCES plugins(id) ON DELETE SET NULL,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_name TEXT NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','locked','hidden','deleted')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS discussion_threads_updated_idx ON discussion_threads(status,updated_at DESC);
      CREATE INDEX IF NOT EXISTS discussion_threads_plugin_idx ON discussion_threads(plugin_id,updated_at DESC);
      CREATE TABLE IF NOT EXISTS discussion_replies(
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_name TEXT NOT NULL,
        body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('visible','hidden','deleted')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS discussion_replies_thread_idx ON discussion_replies(thread_id,created_at);
      CREATE TABLE IF NOT EXISTS content_reports(
        id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK(target_type IN ('thread','reply','review','collection')),
        target_id TEXT NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','resolved','dismissed')),
        created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, resolution TEXT,
        UNIQUE(reporter_id,target_type,target_id)
      );
      CREATE INDEX IF NOT EXISTS content_reports_status_idx ON content_reports(status,created_at DESC);
      CREATE TABLE IF NOT EXISTS notifications(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL, actor_id TEXT, plugin_id TEXT REFERENCES plugins(id) ON DELETE SET NULL,
        thread_id TEXT REFERENCES discussion_threads(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
        read_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,read_at,created_at DESC);
      CREATE TABLE IF NOT EXISTS activity_events(
        id TEXT PRIMARY KEY, type TEXT NOT NULL, actor_id TEXT,
        plugin_id TEXT REFERENCES plugins(id) ON DELETE SET NULL,
        collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
        thread_id TEXT REFERENCES discussion_threads(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS activity_events_created_idx ON activity_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS presence_snapshots(
        bucket_at TEXT PRIMARY KEY, peak INTEGER NOT NULL, samples INTEGER NOT NULL, total INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO activity_events(id,type,plugin_id,payload_json,dedupe_key,created_at)
        SELECT 'event_backfill_' || replace(r.id,':','_'),'plugin.published',p.id,
               json_object('name',json_extract(r.record_json,'$.name'),'revisionId',r.id),
               'plugin.published:' || r.id,COALESCE(m.updated_at,p.updated_at)
        FROM plugins p JOIN plugin_revisions r ON r.id=p.published_revision_id
        JOIN moderation_decisions m ON m.revision_id=r.id WHERE m.status='approved';
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, datetime('now'));
    `)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS plugin_revision_changes(
        revision_id TEXT PRIMARY KEY REFERENCES plugin_revisions(id) ON DELETE CASCADE,
        previous_revision_id TEXT REFERENCES plugin_revisions(id) ON DELETE SET NULL,
        version TEXT, title TEXT NOT NULL, summary TEXT NOT NULL,
        changes_json TEXT NOT NULL, breaking_changes_json TEXT NOT NULL,
        compare_url TEXT, source_type TEXT NOT NULL, source_url TEXT,
        collected_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS plugin_revision_changes_previous_idx ON plugin_revision_changes(previous_revision_id);
      CREATE TABLE IF NOT EXISTS workshop_releases(
        version TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
        changes_json TEXT NOT NULL, published_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS username_history(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        old_username TEXT NOT NULL COLLATE NOCASE, new_username TEXT NOT NULL COLLATE NOCASE,
        changed_at TEXT NOT NULL, reserved_until TEXT NOT NULL, ip TEXT, request_id TEXT
      );
      CREATE INDEX IF NOT EXISTS username_history_user_idx ON username_history(user_id,changed_at DESC);
      CREATE INDEX IF NOT EXISTS username_history_reserved_idx ON username_history(old_username,reserved_until);
      CREATE TABLE IF NOT EXISTS notification_preferences(
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plugin_updates INTEGER NOT NULL DEFAULT 1,
        discussion_replies INTEGER NOT NULL DEFAULT 1,
        collection_updates INTEGER NOT NULL DEFAULT 1,
        platform_releases INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS discussion_subscriptions(
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, PRIMARY KEY(user_id,thread_id)
      );
      CREATE INDEX IF NOT EXISTS discussion_subscriptions_thread_idx ON discussion_subscriptions(thread_id);
      CREATE TABLE IF NOT EXISTS saved_searches(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, query_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS saved_searches_user_idx ON saved_searches(user_id,updated_at DESC);
      INSERT OR IGNORE INTO plugin_revision_changes(
        revision_id,previous_revision_id,version,title,summary,changes_json,breaking_changes_json,
        compare_url,source_type,source_url,collected_at,updated_at
      ) SELECT r.id,NULL,json_extract(r.record_json,'$.version'),
        COALESCE(json_extract(r.record_json,'$.name'),'插件') || ' 更新',
        '作者未提供更新日志。','[]','[]',NULL,'missing',NULL,r.verified_at,r.verified_at
        FROM plugin_revisions r;
      UPDATE activity_events SET payload_json=json_set(
        payload_json,'$.commitSha',(SELECT commit_sha FROM plugin_revisions WHERE id=json_extract(payload_json,'$.revisionId')),
        '$.release',json((SELECT json_object(
          'revisionId',c.revision_id,'previousRevisionId',c.previous_revision_id,'version',c.version,'title',c.title,'summary',c.summary,
          'changes',json(c.changes_json),'breakingChanges',json(c.breaking_changes_json),'compareUrl',c.compare_url,
          'sourceType',c.source_type,'sourceUrl',c.source_url,'collectedAt',c.collected_at,'updatedAt',c.updated_at
        ) FROM plugin_revision_changes c WHERE c.revision_id=json_extract(payload_json,'$.revisionId')))
      ) WHERE type='plugin.published' AND json_type(payload_json,'$.release') IS NULL;
      INSERT OR IGNORE INTO discussion_subscriptions(user_id,thread_id,created_at)
        SELECT author_id,id,created_at FROM discussion_threads;
      INSERT OR IGNORE INTO discussion_subscriptions(user_id,thread_id,created_at)
        SELECT author_id,thread_id,MIN(created_at) FROM discussion_replies GROUP BY author_id,thread_id;
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(4, datetime('now'));
    `)
    const syncRunColumns = (this.database.prepare('PRAGMA table_info(sync_runs)').all() as SqlRow[]).map(row => String(row.name))
    if (!syncRunColumns.includes('deferred')) this.database.exec('ALTER TABLE sync_runs ADD COLUMN deferred INTEGER NOT NULL DEFAULT 0')
    if (!syncRunColumns.includes('bundles_found')) this.database.exec('ALTER TABLE sync_runs ADD COLUMN bundles_found INTEGER NOT NULL DEFAULT 0')
    if (!syncRunColumns.includes('github_authenticated')) this.database.exec('ALTER TABLE sync_runs ADD COLUMN github_authenticated INTEGER NOT NULL DEFAULT 0')
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS sync_candidates_status_idx ON sync_candidates(run_id,status);
      UPDATE sync_runs SET
        bundles_found=COALESCE((SELECT SUM(bundle_count) FROM sync_candidates WHERE run_id=sync_runs.id),0),
        deferred=COALESCE((SELECT COUNT(*) FROM sync_candidates WHERE run_id=sync_runs.id AND status='deferred'),0)
      WHERE NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(5, datetime('now'));
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
        this.database.prepare(`INSERT OR IGNORE INTO collections(
          id,owner_id,name,description,visibility,moderation_status,published_at,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
          collection.id, collection.ownerId, collection.name, collection.description,
          collection.visibility ?? 'private', collection.moderationStatus ?? 'visible', collection.publishedAt ?? null,
          collection.createdAt, collection.updatedAt,
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
    const normalizedUsername = username.trim()
    const reserved = this.scalar('SELECT COUNT(*) AS value FROM username_history WHERE old_username=? COLLATE NOCASE AND reserved_until>?', normalizedUsername, nowIso()) > 0
    if (reserved) throw new Error('AUTH_USERNAME_RESERVED')
    const user: StoredUser = {
      id: `usr_${randomUUID()}`, username: normalizedUsername, email: email.trim().toLowerCase(),
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

  usernameProfile(userId: string) {
    const user = this.database.prepare('SELECT username FROM users WHERE id=?').get(userId) as SqlRow | undefined
    if (user === undefined) return undefined
    const latest = this.database.prepare('SELECT changed_at FROM username_history WHERE user_id=? ORDER BY changed_at DESC LIMIT 1').get(userId) as SqlRow | undefined
    const nextChangeAt = latest === undefined ? undefined : new Date(Date.parse(String(latest.changed_at)) + 30 * 24 * 60 * 60 * 1000).toISOString()
    const history = (this.database.prepare('SELECT old_username,new_username,changed_at,reserved_until FROM username_history WHERE user_id=? ORDER BY changed_at DESC LIMIT 10').all(userId) as SqlRow[]).map(row => ({
      oldUsername: String(row.old_username), newUsername: String(row.new_username), changedAt: String(row.changed_at), reservedUntil: String(row.reserved_until),
    }))
    return { username: String(user.username), ...(nextChangeAt === undefined ? {} : { nextChangeAt }), history }
  }

  async changeUsername(userId: string, currentPassword: string, nextUsername: string, context: { ip?: string; requestId?: string } = {}): Promise<StoredUser> {
    const row = this.database.prepare('SELECT * FROM users WHERE id=?').get(userId) as SqlRow | undefined
    if (row === undefined || !await passwordMatches(currentPassword, String(row.password_hash))) throw new Error('AUTH_CURRENT_PASSWORD_INVALID')
    const normalized = nextUsername.trim()
    if (String(row.username).toLowerCase() === normalized.toLowerCase()) throw new Error('AUTH_USERNAME_UNCHANGED')
    const latest = this.database.prepare('SELECT changed_at FROM username_history WHERE user_id=? ORDER BY changed_at DESC LIMIT 1').get(userId) as SqlRow | undefined
    if (latest !== undefined) {
      const nextChangeAt = new Date(Date.parse(String(latest.changed_at)) + 30 * 24 * 60 * 60 * 1000)
      if (nextChangeAt.getTime() > Date.now()) throw new Error(`AUTH_USERNAME_COOLDOWN:${nextChangeAt.toISOString()}`)
    }
    if (this.scalar('SELECT COUNT(*) AS value FROM users WHERE username=? COLLATE NOCASE AND id<>?', normalized, userId) > 0) throw new Error('AUTH_USERNAME_EXISTS')
    if (this.scalar('SELECT COUNT(*) AS value FROM username_history WHERE old_username=? COLLATE NOCASE AND reserved_until>? AND user_id<>?', normalized, nowIso(), userId) > 0) throw new Error('AUTH_USERNAME_RESERVED')
    const changedAt = nowIso()
    const reservedUntil = new Date(Date.parse(changedAt) + 90 * 24 * 60 * 60 * 1000).toISOString()
    this.transaction(() => {
      this.database.prepare('UPDATE users SET username=? WHERE id=?').run(normalized, userId)
      this.database.prepare(`INSERT INTO username_history(
        id,user_id,old_username,new_username,changed_at,reserved_until,ip,request_id
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        `username_${randomUUID()}`, userId, String(row.username), normalized, changedAt, reservedUntil, context.ip ?? null, context.requestId ?? null,
      )
      this.audit(userId, 'user.username.change', userId, { before: row.username, after: normalized, reservedUntil }, context)
    })
    return this.userFromRow({ ...row, username: normalized })
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

  notificationPreferences(userId: string): NotificationPreferences {
    const row = this.database.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(userId) as SqlRow | undefined
    if (row === undefined) return { pluginUpdates: true, discussionReplies: true, collectionUpdates: true, platformReleases: true }
    return {
      pluginUpdates: Number(row.plugin_updates) === 1,
      discussionReplies: Number(row.discussion_replies) === 1,
      collectionUpdates: Number(row.collection_updates) === 1,
      platformReleases: Number(row.platform_releases) === 1,
    }
  }

  updateNotificationPreferences(userId: string, preferences: NotificationPreferences): NotificationPreferences {
    this.database.prepare(`INSERT INTO notification_preferences(
      user_id,plugin_updates,discussion_replies,collection_updates,platform_releases,updated_at
    ) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      plugin_updates=excluded.plugin_updates,discussion_replies=excluded.discussion_replies,
      collection_updates=excluded.collection_updates,platform_releases=excluded.platform_releases,updated_at=excluded.updated_at`).run(
      userId, preferences.pluginUpdates ? 1 : 0, preferences.discussionReplies ? 1 : 0,
      preferences.collectionUpdates ? 1 : 0, preferences.platformReleases ? 1 : 0, nowIso(),
    )
    return preferences
  }

  savedSearches(userId: string): SavedSearch[] {
    return (this.database.prepare('SELECT * FROM saved_searches WHERE user_id=? ORDER BY updated_at DESC').all(userId) as SqlRow[]).map(row => ({
      id: String(row.id), name: String(row.name), query: JSON.parse(String(row.query_json)) as Record<string, string>,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
  }

  createSavedSearch(userId: string, name: string, query: Record<string, string>): SavedSearch {
    const at = nowIso()
    const item: SavedSearch = { id: `search_${randomUUID()}`, name, query, createdAt: at, updatedAt: at }
    this.database.prepare('INSERT INTO saved_searches VALUES(?,?,?,?,?,?)').run(item.id, userId, name, JSON.stringify(query), at, at)
    return item
  }

  deleteSavedSearch(userId: string, searchId: string): boolean {
    return Number(this.database.prepare('DELETE FROM saved_searches WHERE id=? AND user_id=?').run(searchId, userId).changes) > 0
  }

  userCollections(userId: string): UserCollection[] {
    return (this.database.prepare(`SELECT c.*,u.username AS owner_name FROM collections c JOIN users u ON u.id=c.owner_id
      WHERE c.owner_id=? ORDER BY c.updated_at DESC`).all(userId) as SqlRow[]).map(row => this.collectionFromRow(row))
  }

  publicCollections(query: { q?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20))
    const search = query.q?.trim()
    const where = search ? "AND (c.name LIKE ? OR c.description LIKE ? OR u.username LIKE ?)" : ''
    const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    const total = this.scalar(`SELECT COUNT(*) AS value FROM collections c JOIN users u ON u.id=c.owner_id
      WHERE c.visibility='public' AND c.moderation_status='visible' ${where}`, ...params)
    const rows = this.database.prepare(`SELECT c.*,u.username AS owner_name FROM collections c JOIN users u ON u.id=c.owner_id
      WHERE c.visibility='public' AND c.moderation_status='visible' ${where}
      ORDER BY c.published_at DESC,c.updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => this.collectionWithPlugins(row)), page, pageSize, total }
  }

  publicCollection(collectionId: string) {
    const row = this.database.prepare(`SELECT c.*,u.username AS owner_name FROM collections c JOIN users u ON u.id=c.owner_id
      WHERE c.id=? AND c.visibility='public' AND c.moderation_status='visible'`).get(collectionId) as SqlRow | undefined
    return row === undefined ? undefined : this.collectionWithPlugins(row)
  }

  async createCollection(userId: string, name: string, description: string, pluginIds: string[], visibility: CollectionVisibility = 'private'): Promise<UserCollection> {
    const at = nowIso()
    const collection: UserCollection = {
      id: `col_${randomUUID()}`, ownerId: userId, name, description,
      pluginIds: [...new Set(pluginIds)].filter(id => this.isPublicPlugin(id)).slice(0, 100),
      visibility, moderationStatus: 'visible', ...(visibility === 'public' ? { publishedAt: at } : {}), createdAt: at, updatedAt: at,
    }
    this.transaction(() => {
      this.database.prepare(`INSERT INTO collections(
        id,owner_id,name,description,visibility,moderation_status,published_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        collection.id, userId, name, description, visibility, 'visible', collection.publishedAt ?? null, at, at,
      )
      collection.pluginIds.forEach((pluginId, position) => this.database.prepare('INSERT INTO collection_items VALUES(?,?,?)').run(collection.id, pluginId, position))
      if (visibility === 'public') this.activity('collection.published', `collection.published:${collection.id}:${at}`, { name }, { actorId: userId, collectionId: collection.id }, at)
    })
    return this.userCollections(userId).find(item => item.id === collection.id)!
  }

  async updateCollection(userId: string, collectionId: string, update: { name: string; description: string; pluginIds: string[]; visibility: CollectionVisibility }): Promise<UserCollection | undefined> {
    const existing = this.database.prepare('SELECT * FROM collections WHERE id=? AND owner_id=?').get(collectionId, userId) as SqlRow | undefined
    if (existing === undefined) return undefined
    const pluginIds = [...new Set(update.pluginIds)].filter(id => this.isPublicPlugin(id)).slice(0, 100)
    const updatedAt = nowIso()
    const publishedAt = update.visibility === 'public' ? String(existing.published_at ?? updatedAt) : null
    this.transaction(() => {
      this.database.prepare('UPDATE collections SET name=?,description=?,visibility=?,published_at=?,updated_at=? WHERE id=? AND owner_id=?').run(
        update.name, update.description, update.visibility, publishedAt, updatedAt, collectionId, userId,
      )
      this.database.prepare('DELETE FROM collection_items WHERE collection_id=?').run(collectionId)
      pluginIds.forEach((pluginId, position) => this.database.prepare('INSERT INTO collection_items VALUES(?,?,?)').run(collectionId, pluginId, position))
      if (String(existing.visibility) !== 'public' && update.visibility === 'public') {
        this.activity('collection.published', `collection.published:${collectionId}:${publishedAt}`, { name: update.name }, { actorId: userId, collectionId }, updatedAt)
      }
    })
    return this.userCollections(userId).find(collection => collection.id === collectionId)
  }

  async cloneCollection(userId: string, collectionId: string): Promise<UserCollection | undefined> {
    const source = this.publicCollection(collectionId)
    if (source === undefined) return undefined
    return this.createCollection(userId, `${source.name}（副本）`.slice(0, 80), source.description, source.pluginIds, 'private')
  }

  async moderateCollection(actorId: string, collectionId: string, status: CollectionModerationStatus, reason: string, context: { ip?: string; requestId?: string } = {}): Promise<boolean> {
    const row = this.database.prepare('SELECT moderation_status,owner_id,name FROM collections WHERE id=?').get(collectionId) as SqlRow | undefined
    if (row === undefined) return false
    this.transaction(() => {
      this.database.prepare('UPDATE collections SET moderation_status=?,updated_at=? WHERE id=?').run(status, nowIso(), collectionId)
      if (String(row.owner_id) !== actorId) this.notify(
        String(row.owner_id), 'collection.updated', `collection.updated:${collectionId}:${status}:${String(row.owner_id)}`,
        { collectionId, name: String(row.name), status, reason }, { actorId },
      )
      this.audit(actorId, 'collection.moderate', collectionId, { before: row.moderation_status, after: status, reason }, context)
    })
    return true
  }

  async deleteCollection(userId: string, collectionId: string): Promise<boolean> {
    return Number(this.database.prepare('DELETE FROM collections WHERE id=? AND owner_id=?').run(collectionId, userId).changes) > 0
  }

  private collectionFromRow(row: SqlRow): UserCollection {
    return {
      id: String(row.id), ownerId: String(row.owner_id), name: String(row.name), description: String(row.description),
      pluginIds: (this.database.prepare('SELECT plugin_id FROM collection_items WHERE collection_id=? ORDER BY position').all(String(row.id)) as SqlRow[]).map(item => String(item.plugin_id)),
      visibility: String(row.visibility) as CollectionVisibility,
      moderationStatus: String(row.moderation_status) as CollectionModerationStatus,
      ...(row.owner_name === null || row.owner_name === undefined ? {} : { ownerName: String(row.owner_name) }),
      ...(row.published_at === null || row.published_at === undefined ? {} : { publishedAt: String(row.published_at) }),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  private collectionWithPlugins(row: SqlRow) {
    const collection = this.collectionFromRow(row)
    return { ...collection, plugins: collection.pluginIds.flatMap(id => { const plugin = this.publicPlugin(id); return plugin === undefined ? [] : [plugin] }) }
  }

  reviews(pluginId: string, query: ReviewQuery = {}) {
    const plugin = this.publicPluginBase(pluginId)
    if (plugin === undefined) return undefined
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const revisionId = plugin.revisionId
    const total = this.scalar('SELECT COUNT(*) AS value FROM reviews WHERE plugin_id=? AND revision_id=?', pluginId, revisionId)
    const aggregate = this.database.prepare('SELECT AVG(rating) AS score FROM reviews WHERE plugin_id=? AND revision_id=?').get(pluginId, revisionId) as SqlRow | undefined
    const rows = this.database.prepare(`SELECT rv.*,u.username AS current_author_name FROM reviews rv JOIN users u ON u.id=rv.author_id
      WHERE rv.plugin_id=? AND rv.revision_id=? ORDER BY rv.updated_at DESC LIMIT ? OFFSET ?`)
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

  recentReviews(query: ReviewQuery = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const base = `FROM reviews rv JOIN users u ON u.id=rv.author_id JOIN plugins p ON p.id=rv.plugin_id AND p.published_revision_id=rv.revision_id
      JOIN plugin_revisions pr ON pr.id=rv.revision_id JOIN moderation_decisions m ON m.revision_id=rv.revision_id
      WHERE m.status='approved'`
    const total = this.scalar(`SELECT COUNT(*) AS value ${base}`)
    const rows = this.database.prepare(`SELECT rv.*,u.username AS current_author_name,json_extract(pr.record_json,'$.name') AS plugin_name ${base}
      ORDER BY rv.updated_at DESC LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize) as SqlRow[]
    return {
      items: rows.map(row => ({ ...this.reviewFromRow(row), pluginName: String(row.plugin_name) })),
      page, pageSize, total,
    }
  }

  discussionThreads(query: { q?: string; pluginId?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const clauses = ["t.status IN ('open','locked')", `(t.plugin_id IS NULL OR EXISTS(
      SELECT 1 FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.published_revision_id
      WHERE p.id=t.plugin_id AND m.status='approved'))`]
    const params: Array<string | number> = []
    if (query.q?.trim()) { clauses.push('(t.title LIKE ? OR t.body LIKE ? OR u.username LIKE ?)'); params.push(...Array.from({ length: 3 }, () => `%${query.q!.trim()}%`)) }
    if (query.pluginId) { clauses.push('t.plugin_id=?'); params.push(query.pluginId) }
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = this.scalar(`SELECT COUNT(*) AS value FROM discussion_threads t ${where}`, ...params)
    const rows = this.database.prepare(`SELECT t.*,u.username AS current_author_name,
      CASE WHEN t.plugin_id IS NULL THEN NULL ELSE json_extract(pr.record_json,'$.name') END AS plugin_name,
      (SELECT COUNT(*) FROM discussion_replies r WHERE r.thread_id=t.id AND r.status IN ('visible','deleted')) AS reply_count
      FROM discussion_threads t JOIN users u ON u.id=t.author_id LEFT JOIN plugins p ON p.id=t.plugin_id
      LEFT JOIN plugin_revisions pr ON pr.id=p.published_revision_id ${where}
      ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => this.discussionFromRow(row)), page, pageSize, total }
  }

  discussionThread(threadId: string): DiscussionThread | undefined {
    const row = this.database.prepare(`SELECT t.*,u.username AS current_author_name,
      CASE WHEN t.plugin_id IS NULL THEN NULL ELSE json_extract(pr.record_json,'$.name') END AS plugin_name,
      (SELECT COUNT(*) FROM discussion_replies r WHERE r.thread_id=t.id AND r.status IN ('visible','deleted')) AS reply_count
      FROM discussion_threads t JOIN users u ON u.id=t.author_id LEFT JOIN plugins p ON p.id=t.plugin_id
      LEFT JOIN plugin_revisions pr ON pr.id=p.published_revision_id
      WHERE t.id=? AND t.status IN ('open','locked') AND (t.plugin_id IS NULL OR EXISTS(
        SELECT 1 FROM moderation_decisions m WHERE m.revision_id=p.published_revision_id AND m.status='approved'))`).get(threadId) as SqlRow | undefined
    return row === undefined ? undefined : this.discussionFromRow(row)
  }

  async createDiscussion(userId: string, title: string, body: string, pluginId?: string): Promise<DiscussionThread> {
    if (pluginId !== undefined && !this.isPublicPlugin(pluginId)) throw new Error('CATALOG_PLUGIN_NOT_PUBLIC')
    const user = this.database.prepare('SELECT username FROM users WHERE id=?').get(userId) as SqlRow
    const at = nowIso()
    const id = `thread_${randomUUID()}`
    this.transaction(() => {
      this.database.prepare('INSERT INTO discussion_threads VALUES(?,?,?,?,?,?,?,?,?)').run(
        id, pluginId ?? null, userId, String(user.username), title, body, 'open', at, at,
      )
      this.database.prepare('INSERT INTO discussion_subscriptions(user_id,thread_id,created_at) VALUES(?,?,?)').run(userId, id, at)
      this.activity('discussion.created', `discussion.created:${id}`, { title }, { actorId: userId, ...(pluginId === undefined ? {} : { pluginId }), threadId: id }, at)
    })
    return this.discussionThread(id)!
  }

  discussionReplies(threadId: string, query: { page?: number; pageSize?: number } = {}) {
    if (this.discussionThread(threadId) === undefined) return undefined
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 30))
    const total = this.scalar("SELECT COUNT(*) AS value FROM discussion_replies WHERE thread_id=? AND status IN ('visible','deleted')", threadId)
    const rows = this.database.prepare(`SELECT r.*,u.username AS current_author_name FROM discussion_replies r JOIN users u ON u.id=r.author_id
      WHERE r.thread_id=? AND r.status IN ('visible','deleted') ORDER BY r.created_at LIMIT ? OFFSET ?`).all(threadId, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => this.replyFromRow(row)), page, pageSize, total }
  }

  async createDiscussionReply(userId: string, threadId: string, body: string): Promise<DiscussionReply> {
    const thread = this.discussionThread(threadId)
    if (thread === undefined) throw new Error('DISCUSSION_NOT_FOUND')
    if (thread.status === 'locked') throw new Error('DISCUSSION_LOCKED')
    const user = this.database.prepare('SELECT username FROM users WHERE id=?').get(userId) as SqlRow
    const at = nowIso()
    const id = `reply_${randomUUID()}`
    this.transaction(() => {
      this.database.prepare('INSERT INTO discussion_replies VALUES(?,?,?,?,?,?,?,?)').run(
        id, threadId, userId, String(user.username), body, 'visible', at, at,
      )
      this.database.prepare('UPDATE discussion_threads SET updated_at=? WHERE id=?').run(at, threadId)
      this.database.prepare('INSERT OR IGNORE INTO discussion_subscriptions(user_id,thread_id,created_at) VALUES(?,?,?)').run(userId, threadId, at)
      const subscribers = this.database.prepare('SELECT user_id FROM discussion_subscriptions WHERE thread_id=? AND user_id<>?').all(threadId, userId) as SqlRow[]
      for (const subscriber of subscribers) this.notify(
        String(subscriber.user_id), 'discussion.reply', `discussion.reply:${id}:${String(subscriber.user_id)}`,
        { threadTitle: thread.title, authorName: String(user.username), replyId: id },
        { actorId: userId, ...(thread.pluginId === undefined ? {} : { pluginId: thread.pluginId }), threadId }, at,
      )
    })
    return this.replyFromRow(this.database.prepare(`SELECT r.*,u.username AS current_author_name FROM discussion_replies r
      JOIN users u ON u.id=r.author_id WHERE r.id=?`).get(id) as SqlRow)
  }

  discussionSubscription(userId: string, threadId: string): boolean {
    return this.scalar('SELECT COUNT(*) AS value FROM discussion_subscriptions WHERE user_id=? AND thread_id=?', userId, threadId) > 0
  }

  setDiscussionSubscription(userId: string, threadId: string, subscribed: boolean): boolean {
    if (this.discussionThread(threadId) === undefined) throw new Error('DISCUSSION_NOT_FOUND')
    if (subscribed) this.database.prepare('INSERT OR IGNORE INTO discussion_subscriptions(user_id,thread_id,created_at) VALUES(?,?,?)').run(userId, threadId, nowIso())
    else this.database.prepare('DELETE FROM discussion_subscriptions WHERE user_id=? AND thread_id=?').run(userId, threadId)
    return subscribed
  }

  async deleteDiscussionContent(userId: string, type: 'thread' | 'reply', id: string): Promise<boolean> {
    const table = type === 'thread' ? 'discussion_threads' : 'discussion_replies'
    const row = this.database.prepare(`SELECT author_id FROM ${table} WHERE id=?`).get(id) as SqlRow | undefined
    if (row === undefined || String(row.author_id) !== userId) return false
    const status = 'deleted'
    return Number(this.database.prepare(`UPDATE ${table} SET status=?,body='',updated_at=? WHERE id=? AND author_id=?`).run(status, nowIso(), id, userId).changes) > 0
  }

  async createReport(userId: string, targetType: 'thread' | 'reply' | 'review' | 'collection', targetId: string, reason: string): Promise<boolean> {
    if (!this.reportTargetExists(targetType, targetId)) throw new Error('REPORT_TARGET_NOT_FOUND')
    const result = this.database.prepare(`INSERT OR IGNORE INTO content_reports(
      id,reporter_id,target_type,target_id,reason,status,created_at
    ) VALUES(?,?,?,?,?,'pending',?)`).run(`report_${randomUUID()}`, userId, targetType, targetId, reason, nowIso())
    return Number(result.changes) > 0
  }

  notifications(userId: string, query: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    const total = this.scalar('SELECT COUNT(*) AS value FROM notifications WHERE user_id=?', userId)
    const unread = this.scalar('SELECT COUNT(*) AS value FROM notifications WHERE user_id=? AND read_at IS NULL', userId)
    const rows = this.database.prepare(`SELECT n.*,u.username AS current_actor_name FROM notifications n
      LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT ? OFFSET ?`)
      .all(userId, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => this.notificationFromRow(row)), page, pageSize, total, unread }
  }

  markNotificationsRead(userId: string, ids?: string[]): number {
    const at = nowIso()
    if (ids === undefined || ids.length === 0) return Number(this.database.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(at, userId).changes)
    const selected = [...new Set(ids)].slice(0, 100)
    if (selected.length === 0) return 0
    const placeholders = selected.map(() => '?').join(',')
    return Number(this.database.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND id IN (${placeholders}) AND read_at IS NULL`).run(at, userId, ...selected).changes)
  }

  activityFeed(query: { category?: 'plugin' | 'platform' | 'discussion' | 'collection'; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    const categoryTypes = { plugin: 'plugin.published', platform: 'workshop.release.published', discussion: 'discussion.created', collection: 'collection.published' } as const
    const category = query.category === undefined ? '' : ' AND type=?'
    const params = query.category === undefined ? [] : [categoryTypes[query.category]]
    const visible = `WHERE (thread_id IS NULL OR EXISTS(
        SELECT 1 FROM discussion_threads t WHERE t.id=activity_events.thread_id AND t.status IN ('open','locked')
      )) AND (collection_id IS NULL OR EXISTS(
        SELECT 1 FROM collections c WHERE c.id=activity_events.collection_id AND c.visibility='public' AND c.moderation_status='visible'
      )) AND (plugin_id IS NULL OR EXISTS(
        SELECT 1 FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.published_revision_id
        WHERE p.id=activity_events.plugin_id AND m.status='approved'
       ))${category}`
    const total = this.scalar(`SELECT COUNT(*) AS value FROM activity_events ${visible}`, ...params)
    const rows = this.database.prepare(`SELECT * FROM activity_events ${visible} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => this.activityFromRow(row)), page, pageSize, total }
  }

  recordPresenceSnapshot(online: number, at = new Date()): void {
    const bucket = new Date(Math.floor(at.getTime() / 300_000) * 300_000).toISOString()
    this.database.prepare(`INSERT INTO presence_snapshots(bucket_at,peak,samples,total) VALUES(?,?,1,?)
      ON CONFLICT(bucket_at) DO UPDATE SET peak=MAX(peak,excluded.peak),samples=samples+1,total=total+excluded.total`).run(bucket, online, online)
    this.database.prepare("DELETE FROM presence_snapshots WHERE bucket_at < datetime('now','-8 days')").run()
  }

  presenceHistory() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const rows = this.database.prepare('SELECT * FROM presence_snapshots WHERE bucket_at>=? ORDER BY bucket_at').all(since) as SqlRow[]
    return {
      peak24h: rows.reduce((peak, row) => Math.max(peak, Number(row.peak)), 0),
      buckets: rows.map(row => ({ at: String(row.bucket_at), peak: Number(row.peak), average: Number(row.samples) === 0 ? 0 : Math.round(Number(row.total) / Number(row.samples)) })),
    }
  }

  private discussionFromRow(row: SqlRow): DiscussionThread {
    return {
      id: String(row.id), ...(row.plugin_id === null ? {} : { pluginId: String(row.plugin_id) }),
      ...(row.plugin_name === null || row.plugin_name === undefined ? {} : { pluginName: String(row.plugin_name) }),
      authorId: String(row.author_id), authorName: String(row.current_author_name ?? row.author_name), title: String(row.title), body: String(row.body),
      status: String(row.status) as DiscussionStatus, replyCount: Number(row.reply_count ?? 0),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  private replyFromRow(row: SqlRow): DiscussionReply {
    const status = String(row.status) as ReplyStatus
    return {
      id: String(row.id), threadId: String(row.thread_id), authorId: String(row.author_id), authorName: String(row.current_author_name ?? row.author_name),
      body: status === 'deleted' ? '' : String(row.body), status, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  private notificationFromRow(row: SqlRow): NotificationView {
    return {
      id: String(row.id), type: String(row.type),
      ...(row.plugin_id === null ? {} : { pluginId: String(row.plugin_id) }),
      ...(row.thread_id === null ? {} : { threadId: String(row.thread_id) }),
      payload: {
        ...JSON.parse(String(row.payload_json)) as Record<string, unknown>,
        ...(row.current_actor_name === null || row.current_actor_name === undefined ? {} : { authorName: String(row.current_actor_name) }),
      },
      ...(row.read_at === null ? {} : { readAt: String(row.read_at) }), createdAt: String(row.created_at),
    }
  }

  private activityFromRow(row: SqlRow): ActivityEvent {
    return {
      id: String(row.id), type: String(row.type),
      ...(row.plugin_id === null ? {} : { pluginId: String(row.plugin_id) }),
      ...(row.collection_id === null ? {} : { collectionId: String(row.collection_id) }),
      ...(row.thread_id === null ? {} : { threadId: String(row.thread_id) }),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>, createdAt: String(row.created_at),
    }
  }

  pluginState(userId: string, pluginId: string) {
    const plugin = this.publicPluginBase(pluginId)
    if (plugin === undefined) return undefined
    const collectionRows = this.database.prepare(`SELECT c.id FROM collections c JOIN collection_items ci ON ci.collection_id=c.id
      WHERE c.owner_id=? AND ci.plugin_id=? ORDER BY c.updated_at DESC`).all(userId, pluginId) as SqlRow[]
    const reviewRow = this.database.prepare(`SELECT rv.*,u.username AS current_author_name FROM reviews rv JOIN users u ON u.id=rv.author_id
      WHERE rv.revision_id=? AND rv.author_id=?`).get(plugin.revisionId, userId) as SqlRow | undefined
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
      authorId: String(row.author_id), authorName: String(row.current_author_name ?? row.author_name), rating: Number(row.rating), body: String(row.body),
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
      discussionCount: this.scalar("SELECT COUNT(*) AS value FROM discussion_threads WHERE plugin_id=? AND status IN ('open','locked')", pluginId),
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
      return admin ? { ...plugin, release: this.revisionChange(plugin.revisionId) } : this.withCommunity(plugin)
    })
    return { syncedAt: this.latestCompletedSyncAt(), items, page, pageSize, total, ...(admin ? {} : { facets: this.publicFacets() }) }
  }

  publicPlugin(pluginId: string) {
    const plugin = this.publicPluginBase(pluginId)
    return plugin === undefined ? undefined : {
      ...this.withCommunity(plugin), dependencies: this.dependencyViews(plugin),
      release: this.revisionChange(plugin.revisionId),
    }
  }

  pluginRevisions(pluginId: string) {
    if (!this.isPublicPlugin(pluginId)) return undefined
    const rows = this.database.prepare(`SELECT r.*,m.updated_at AS published_at FROM plugin_revisions r
      JOIN moderation_decisions m ON m.revision_id=r.id
      WHERE r.plugin_id=? AND m.status='approved' ORDER BY m.updated_at DESC`).all(pluginId) as SqlRow[]
    return rows.map(row => {
      const record = JSON.parse(String(row.record_json)) as GitHubPluginRecord
      return {
        revisionId: String(row.id), version: record.version ?? null, commitSha: String(row.commit_sha),
        packageJsonPath: String(row.package_json_path), publishedAt: String(row.published_at),
        verifiedAt: String(row.verified_at), release: this.revisionChange(String(row.id)),
      }
    })
  }

  pluginRevision(pluginId: string, revisionId: string, admin = false) {
    const statusClause = admin ? '' : "AND m.status='approved'"
    const row = this.database.prepare(`SELECT r.*,m.status AS moderation_status,m.updated_at AS published_at
      FROM plugin_revisions r JOIN moderation_decisions m ON m.revision_id=r.id
      WHERE r.plugin_id=? AND r.id=? ${statusClause}`).get(pluginId, revisionId) as SqlRow | undefined
    if (row === undefined) return undefined
    const record = JSON.parse(String(row.record_json)) as GitHubPluginRecord
    return {
      revisionId, pluginId, record, moderationStatus: String(row.moderation_status), publishedAt: String(row.published_at),
      release: this.revisionChange(revisionId),
    }
  }

  revisionChange(revisionId: string): PluginRevisionChange | undefined {
    const row = this.database.prepare('SELECT * FROM plugin_revision_changes WHERE revision_id=?').get(revisionId) as SqlRow | undefined
    if (row === undefined) return undefined
    return {
      revisionId: String(row.revision_id),
      ...(row.previous_revision_id === null ? {} : { previousRevisionId: String(row.previous_revision_id) }),
      ...(row.version === null ? {} : { version: String(row.version) }),
      title: String(row.title), summary: String(row.summary),
      changes: JSON.parse(String(row.changes_json)) as RevisionChangeItem[],
      breakingChanges: JSON.parse(String(row.breaking_changes_json)) as string[],
      ...(row.compare_url === null ? {} : { compareUrl: String(row.compare_url) }),
      sourceType: String(row.source_type) as RevisionChangeSource,
      ...(row.source_url === null ? {} : { sourceUrl: String(row.source_url) }),
      collectedAt: String(row.collected_at), updatedAt: String(row.updated_at),
    }
  }

  updateRevisionChange(actorId: string, pluginId: string, revisionId: string, update: {
    title: string; summary: string; changes: RevisionChangeItem[]; breakingChanges: string[]; sourceUrl?: string
  }, context: { ip?: string; requestId?: string } = {}): PluginRevisionChange | undefined {
    const revision = this.database.prepare('SELECT id FROM plugin_revisions WHERE id=? AND plugin_id=?').get(revisionId, pluginId) as SqlRow | undefined
    if (revision === undefined) return undefined
    const current = this.revisionChange(revisionId)
    if (current === undefined) return undefined
    const at = nowIso()
    this.transaction(() => {
      this.database.prepare(`UPDATE plugin_revision_changes SET title=?,summary=?,changes_json=?,breaking_changes_json=?,
        source_type='manual',source_url=?,updated_at=? WHERE revision_id=?`).run(
        update.title, update.summary, JSON.stringify(update.changes), JSON.stringify(update.breakingChanges), update.sourceUrl ?? null, at, revisionId,
      )
      this.audit(actorId, 'plugin.changelog.update', pluginId, { revisionId, beforeSource: current.sourceType }, context)
    })
    return this.revisionChange(revisionId)
  }

  refreshRevisionChange(actorId: string, pluginId: string, revisionId: string, notes: CollectedReleaseNotes, context: { ip?: string; requestId?: string } = {}): PluginRevisionChange | undefined {
    const revision = this.database.prepare('SELECT id FROM plugin_revisions WHERE id=? AND plugin_id=?').get(revisionId, pluginId) as SqlRow | undefined
    const current = this.revisionChange(revisionId)
    if (revision === undefined || current === undefined) return undefined
    const at = nowIso()
    this.transaction(() => {
      this.database.prepare(`UPDATE plugin_revision_changes SET version=?,title=?,summary=?,changes_json=?,breaking_changes_json=?,
        source_type=?,source_url=?,collected_at=?,updated_at=? WHERE revision_id=?`).run(
        notes.version ?? null, notes.title, notes.summary, JSON.stringify(notes.changes), JSON.stringify(notes.breakingChanges),
        notes.sourceType, notes.sourceUrl ?? null, notes.collectedAt, at, revisionId,
      )
      this.audit(actorId, 'plugin.changelog.refresh', pluginId, { revisionId, beforeSource: current.sourceType, afterSource: notes.sourceType }, context)
    })
    return this.revisionChange(revisionId)
  }

  publishWorkshopRelease(release: WorkshopRelease): boolean {
    let inserted = false
    this.transaction(() => {
      inserted = Number(this.database.prepare('INSERT OR IGNORE INTO workshop_releases VALUES(?,?,?,?,?)').run(
        release.version, release.title, release.summary, JSON.stringify(release.changes), release.publishedAt,
      ).changes) > 0
      if (!inserted) return
      const payload = { ...release }
      this.activity('workshop.release.published', `workshop.release:${release.version}`, payload, {}, release.publishedAt)
      const users = this.database.prepare("SELECT id FROM users WHERE status='active'").all() as SqlRow[]
      for (const user of users) this.notify(String(user.id), 'workshop.release', `workshop.release:${release.version}:${String(user.id)}`, payload, {}, release.publishedAt)
    })
    return inserted
  }

  workshopReleases() {
    return (this.database.prepare('SELECT * FROM workshop_releases ORDER BY published_at DESC').all() as SqlRow[]).map(row => ({
      version: String(row.version), title: String(row.title), summary: String(row.summary),
      changes: JSON.parse(String(row.changes_json)) as RevisionChangeItem[], publishedAt: String(row.published_at),
    } satisfies WorkshopRelease))
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

  private comparisonUrl(pluginUrl: string, previousRevisionId: string | undefined, currentSha: string): string | undefined {
    if (previousRevisionId === undefined) return undefined
    const previous = this.database.prepare('SELECT commit_sha FROM plugin_revisions WHERE id=?').get(previousRevisionId) as SqlRow | undefined
    if (previous === undefined || String(previous.commit_sha) === currentSha) return undefined
    return `${pluginUrl.replace(/\/$/, '')}/compare/${encodeURIComponent(String(previous.commit_sha))}...${encodeURIComponent(currentSha)}`
  }

  private upsertRevisionChange(plugin: GitHubPluginRecord, revisionId: string, previousRevisionId?: string): void {
    const existing = this.database.prepare('SELECT source_type FROM plugin_revision_changes WHERE revision_id=?').get(revisionId) as SqlRow | undefined
    if (existing?.source_type === 'manual') return
    const at = nowIso()
    const notes: CollectedReleaseNotes = plugin.releaseNotes ?? {
      ...(plugin.version === undefined ? {} : { version: plugin.version }),
      title: plugin.version === undefined ? `${plugin.name} 更新` : `${plugin.name} ${plugin.version}`,
      summary: '作者未提供更新日志。', changes: [], breakingChanges: [], sourceType: 'missing', collectedAt: at,
    }
    const compareUrl = this.comparisonUrl(plugin.url, previousRevisionId, plugin.verification.commitSha)
    this.database.prepare(`INSERT INTO plugin_revision_changes(
      revision_id,previous_revision_id,version,title,summary,changes_json,breaking_changes_json,
      compare_url,source_type,source_url,collected_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(revision_id) DO UPDATE SET
      previous_revision_id=excluded.previous_revision_id,version=excluded.version,title=excluded.title,summary=excluded.summary,
      changes_json=excluded.changes_json,breaking_changes_json=excluded.breaking_changes_json,compare_url=excluded.compare_url,
      source_type=excluded.source_type,source_url=excluded.source_url,collected_at=excluded.collected_at,updated_at=excluded.updated_at`).run(
      revisionId, previousRevisionId ?? null, notes.version ?? plugin.version ?? null, notes.title, notes.summary,
      JSON.stringify(notes.changes), JSON.stringify(notes.breakingChanges), compareUrl ?? null,
      notes.sourceType, notes.sourceUrl ?? null, notes.collectedAt, at,
    )
  }

  private relinkRevisionChange(revisionId: string, previousRevisionId: string | undefined, plugin: GitHubPluginRecord): void {
    const compareUrl = this.comparisonUrl(plugin.url, previousRevisionId, plugin.verification.commitSha)
    this.database.prepare('UPDATE plugin_revision_changes SET previous_revision_id=?,compare_url=?,updated_at=? WHERE revision_id=?').run(
      previousRevisionId ?? null, compareUrl ?? null, nowIso(), revisionId,
    )
  }

  private ingestOne(actorId: string, plugin: GitHubPluginRecord, legacyModeration?: Omit<PluginModeration, 'revisionId'>): void {
    const revisionId = revisionIdFor(plugin)
    const packagePath = plugin.packagePath ?? plugin.verification.packageJsonPath
    const at = nowIso()
    const previous = this.database.prepare('SELECT latest_revision_id FROM plugins WHERE id=?').get(plugin.id) as SqlRow | undefined
    const previousRevisionId = previous?.latest_revision_id === null || previous?.latest_revision_id === undefined ? undefined : String(previous.latest_revision_id)
    this.database.prepare(`INSERT INTO plugins(id,full_name,package_path,latest_revision_id,published_revision_id,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,package_path=excluded.package_path,latest_revision_id=excluded.latest_revision_id,updated_at=excluded.updated_at`).run(
      plugin.id, plugin.fullName, packagePath, revisionId, at, at,
    )
    this.database.prepare(`INSERT INTO plugin_revisions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,verification_json=excluded.verification_json,verified_at=excluded.verified_at`).run(
      revisionId, plugin.id, plugin.verification.commitSha, plugin.verification.packageJsonPath, plugin.verification.patchPath,
      JSON.stringify(plugin), JSON.stringify(plugin.verification), plugin.verification.checkedAt,
    )
    this.upsertRevisionChange(plugin, revisionId, previousRevisionId)
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
    const publicationChanged = status === 'approved' && String(plugin.published_revision_id ?? '') !== revisionId
    const revisionRecord = this.database.prepare('SELECT record_json FROM plugin_revisions WHERE id=?').get(revisionId) as SqlRow
    const publishedRecord = JSON.parse(String(revisionRecord.record_json)) as GitHubPluginRecord
    this.transaction(() => {
      this.database.prepare('UPDATE moderation_decisions SET status=?,featured=?,reason=?,updated_at=?,updated_by=? WHERE revision_id=?').run(
        status, featured ? 1 : 0, reason ?? null, nowIso(), actorId, revisionId,
      )
      if (status === 'approved') this.database.prepare('UPDATE plugins SET published_revision_id=? WHERE id=?').run(revisionId, pluginId)
      else if (String(plugin.published_revision_id) === revisionId) this.database.prepare('UPDATE plugins SET published_revision_id=NULL WHERE id=?').run(pluginId)
      if (publicationChanged) {
        const at = nowIso()
        const previousPublishedRevisionId = plugin.published_revision_id === null ? undefined : String(plugin.published_revision_id)
        this.relinkRevisionChange(revisionId, previousPublishedRevisionId, publishedRecord)
        const release = this.revisionChange(revisionId)
        const payload = {
          name: publishedRecord.name, revisionId, commitSha: publishedRecord.verification.commitSha,
          ...(release === undefined ? {} : { release }),
        }
        this.activity('plugin.published', `plugin.published:${revisionId}`, payload, { actorId, pluginId }, at)
        const subscribers = this.database.prepare('SELECT user_id FROM subscriptions WHERE plugin_id=?').all(pluginId) as SqlRow[]
        for (const subscriber of subscribers) this.notify(
          String(subscriber.user_id), 'plugin.updated', `plugin.updated:${revisionId}:${String(subscriber.user_id)}`,
          payload, { actorId, pluginId }, at,
        )
      }
      this.audit(actorId, 'plugin.moderate', pluginId, { revisionId, before: current.status, after: status, reason, featured }, context)
    })
    return true
  }

  communityModeration(query: { q?: string; type?: string; status?: string; page?: number; pageSize?: number } = {}) {
    const threadRows = this.database.prepare(`SELECT t.id,t.title AS title,t.body,u.username AS current_author_name,t.author_name,t.status,t.updated_at,
      (SELECT COUNT(*) FROM content_reports cr WHERE cr.target_type='thread' AND cr.target_id=t.id AND cr.status='pending') AS report_count
      FROM discussion_threads t JOIN users u ON u.id=t.author_id WHERE t.status<>'deleted'`).all() as SqlRow[]
    const replyRows = this.database.prepare(`SELECT r.id,'讨论回复' AS title,r.body,u.username AS current_author_name,r.author_name,r.status,r.updated_at,
      (SELECT COUNT(*) FROM content_reports cr WHERE cr.target_type='reply' AND cr.target_id=r.id AND cr.status='pending') AS report_count
      FROM discussion_replies r JOIN users u ON u.id=r.author_id WHERE r.status<>'deleted'`).all() as SqlRow[]
    const collectionRows = this.database.prepare(`SELECT c.id,c.name AS title,c.description AS body,u.username AS author_name,c.moderation_status AS status,c.updated_at,
      (SELECT COUNT(*) FROM content_reports cr WHERE cr.target_type='collection' AND cr.target_id=c.id AND cr.status='pending') AS report_count
      FROM collections c JOIN users u ON u.id=c.owner_id WHERE c.visibility='public'`).all() as SqlRow[]
    let items = [
      ...threadRows.map(row => ({ type: 'thread', ...this.moderationItem(row) })),
      ...replyRows.map(row => ({ type: 'reply', ...this.moderationItem(row) })),
      ...collectionRows.map(row => ({ type: 'collection', ...this.moderationItem(row) })),
    ]
    if (query.type) items = items.filter(item => item.type === query.type)
    if (query.status) items = items.filter(item => item.status === query.status)
    if (query.q?.trim()) { const needle = query.q.trim().toLowerCase(); items = items.filter(item => `${item.title} ${item.body} ${item.authorName}`.toLowerCase().includes(needle)) }
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length }
  }

  reports(query: { status?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25))
    const where = query.status ? 'WHERE cr.status=?' : ''
    const params = query.status ? [query.status] : []
    const total = this.scalar(`SELECT COUNT(*) AS value FROM content_reports cr ${where}`, ...params)
    const rows = this.database.prepare(`SELECT cr.*,u.username AS reporter_name FROM content_reports cr JOIN users u ON u.id=cr.reporter_id
      ${where} ORDER BY cr.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return { items: rows.map(row => ({
      id: String(row.id), reporterId: String(row.reporter_id), reporterName: String(row.reporter_name),
      targetType: String(row.target_type), targetId: String(row.target_id), reason: String(row.reason), status: String(row.status),
      target: this.reportTargetSummary(String(row.target_type), String(row.target_id)), createdAt: String(row.created_at),
      ...(row.resolved_at === null ? {} : { resolvedAt: String(row.resolved_at) }),
      ...(row.resolution === null ? {} : { resolution: String(row.resolution) }),
    })), page, pageSize, total }
  }

  async resolveReport(actorId: string, reportId: string, status: Exclude<ReportStatus, 'pending'>, resolution: string, context: { ip?: string; requestId?: string } = {}): Promise<boolean> {
    const row = this.database.prepare('SELECT status FROM content_reports WHERE id=?').get(reportId) as SqlRow | undefined
    if (row === undefined) return false
    const at = nowIso()
    this.transaction(() => {
      this.database.prepare('UPDATE content_reports SET status=?,resolved_at=?,resolved_by=?,resolution=? WHERE id=?').run(status, at, actorId, resolution, reportId)
      this.audit(actorId, 'report.resolve', reportId, { before: row.status, after: status, resolution }, context)
    })
    return true
  }

  async moderateDiscussionContent(actorId: string, type: 'thread' | 'reply', id: string, status: DiscussionStatus | ReplyStatus, reason: string, context: { ip?: string; requestId?: string } = {}): Promise<boolean> {
    const table = type === 'thread' ? 'discussion_threads' : 'discussion_replies'
    const row = this.database.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as SqlRow | undefined
    if (row === undefined) return false
    this.transaction(() => {
      this.database.prepare(`UPDATE ${table} SET status=?,updated_at=? WHERE id=?`).run(status, nowIso(), id)
      this.audit(actorId, `discussion.${type}.moderate`, id, { before: row.status, after: status, reason }, context)
    })
    return true
  }

  private moderationItem(row: SqlRow) {
    return {
      id: String(row.id), title: String(row.title), body: String(row.body), authorName: String(row.current_author_name ?? row.author_name),
      status: String(row.status), reportCount: Number(row.report_count), updatedAt: String(row.updated_at),
    }
  }

  private reportTargetExists(type: 'thread' | 'reply' | 'review' | 'collection', id: string): boolean {
    const table = { thread: 'discussion_threads', reply: 'discussion_replies', review: 'reviews', collection: 'collections' }[type]
    return this.scalar(`SELECT COUNT(*) AS value FROM ${table} WHERE id=?`, id) > 0
  }

  private reportTargetSummary(type: string, id: string) {
    const definitions: Record<string, { table: string; title: string; body: string }> = {
      thread: { table: 'discussion_threads', title: 'title', body: 'body' },
      reply: { table: 'discussion_replies', title: "'讨论回复'", body: 'body' },
      review: { table: 'reviews', title: "'插件评价'", body: 'body' },
      collection: { table: 'collections', title: 'name', body: 'description' },
    }
    const definition = definitions[type]
    if (definition === undefined) return null
    const row = this.database.prepare(`SELECT ${definition.title} AS title,${definition.body} AS body FROM ${definition.table} WHERE id=?`).get(id) as SqlRow | undefined
    return row === undefined ? null : { title: String(row.title), body: String(row.body) }
  }

  private notify(userId: string, type: string, dedupeKey: string, payload: Record<string, unknown>, links: { actorId?: string; pluginId?: string; threadId?: string } = {}, at = nowIso()): void {
    const preferences = this.notificationPreferences(userId)
    const enabled = type === 'plugin.updated' ? preferences.pluginUpdates
      : type === 'discussion.reply' ? preferences.discussionReplies
        : type === 'collection.updated' ? preferences.collectionUpdates
          : type === 'workshop.release' ? preferences.platformReleases : true
    if (!enabled) return
    this.database.prepare(`INSERT OR IGNORE INTO notifications(
      id,user_id,type,actor_id,plugin_id,thread_id,payload_json,dedupe_key,read_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,NULL,?)`).run(
      `notification_${randomUUID()}`, userId, type, links.actorId ?? null, links.pluginId ?? null,
      links.threadId ?? null, JSON.stringify(payload), dedupeKey, at,
    )
  }

  private activity(type: string, dedupeKey: string, payload: Record<string, unknown>, links: { actorId?: string; pluginId?: string; collectionId?: string; threadId?: string } = {}, at = nowIso()): void {
    this.database.prepare(`INSERT OR IGNORE INTO activity_events(
      id,type,actor_id,plugin_id,collection_id,thread_id,payload_json,dedupe_key,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      `event_${randomUUID()}`, type, links.actorId ?? null, links.pluginId ?? null,
      links.collectionId ?? null, links.threadId ?? null, JSON.stringify(payload), dedupeKey, at,
    )
  }

  summary() {
    return {
      users: this.scalar('SELECT COUNT(*) AS value FROM users'), activeUsers: this.scalar("SELECT COUNT(*) AS value FROM users WHERE status='active'"),
      admins: this.adminCount(), sessions: this.scalar('SELECT COUNT(*) AS value FROM sessions'), plugins: this.pluginCount(),
      approvedPlugins: this.scalar("SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.published_revision_id WHERE m.status='approved'"),
      pendingPlugins: this.scalar("SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.latest_revision_id WHERE m.status='pending'"),
      pendingRevisions: this.scalar("SELECT COUNT(*) AS value FROM moderation_decisions WHERE status='pending'"),
      rejectedPlugins: this.scalar("SELECT COUNT(*) AS value FROM plugins p JOIN moderation_decisions m ON m.revision_id=p.latest_revision_id WHERE m.status IN ('rejected','hidden')"),
      discussions: this.scalar("SELECT COUNT(*) AS value FROM discussion_threads WHERE status IN ('open','locked')"),
      publicCollections: this.scalar("SELECT COUNT(*) AS value FROM collections WHERE visibility='public' AND moderation_status='visible'"),
      pendingReports: this.scalar("SELECT COUNT(*) AS value FROM content_reports WHERE status='pending'"),
      releases: this.scalar('SELECT COUNT(*) AS value FROM workshop_releases'),
      githubSyncedAt: this.latestCompletedSyncAt() ?? null, latestSync: this.listSyncRuns(1).items[0] ?? null,
      audit: this.auditRecords({ pageSize: 20 }).items,
    }
  }

  createSyncRun(actorId: string, retryOf?: string, context: { ip?: string; requestId?: string } = {}): SyncRun {
    if (this.scalar("SELECT COUNT(*) AS value FROM sync_runs WHERE status IN ('queued','discovering','verifying')") > 0) throw new Error('SYNC_ALREADY_RUNNING')
    const run: SyncRun = { id: `sync_${randomUUID()}`, actorId, status: 'queued', discovered: 0, verified: 0, rejected: 0, failed: 0, deferred: 0, bundlesFound: 0, githubAuthenticated: false, ...(retryOf === undefined ? {} : { retryOf }), createdAt: nowIso() }
    this.database.prepare('INSERT INTO sync_runs(id,actor_id,status,discovered,verified,rejected,failed,retry_of,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      run.id, actorId, run.status, 0, 0, 0, 0, retryOf ?? null, run.createdAt,
    )
    this.audit(actorId, 'sync.create', run.id, { retryOf }, context)
    return run
  }

  updateSyncRun(id: string, update: Partial<Omit<SyncRun, 'id' | 'actorId' | 'createdAt'>>): void {
    const entries = Object.entries(update).filter(([, value]) => value !== undefined)
    if (entries.length === 0) return
    const names: Record<string, string> = { githubRemaining: 'github_remaining', githubResetAt: 'github_reset_at', bundlesFound: 'bundles_found', githubAuthenticated: 'github_authenticated', startedAt: 'started_at', finishedAt: 'finished_at' }
    const sets = entries.map(([key]) => `${names[key] ?? key}=?`).join(',')
    this.database.prepare(`UPDATE sync_runs SET ${sets} WHERE id=?`).run(...entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value as string | number), id)
  }

  recordSyncCandidate(runId: string, candidate: SyncCandidateInput): void {
    this.database.prepare(`INSERT INTO sync_candidates VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,repository) DO UPDATE SET commit_sha=excluded.commit_sha,status=excluded.status,bundle_count=excluded.bundle_count,reason=excluded.reason,evidence_json=excluded.evidence_json`).run(
      runId, candidate.repository, candidate.commitSha ?? null, candidate.status, candidate.bundleCount, candidate.reason ?? null, JSON.stringify(candidate.evidence ?? {}),
    )
  }

  retryableSyncRepositories(runId: string): string[] {
    return (this.database.prepare("SELECT repository FROM sync_candidates WHERE run_id=? AND status IN ('failed','deferred') ORDER BY repository").all(runId) as SqlRow[])
      .map(row => String(row.repository))
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
      deferred: Number(row.deferred), bundlesFound: Number(row.bundles_found), githubAuthenticated: Number(row.github_authenticated) === 1,
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
