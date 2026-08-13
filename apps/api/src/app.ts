import cors from '@fastify/cors'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  aggregateReviews,
  buildPluginGraph,
  InMemoryCatalogRepository,
  resolveCollection,
  resolvePlugin,
  searchCatalog,
  type CatalogRepository,
  type CommunityCatalogRepository,
} from '@dsh-workshop/catalog'
import type { PluginKind, RiskLevel, RuntimeEnvironment, SearchQuery } from '@dsh-workshop/domain'
import { AccountStore, publicUser, type BootstrapAdmin, type ModerationStatus, type UserRole, type UserStatus } from './auth-store.js'
import { fetchGitHubTopic } from './github-catalog.js'
import { githubSeed } from './github-seed.js'

const pluginKinds = new Set<PluginKind>([
  'bundle', 'cordis-plugin', 'skill-pack', 'mcp-bundle', 'integration', 'collection', 'ecosystem-tool',
])
const riskLevels = new Set<RiskLevel>(['low', 'moderate', 'high', 'critical'])
const sortModes = new Set<NonNullable<SearchQuery['sort']>>(['relevance', 'trusted', 'rating', 'recent'])
const operatingSystems = new Set<RuntimeEnvironment['os']>(['windows', 'linux', 'macos'])
const surfaces = new Set<NonNullable<SearchQuery['surface']>>(['web', 'headless', 'tui', 'desktop'])

interface ApiOptions {
  repository?: CatalogRepository
  allowedOrigins?: readonly string[]
  accountStore?: AccountStore
  dataFile?: string
  bootstrapAdmin?: BootstrapAdmin
  githubToken?: string
}

interface PluginQuery {
  q?: string
  tags?: string
  kind?: string
  os?: string
  surface?: string
  maxRisk?: string
  sort?: string
}

interface ResolveBody {
  pluginId?: unknown
  environment?: Partial<RuntimeEnvironment>
}

interface ReviewBody {
  author?: unknown
  worksAsDescribed?: unknown
  installationEase?: unknown
  documentation?: unknown
  stability?: unknown
  permissionClarity?: unknown
  body?: unknown
  dshVersion?: unknown
  os?: unknown
}

function error(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } }
}

function cookieValue(cookie: string | undefined, name: string): string | undefined {
  if (cookie === undefined) return undefined
  for (const entry of cookie.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

function validUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(value)
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value)
}

function parseSearchQuery(query: PluginQuery): SearchQuery {
  const result: SearchQuery = {}
  if (query.q !== undefined && query.q.trim() !== '') result.q = query.q.trim().slice(0, 200)
  if (query.tags !== undefined) result.tags = query.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 20)
  if (query.kind !== undefined && pluginKinds.has(query.kind as PluginKind)) result.kind = query.kind as PluginKind
  if (query.os !== undefined && operatingSystems.has(query.os as RuntimeEnvironment['os'])) result.os = query.os as RuntimeEnvironment['os']
  if (query.surface !== undefined && surfaces.has(query.surface as NonNullable<SearchQuery['surface']>)) {
    result.surface = query.surface as NonNullable<SearchQuery['surface']>
  }
  if (query.maxRisk !== undefined && riskLevels.has(query.maxRisk as RiskLevel)) result.maxRisk = query.maxRisk as RiskLevel
  if (query.sort !== undefined && sortModes.has(query.sort as NonNullable<SearchQuery['sort']>)) {
    result.sort = query.sort as NonNullable<SearchQuery['sort']>
  }
  return result
}

function isRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}

function isCommunityRepository(repository: CatalogRepository): repository is CommunityCatalogRepository {
  return 'addReview' in repository && typeof repository.addReview === 'function'
}

export async function buildApi(options: ApiOptions = {}): Promise<FastifyInstance> {
  const repository = options.repository ?? new InMemoryCatalogRepository()
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const accounts = options.accountStore ?? new AccountStore(options.dataFile)
  await accounts.initialize(options.bootstrapAdmin, githubSeed)
  const app = Fastify({ logger: false, trustProxy: '127.0.0.1' })
  const authAttempts = new Map<string, { count: number; resetAt: number }>()
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin))
    },
    credentials: true,
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin
      if (origin !== undefined && !allowedOrigins.has(origin)) {
        return reply.code(403).send(error('AUTH_ORIGIN_DENIED', '请求来源未获授权'))
      }
    }
  })

  const currentUser = (request: FastifyRequest) =>
    accounts.sessionUser(cookieValue(request.headers.cookie, 'dsh_session'))

  const requireUser = (request: FastifyRequest, reply: FastifyReply) => {
    const user = currentUser(request)
    if (user === undefined) reply.code(401).send(error('AUTH_REQUIRED', '请先登录'))
    return user
  }

  const requireAdmin = (request: FastifyRequest, reply: FastifyReply) => {
    const user = currentUser(request)
    if (user === undefined || user.role !== 'admin') reply.code(403).send(error('ADMIN_REQUIRED', '需要管理员权限'))
    return user?.role === 'admin' ? user : undefined
  }

  const allowAuthAttempt = (request: FastifyRequest): boolean => {
    const key = request.ip
    const now = Date.now()
    const current = authAttempts.get(key)
    if (current === undefined || current.resetAt <= now) {
      authAttempts.set(key, { count: 1, resetAt: now + 60_000 })
      return true
    }
    current.count += 1
    return current.count <= 12
  }

  app.get('/health', async () => ({ ok: true, service: 'marketplace-api', catalogRevision: repository.snapshot().revision }))

  app.get<{ Querystring: { q?: string; kind?: string } }>('/v1/github-plugins', async request => {
    const snapshot = accounts.githubSnapshot(false)
    const q = request.query.q?.trim().toLowerCase()
    const kind = request.query.kind?.trim()
    const items = snapshot.items.filter(item =>
      (q === undefined || `${item.name} ${item.author} ${item.description} ${item.topics.join(' ')}`.toLowerCase().includes(q)) &&
      (kind === undefined || kind === 'all' || item.kind === kind),
    ).sort((left, right) => Number(right.moderation.featured) - Number(left.moderation.featured) || right.stars - left.stars)
    return { source: 'https://github.com/topics/dsh-plugin', securityNotice: 'GitHub Topic 收录不代表官方认证或安全审计。', ...snapshot, items }
  })

  app.get('/v1/auth/me', async request => {
    const user = currentUser(request)
    return { authenticated: user !== undefined, user: user === undefined ? null : publicUser(user) }
  })

  app.post<{ Body: { username?: unknown; email?: unknown; password?: unknown } }>('/v1/auth/register', async (request, reply) => {
    if (!allowAuthAttempt(request)) return reply.code(429).send(error('AUTH_RATE_LIMITED', '请求过于频繁，请稍后再试'))
    const body = request.body ?? {}
    if (!validUsername(body.username) || !validEmail(body.email) || !validPassword(body.password)) {
      return reply.code(400).send(error('AUTH_INVALID_REGISTRATION', '用户名需为 3–32 位；邮箱需有效；密码至少 10 位且包含字母和数字'))
    }
    try {
      const user = await accounts.createUser(body.username, body.email, body.password)
      const session = await accounts.createSession(user.id)
      reply.header('Set-Cookie', `dsh_session=${encodeURIComponent(session.token)}; Path=/api/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(session.expiresAt).toUTCString()}`)
      return reply.code(201).send({ user: publicUser(user) })
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'AUTH_REGISTRATION_FAILED'
      if (code === 'AUTH_USERNAME_EXISTS' || code === 'AUTH_EMAIL_EXISTS') return reply.code(409).send(error(code, '用户名或邮箱已存在'))
      throw cause
    }
  })

  app.post<{ Body: { identity?: unknown; password?: unknown } }>('/v1/auth/login', async (request, reply) => {
    if (!allowAuthAttempt(request)) return reply.code(429).send(error('AUTH_RATE_LIMITED', '登录尝试过于频繁，请稍后再试'))
    const body = request.body ?? {}
    if (typeof body.identity !== 'string' || typeof body.password !== 'string') {
      return reply.code(400).send(error('AUTH_INVALID_LOGIN', '请输入账号和密码'))
    }
    const user = await accounts.authenticate(body.identity, body.password)
    if (user === undefined) return reply.code(401).send(error('AUTH_LOGIN_FAILED', '账号或密码错误，或账号已停用'))
    const session = await accounts.createSession(user.id)
    reply.header('Set-Cookie', `dsh_session=${encodeURIComponent(session.token)}; Path=/api/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(session.expiresAt).toUTCString()}`)
    return { user: publicUser(user) }
  })

  app.post('/v1/auth/logout', async (request, reply) => {
    await accounts.deleteSession(cookieValue(request.headers.cookie, 'dsh_session'))
    reply.header('Set-Cookie', 'dsh_session=; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=0')
    return { ok: true }
  })

  app.post<{ Body: { currentPassword?: unknown; nextPassword?: unknown } }>('/v1/auth/change-password', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    const { currentPassword, nextPassword } = request.body ?? {}
    if (typeof currentPassword !== 'string' || !validPassword(nextPassword)) {
      return reply.code(400).send(error('AUTH_INVALID_PASSWORD_CHANGE', '新密码至少 10 位且包含字母和数字'))
    }
    if (!await accounts.changePassword(user.id, currentPassword, nextPassword)) {
      return reply.code(401).send(error('AUTH_CURRENT_PASSWORD_INVALID', '当前密码错误'))
    }
    reply.header('Set-Cookie', 'dsh_session=; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=0')
    return { ok: true, reloginRequired: true }
  })

  app.post<{ Params: { id: string } }>('/v1/me/favorites/:id/toggle', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    return { favorites: await accounts.toggleFavorite(user.id, request.params.id) }
  })

  app.post<{ Params: { id: string } }>('/v1/me/subscriptions/:id/toggle', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    return { subscriptions: await accounts.toggleSubscription(user.id, request.params.id) }
  })

  app.get('/v1/me/collections', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    return { items: accounts.userCollections(user.id) }
  })

  app.post<{ Body: { name?: unknown; description?: unknown; pluginIds?: unknown } }>('/v1/me/collections', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    const { name, description, pluginIds } = request.body ?? {}
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 ||
      typeof description !== 'string' || description.length > 500 || !Array.isArray(pluginIds) ||
      !pluginIds.every(id => typeof id === 'string')) {
      return reply.code(400).send(error('COLLECTION_INVALID', '合集名称、说明或插件列表无效'))
    }
    const validIds = new Set(accounts.githubSnapshot(false).items.map(item => item.id))
    const safeIds = pluginIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
    const collection = await accounts.createCollection(user.id, name.trim(), description.trim(), safeIds)
    return reply.code(201).send({ collection })
  })

  app.delete<{ Params: { id: string } }>('/v1/me/collections/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    if (!await accounts.deleteCollection(user.id, request.params.id)) return reply.code(404).send(error('COLLECTION_NOT_FOUND', '合集不存在'))
    return { ok: true }
  })

  app.get<{ Params: { id: string } }>('/v1/github-plugins/:id/reviews', async request => {
    const items = accounts.reviews(request.params.id)
    const score = items.length === 0 ? 0 : Math.round(items.reduce((sum, review) => sum + review.rating, 0) / items.length * 10) / 10
    return { summary: { count: items.length, score }, items }
  })

  app.post<{ Params: { id: string }; Body: { rating?: unknown; body?: unknown } }>('/v1/github-plugins/:id/reviews', async (request, reply) => {
    const user = requireUser(request, reply)
    if (user === undefined) return
    const rating = request.body?.rating
    const body = request.body?.body
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5 ||
      typeof body !== 'string' || body.trim().length < 4 || body.trim().length > 1000) {
      return reply.code(400).send(error('REVIEW_INVALID', '评分须为 1–5，评价正文须为 4–1000 字'))
    }
    if (!accounts.githubSnapshot(false).items.some(plugin => plugin.id === request.params.id)) {
      return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '插件不存在或未展示'))
    }
    return reply.code(201).send({ review: await accounts.addReview(user.id, request.params.id, rating, body.trim()) })
  })

  app.get('/v1/admin/overview', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.summary()
  })

  app.get('/v1/admin/users', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return { items: accounts.users().map(publicUser) }
  })

  app.patch<{ Params: { id: string }; Body: { role?: unknown; status?: unknown } }>('/v1/admin/users/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (admin === undefined) return
    const role = request.body?.role
    const status = request.body?.status
    if ((role !== undefined && !['user', 'admin'].includes(role as string)) || (status !== undefined && !['active', 'disabled'].includes(status as string))) {
      return reply.code(400).send(error('ADMIN_INVALID_USER_UPDATE', '角色或状态无效'))
    }
    if (admin.id === request.params.id && (role === 'user' || status === 'disabled')) {
      return reply.code(400).send(error('ADMIN_SELF_LOCKOUT_DENIED', '不能停用自己或移除自己的管理员角色'))
    }
    const user = await accounts.updateUser(admin.id, request.params.id, {
      ...(role === undefined ? {} : { role: role as UserRole }),
      ...(status === undefined ? {} : { status: status as UserStatus }),
    })
    if (user === undefined) return reply.code(404).send(error('ADMIN_USER_NOT_FOUND', '用户不存在'))
    return { user: publicUser(user) }
  })

  app.get('/v1/admin/plugins', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.githubSnapshot(true)
  })

  app.patch<{ Params: { id: string }; Body: { status?: unknown; featured?: unknown } }>('/v1/admin/plugins/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (admin === undefined) return
    const status = request.body?.status
    const featured = request.body?.featured
    if ((status !== undefined && !['approved', 'pending', 'hidden'].includes(status as string)) || (featured !== undefined && typeof featured !== 'boolean')) {
      return reply.code(400).send(error('ADMIN_INVALID_PLUGIN_UPDATE', '审核状态或精选值无效'))
    }
    const updated = await accounts.moderatePlugin(admin.id, request.params.id, {
      ...(status === undefined ? {} : { status: status as ModerationStatus }),
      ...(featured === undefined ? {} : { featured }),
    })
    if (!updated) return reply.code(404).send(error('ADMIN_PLUGIN_NOT_FOUND', '插件不存在'))
    return { ok: true }
  })

  app.post('/v1/admin/github-sync', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (admin === undefined) return
    try {
      const plugins = await fetchGitHubTopic(options.githubToken)
      await accounts.replaceGitHubPlugins(admin.id, plugins)
      return { ok: true, count: plugins.length, syncedAt: new Date().toISOString() }
    } catch (cause) {
      return reply.code(502).send(error('GITHUB_SYNC_FAILED', 'GitHub Topic 同步失败', { reason: cause instanceof Error ? cause.message : 'unknown' }))
    }
  })

  app.get('/v1/catalog', async () => {
    const snapshot = repository.snapshot()
    return {
      catalogRevision: snapshot.revision,
      generatedAt: snapshot.generatedAt,
      counts: { plugins: snapshot.plugins.length, collections: snapshot.collections.length, reviews: snapshot.reviews.length },
      tags: [...new Set(snapshot.plugins.flatMap(plugin => plugin.tags))].sort(),
    }
  })

  app.get<{ Querystring: PluginQuery }>('/v1/plugins', async request => ({
    catalogRevision: repository.snapshot().revision,
    items: searchCatalog(repository, parseSearchQuery(request.query)),
  }))

  app.get<{ Params: { id: string } }>('/v1/plugins/:id', async (request, reply) => {
    const plugin = repository.plugin(request.params.id)
    if (plugin === undefined) return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '未找到插件', { id: request.params.id }))
    return { catalogRevision: repository.snapshot().revision, plugin }
  })

  app.get<{ Params: { id: string } }>('/v1/plugins/:id/versions', async (request, reply) => {
    const plugin = repository.plugin(request.params.id)
    if (plugin === undefined) return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '未找到插件', { id: request.params.id }))
    return { catalogRevision: repository.snapshot().revision, items: plugin.versions }
  })

  app.get<{ Params: { id: string } }>('/v1/plugin-versions/:id', async (request, reply) => {
    const pluginVersion = repository.pluginVersion(request.params.id)
    if (pluginVersion === undefined) {
      return reply.code(404).send(error('CATALOG_VERSION_NOT_FOUND', '未找到插件版本', { id: request.params.id }))
    }
    return { catalogRevision: repository.snapshot().revision, pluginVersion }
  })

  app.get<{ Params: { id: string } }>('/v1/plugin-versions/:id/evidence', async (request, reply) => {
    const pluginVersion = repository.pluginVersion(request.params.id)
    if (pluginVersion === undefined) {
      return reply.code(404).send(error('CATALOG_VERSION_NOT_FOUND', '未找到插件版本', { id: request.params.id }))
    }
    return { catalogRevision: repository.snapshot().revision, items: pluginVersion.evidence }
  })

  app.get<{ Params: { id: string } }>('/v1/plugins/:id/graph', async (request, reply) => {
    const graph = buildPluginGraph(repository, request.params.id)
    if (graph === undefined) return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '未找到插件', { id: request.params.id }))
    return { catalogRevision: repository.snapshot().revision, graph }
  })

  app.get('/v1/collections', async () => ({
    catalogRevision: repository.snapshot().revision,
    items: repository.snapshot().collections,
  }))

  app.get<{ Params: { id: string } }>('/v1/collections/:id', async (request, reply) => {
    const resolved = resolveCollection(repository, request.params.id)
    if (resolved === undefined) {
      return reply.code(404).send(error('CATALOG_COLLECTION_NOT_FOUND', '未找到合集', { id: request.params.id }))
    }
    return { catalogRevision: repository.snapshot().revision, ...resolved }
  })

  app.get<{ Params: { id: string } }>('/v1/plugin-versions/:id/reviews', async (request, reply) => {
    const pluginVersion = repository.pluginVersion(request.params.id)
    if (pluginVersion === undefined) {
      return reply.code(404).send(error('CATALOG_VERSION_NOT_FOUND', '未找到插件版本', { id: request.params.id }))
    }
    const items = repository.reviews(request.params.id)
    return { catalogRevision: repository.snapshot().revision, summary: aggregateReviews(items), items }
  })

  app.post<{ Params: { id: string }; Body: ReviewBody }>('/v1/plugin-versions/:id/reviews', async (request, reply) => {
    const pluginVersion = repository.pluginVersion(request.params.id)
    if (pluginVersion === undefined) {
      return reply.code(404).send(error('CATALOG_VERSION_NOT_FOUND', '未找到插件版本', { id: request.params.id }))
    }
    if (!isCommunityRepository(repository)) {
      return reply.code(501).send(error('COMMUNITY_READ_ONLY', '当前目录存储不支持写入评价'))
    }
    const body = request.body ?? {}
    const ratings = [body.worksAsDescribed, body.installationEase, body.documentation, body.stability, body.permissionClarity]
    if (
      typeof body.author !== 'string' || body.author.trim().length < 2 || body.author.trim().length > 64 ||
      typeof body.body !== 'string' || body.body.trim().length < 4 || body.body.trim().length > 2_000 ||
      !ratings.every(isRating)
    ) {
      return reply.code(400).send(error('COMMUNITY_INVALID_REVIEW', '作者、正文和五项 1–5 分评分必须完整且有效'))
    }
    if (body.os !== undefined && (typeof body.os !== 'string' || !operatingSystems.has(body.os as RuntimeEnvironment['os']))) {
      return reply.code(400).send(error('COMMUNITY_INVALID_ENVIRONMENT', '评价中的 OS 无效'))
    }
    const review = {
      id: `review.${randomUUID()}`,
      pluginVersionId: pluginVersion.id,
      author: body.author.trim(),
      // Public submissions cannot self-assert a local installation receipt.
      receiptBacked: false,
      worksAsDescribed: body.worksAsDescribed as number,
      installationEase: body.installationEase as number,
      documentation: body.documentation as number,
      stability: body.stability as number,
      permissionClarity: body.permissionClarity as number,
      body: body.body.trim(),
      ...(typeof body.dshVersion === 'string' ? { dshVersion: body.dshVersion.slice(0, 64) } : {}),
      ...(typeof body.os === 'string' ? { os: body.os } : {}),
      createdAt: new Date().toISOString(),
    }
    const summary = repository.addReview(review)
    return reply.code(201).send({ catalogRevision: repository.snapshot().revision, review, summary })
  })

  app.post<{ Body: ResolveBody }>('/v1/resolve', async (request, reply) => {
    const { pluginId, environment } = request.body ?? {}
    if (typeof pluginId !== 'string' || environment === undefined) {
      return reply.code(400).send(error('RESOLVE_INVALID_REQUEST', 'pluginId 和 environment 为必填项'))
    }
    if (!operatingSystems.has(environment.os as RuntimeEnvironment['os']) || !['x64', 'arm64'].includes(environment.arch ?? '')) {
      return reply.code(400).send(error('COMPAT_INVALID_ENVIRONMENT', 'environment.os 或 environment.arch 无效'))
    }
    const resolved = resolvePlugin(repository, pluginId, {
      nodeVersion: environment.nodeVersion ?? process.version,
      os: environment.os as RuntimeEnvironment['os'],
      arch: environment.arch as RuntimeEnvironment['arch'],
      ...(environment.dshVersion === undefined ? {} : { dshVersion: environment.dshVersion }),
    })
    if (resolved === undefined) return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '未找到插件', { id: pluginId }))
    return resolved
  })

  app.setNotFoundHandler((request, reply) => reply.code(404).send(error('API_ROUTE_NOT_FOUND', '接口不存在', { method: request.method, url: request.url })))
  return app
}
