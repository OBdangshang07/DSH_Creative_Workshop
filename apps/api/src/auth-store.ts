import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export type UserRole = 'user' | 'admin'
export type UserStatus = 'active' | 'disabled'
export type ModerationStatus = 'approved' | 'pending' | 'hidden'

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
  authorId: string
  authorName: string
  rating: number
  body: string
  createdAt: string
}

interface StoredSession {
  tokenHash: string
  userId: string
  expiresAt: string
  createdAt: string
}

export interface GitHubPluginRecord {
  id: string
  fullName: string
  name: string
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
  source: 'github-topic'
  securityReviewed: false
}

interface PluginModeration {
  status: ModerationStatus
  featured: boolean
  updatedAt: string
  updatedBy: string
}

interface AuditRecord {
  id: string
  actorId: string
  action: string
  target: string
  at: string
}

interface PersistedData {
  version: 1
  users: StoredUser[]
  sessions: StoredSession[]
  githubPlugins: GitHubPluginRecord[]
  githubSyncedAt?: string
  pluginModeration: Record<string, PluginModeration>
  audit: AuditRecord[]
  collections: UserCollection[]
  githubReviews: GitHubReview[]
}

export interface BootstrapAdmin {
  username: string
  email: string
  password: string
}

const emptyData = (): PersistedData => ({
  version: 1,
  users: [],
  sessions: [],
  githubPlugins: [],
  pluginModeration: {},
  audit: [],
  collections: [],
  githubReviews: [],
})

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

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
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    favorites: user.favorites,
    subscriptions: user.subscriptions,
    createdAt: user.createdAt,
    ...(user.lastLoginAt === undefined ? {} : { lastLoginAt: user.lastLoginAt }),
  }
}

export class AccountStore {
  private data = emptyData()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file?: string) {}

  async initialize(bootstrapAdmin?: BootstrapAdmin, seedPlugins: GitHubPluginRecord[] = []): Promise<void> {
    if (this.file !== undefined) {
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8')) as PersistedData
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      }
    }
    this.pruneSessions()
    this.data.collections ??= []
    this.data.githubReviews ??= []
    for (const user of this.data.users) user.subscriptions ??= []
    if (this.data.githubPlugins.length === 0 && seedPlugins.length > 0) {
      this.data.githubPlugins = seedPlugins
      this.data.githubSyncedAt = new Date().toISOString()
      for (const plugin of seedPlugins) {
        this.data.pluginModeration[plugin.id] = {
          status: 'approved', featured: plugin.stars >= 100, updatedAt: new Date().toISOString(), updatedBy: 'system',
        }
      }
    }
    if (bootstrapAdmin !== undefined && !this.data.users.some(user => user.role === 'admin')) {
      await this.createUser(bootstrapAdmin.username, bootstrapAdmin.email, bootstrapAdmin.password, 'admin')
    } else {
      await this.persist()
    }
  }

  private pruneSessions(): void {
    const now = Date.now()
    this.data.sessions = this.data.sessions.filter(session => Date.parse(session.expiresAt) > now)
  }

  private async persist(): Promise<void> {
    if (this.file === undefined) return
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.file!), { recursive: true })
      const temporary = `${this.file}.${process.pid}.tmp`
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file!)
    })
    await this.writeQueue
  }

  async createUser(username: string, email: string, password: string, role: UserRole = 'user'): Promise<StoredUser> {
    const normalizedUsername = username.trim()
    const normalizedEmail = email.trim().toLowerCase()
    if (this.data.users.some(user => user.username.toLowerCase() === normalizedUsername.toLowerCase())) {
      throw new Error('AUTH_USERNAME_EXISTS')
    }
    if (this.data.users.some(user => user.email === normalizedEmail)) throw new Error('AUTH_EMAIL_EXISTS')
    const user: StoredUser = {
      id: `usr_${randomUUID()}`,
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash: await passwordHash(password),
      role,
      status: 'active',
      favorites: [],
      subscriptions: [],
      createdAt: new Date().toISOString(),
    }
    this.data.users.push(user)
    await this.persist()
    return user
  }

  async authenticate(identity: string, password: string): Promise<StoredUser | undefined> {
    const key = identity.trim().toLowerCase()
    const user = this.data.users.find(candidate => candidate.username.toLowerCase() === key || candidate.email === key)
    if (user === undefined || user.status !== 'active' || !await passwordMatches(password, user.passwordHash)) return undefined
    user.lastLoginAt = new Date().toISOString()
    await this.persist()
    return user
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<boolean> {
    const user = this.data.users.find(candidate => candidate.id === userId)
    if (user === undefined || !await passwordMatches(currentPassword, user.passwordHash)) return false
    user.passwordHash = await passwordHash(nextPassword)
    this.data.sessions = this.data.sessions.filter(session => session.userId !== userId)
    await this.persist()
    return true
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
    this.pruneSessions()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    this.data.sessions.push({ tokenHash: tokenHash(token), userId, expiresAt, createdAt: new Date().toISOString() })
    await this.persist()
    return { token, expiresAt }
  }

  sessionUser(token: string | undefined): StoredUser | undefined {
    if (token === undefined) return undefined
    this.pruneSessions()
    const session = this.data.sessions.find(candidate => candidate.tokenHash === tokenHash(token))
    if (session === undefined) return undefined
    const user = this.data.users.find(candidate => candidate.id === session.userId)
    return user?.status === 'active' ? user : undefined
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (token === undefined) return
    const hash = tokenHash(token)
    this.data.sessions = this.data.sessions.filter(session => session.tokenHash !== hash)
    await this.persist()
  }

  users(): StoredUser[] {
    return [...this.data.users]
  }

  async updateUser(actorId: string, userId: string, update: { role?: UserRole; status?: UserStatus }): Promise<StoredUser | undefined> {
    const user = this.data.users.find(candidate => candidate.id === userId)
    if (user === undefined) return undefined
    if (update.role !== undefined) user.role = update.role
    if (update.status !== undefined) user.status = update.status
    if (user.status === 'disabled') this.data.sessions = this.data.sessions.filter(session => session.userId !== user.id)
    this.audit(actorId, 'user.update', userId)
    await this.persist()
    return user
  }

  async toggleFavorite(userId: string, pluginId: string): Promise<string[]> {
    const user = this.data.users.find(candidate => candidate.id === userId)
    if (user === undefined) return []
    user.favorites = user.favorites.includes(pluginId)
      ? user.favorites.filter(id => id !== pluginId)
      : [...user.favorites, pluginId]
    await this.persist()
    return user.favorites
  }

  async toggleSubscription(userId: string, pluginId: string): Promise<string[]> {
    const user = this.data.users.find(candidate => candidate.id === userId)
    if (user === undefined) return []
    user.subscriptions = user.subscriptions.includes(pluginId)
      ? user.subscriptions.filter(id => id !== pluginId)
      : [...user.subscriptions, pluginId]
    await this.persist()
    return user.subscriptions
  }

  userCollections(userId: string): UserCollection[] {
    return this.data.collections.filter(collection => collection.ownerId === userId)
  }

  async createCollection(userId: string, name: string, description: string, pluginIds: string[]): Promise<UserCollection> {
    const now = new Date().toISOString()
    const collection: UserCollection = {
      id: `col_${randomUUID()}`, ownerId: userId, name, description, pluginIds: [...new Set(pluginIds)].slice(0, 100), createdAt: now, updatedAt: now,
    }
    this.data.collections.push(collection)
    await this.persist()
    return collection
  }

  async deleteCollection(userId: string, collectionId: string): Promise<boolean> {
    const before = this.data.collections.length
    this.data.collections = this.data.collections.filter(collection => collection.id !== collectionId || collection.ownerId !== userId)
    if (before === this.data.collections.length) return false
    await this.persist()
    return true
  }

  reviews(pluginId: string): GitHubReview[] {
    return this.data.githubReviews.filter(review => review.pluginId === pluginId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async addReview(userId: string, pluginId: string, rating: number, body: string): Promise<GitHubReview> {
    const user = this.data.users.find(candidate => candidate.id === userId)!
    const existing = this.data.githubReviews.find(review => review.pluginId === pluginId && review.authorId === userId)
    if (existing !== undefined) {
      existing.rating = rating
      existing.body = body
      existing.createdAt = new Date().toISOString()
      await this.persist()
      return existing
    }
    const review: GitHubReview = {
      id: `ghreview_${randomUUID()}`, pluginId, authorId: userId, authorName: user.username, rating, body, createdAt: new Date().toISOString(),
    }
    this.data.githubReviews.push(review)
    await this.persist()
    return review
  }

  githubSnapshot(admin = false): { syncedAt?: string; items: Array<GitHubPluginRecord & { moderation: PluginModeration }> } {
    const items = this.data.githubPlugins.flatMap(plugin => {
      const moderation = this.data.pluginModeration[plugin.id] ?? {
        status: 'pending' as const, featured: false, updatedAt: plugin.updatedAt, updatedBy: 'system',
      }
      return admin || moderation.status === 'approved' ? [{ ...plugin, moderation }] : []
    })
    return { ...(this.data.githubSyncedAt === undefined ? {} : { syncedAt: this.data.githubSyncedAt }), items }
  }

  async replaceGitHubPlugins(actorId: string, plugins: GitHubPluginRecord[]): Promise<void> {
    this.data.githubPlugins = plugins
    this.data.githubSyncedAt = new Date().toISOString()
    for (const plugin of plugins) {
      this.data.pluginModeration[plugin.id] ??= {
        status: 'approved', featured: plugin.stars >= 100, updatedAt: new Date().toISOString(), updatedBy: actorId,
      }
    }
    this.audit(actorId, 'github.sync', `${plugins.length} plugins`)
    await this.persist()
  }

  async moderatePlugin(actorId: string, pluginId: string, update: { status?: ModerationStatus; featured?: boolean }): Promise<boolean> {
    if (!this.data.githubPlugins.some(plugin => plugin.id === pluginId)) return false
    const current = this.data.pluginModeration[pluginId] ?? {
      status: 'pending' as const, featured: false, updatedAt: new Date().toISOString(), updatedBy: actorId,
    }
    this.data.pluginModeration[pluginId] = {
      status: update.status ?? current.status,
      featured: update.featured ?? current.featured,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    }
    this.audit(actorId, 'plugin.moderate', pluginId)
    await this.persist()
    return true
  }

  summary() {
    const approved = Object.values(this.data.pluginModeration).filter(item => item.status === 'approved').length
    return {
      users: this.data.users.length,
      activeUsers: this.data.users.filter(user => user.status === 'active').length,
      admins: this.data.users.filter(user => user.role === 'admin').length,
      sessions: this.data.sessions.length,
      plugins: this.data.githubPlugins.length,
      approvedPlugins: approved,
      githubSyncedAt: this.data.githubSyncedAt ?? null,
      audit: this.data.audit.slice(-50).reverse(),
    }
  }

  private audit(actorId: string, action: string, target: string): void {
    this.data.audit.push({ id: `audit_${randomUUID()}`, actorId, action, target, at: new Date().toISOString() })
    this.data.audit = this.data.audit.slice(-500)
  }
}
