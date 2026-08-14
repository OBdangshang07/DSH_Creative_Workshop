import cors from '@fastify/cors'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { AccountStore, publicUser, type BootstrapAdmin, type CatalogQuery, type ModerationStatus, type UserRole, type UserStatus } from './auth-store.js'
import { githubSeed } from './github-seed.js'
import { CatalogSyncService } from './sync-service.js'
import { APP_VERSION } from './version.js'

interface ApiOptions {
  allowedOrigins?: readonly string[]
  accountStore?: AccountStore
  dataFile?: string
  legacyDataFile?: string
  bootstrapAdmin?: BootstrapAdmin
  githubToken?: string
  logger?: boolean
}

interface PageQuery {
  q?: string; role?: string; status?: string; kind?: string; action?: string
  surface?: string; topic?: string; author?: string; language?: string; license?: string; sort?: string
  page?: string; pageSize?: string
}

const error = (code: string, message: string, details: Record<string, unknown> = {}) => ({ error: { code, message, details } })

function cookieValue(cookie: string | undefined, name: string): string | undefined {
  if (cookie === undefined) return undefined
  for (const entry of cookie.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

function validUsername(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(value) }
function validEmail(value: unknown): value is string { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
function validPassword(value: unknown): value is string { return typeof value === 'string' && value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value) }
function pageNumber(value: string | undefined, fallback: number): number { const parsed = Number.parseInt(value ?? '', 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback }
const catalogSorts = new Set<NonNullable<CatalogQuery['sort']>>(['stars', 'recent', 'name', 'rating', 'subscriptions'])
function catalogSort(value: string | undefined): CatalogQuery['sort'] { return value !== undefined && catalogSorts.has(value as NonNullable<CatalogQuery['sort']>) ? value as NonNullable<CatalogQuery['sort']> : undefined }

export async function buildApi(options: ApiOptions = {}): Promise<FastifyInstance> {
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const accounts = options.accountStore ?? new AccountStore(options.dataFile, options.legacyDataFile)
  await accounts.initialize(options.bootstrapAdmin, githubSeed)
  const sync = new CatalogSyncService(accounts, options.githubToken)
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: '127.0.0.1',
    genReqId: request => typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'].slice(0, 128) : randomUUID(),
  })
  await app.register(cors, { origin(origin, callback) { callback(null, origin === undefined || allowedOrigins.has(origin)) }, credentials: true })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin
      const fetchSite = request.headers['sec-fetch-site']
      if ((origin !== undefined && !allowedOrigins.has(origin)) || fetchSite === 'cross-site') {
        return reply.code(403).send(error('AUTH_ORIGIN_DENIED', '请求来源未获授权'))
      }
    }
  })

  const sessionToken = (request: FastifyRequest) => cookieValue(request.headers.cookie, 'dsh_session')
  const currentUser = (request: FastifyRequest) => accounts.sessionUser(sessionToken(request))
  const context = (request: FastifyRequest) => ({ ip: request.ip, requestId: request.id })
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
  const setSession = (reply: FastifyReply, session: { token: string; expiresAt: string }) => reply.header(
    'Set-Cookie', `dsh_session=${encodeURIComponent(session.token)}; Path=/api/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(session.expiresAt).toUTCString()}`,
  )

  app.get('/health', async () => ({ ok: true, service: 'marketplace-api', version: APP_VERSION }))
  app.get('/health/live', async () => ({ ok: true, version: APP_VERSION }))
  app.get('/health/ready', async () => ({ ok: true, version: APP_VERSION, storage: 'sqlite-wal', catalog: accounts.summary().plugins }))

  const publicCatalog = async (request: FastifyRequest<{ Querystring: PageQuery }>) => {
    const q = request.query.q?.trim()
    const kind = request.query.kind?.trim()
    const optional = (value: string | undefined) => value?.trim() || undefined
    const sort = catalogSort(request.query.sort)
    const surface = optional(request.query.surface)
    const topic = optional(request.query.topic)
    const author = optional(request.query.author)
    const language = optional(request.query.language)
    const license = optional(request.query.license)
    const snapshot = accounts.githubSnapshot(false, {
      ...(q ? { q } : {}), ...(kind && kind !== 'all' ? { kind } : {}),
      ...(surface === undefined ? {} : { surface }), ...(topic === undefined ? {} : { topic }),
      ...(author === undefined ? {} : { author }), ...(language === undefined ? {} : { language }),
      ...(license === undefined ? {} : { license }),
      ...(sort === undefined ? {} : { sort }),
      page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 100),
    })
    return {
      source: 'https://github.com/topics/dsh-plugin',
      verificationNotice: '仅展示已验证包含 dsh.bundle.patch 且引用的 Cordis patch 存在并可解析的 DeepSeek Harness Bundle。',
      securityNotice: '结构验证不代表 DeepSeek 官方认证或安全审计，安装前仍需检查源码与权限。',
      ...snapshot,
    }
  }
  app.get<{ Querystring: PageQuery }>('/v1/plugins', publicCatalog)
  app.get<{ Querystring: PageQuery }>('/v1/github-plugins', publicCatalog)
  app.get<{ Params: { id: string } }>('/v1/plugins/:id', async (request, reply) => {
    const item = accounts.publicPlugin(request.params.id)
    return item === undefined ? reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '插件不存在或未公开')) : { plugin: item }
  })

  app.get('/v1/auth/me', async request => { const user = currentUser(request); return { authenticated: user !== undefined, user: user === undefined ? null : publicUser(user) } })
  app.post<{ Body: { username?: unknown; email?: unknown; password?: unknown } }>('/v1/auth/register', async (request, reply) => {
    const body = request.body ?? {}
    const limitKey = `register:${request.ip}`
    if (!accounts.allowAuthAttempt(limitKey)) return reply.code(429).send(error('AUTH_RATE_LIMITED', '请求过于频繁，请稍后再试'))
    if (!validUsername(body.username) || !validEmail(body.email) || !validPassword(body.password)) return reply.code(400).send(error('AUTH_INVALID_REGISTRATION', '请检查用户名、邮箱和密码规则'))
    try {
      const user = await accounts.createUser(body.username, body.email, body.password)
      const session = await accounts.createSession(user.id, {
        ip: request.ip,
        ...(request.headers['user-agent'] === undefined ? {} : { userAgent: request.headers['user-agent'] }),
      })
      setSession(reply, session); return reply.code(201).send({ user: publicUser(user) })
    } catch (cause) {
      if (cause instanceof Error && ['AUTH_USERNAME_EXISTS', 'AUTH_EMAIL_EXISTS'].includes(cause.message)) return reply.code(409).send(error('AUTH_IDENTITY_EXISTS', '该用户名或邮箱暂不可用'))
      throw cause
    }
  })
  app.post<{ Body: { identity?: unknown; password?: unknown } }>('/v1/auth/login', async (request, reply) => {
    const { identity, password } = request.body ?? {}
    if (typeof identity !== 'string' || typeof password !== 'string') return reply.code(400).send(error('AUTH_INVALID_LOGIN', '请输入账号和密码'))
    const normalized = identity.trim().toLowerCase()
    if (!accounts.allowAuthAttempt(`login:ip:${request.ip}`) || !accounts.allowAuthAttempt(`login:identity:${normalized}`)) return reply.code(429).send(error('AUTH_RATE_LIMITED', '登录尝试过于频繁，请稍后再试'))
    const user = await accounts.authenticate(identity, password)
    if (user === undefined) return reply.code(401).send(error('AUTH_LOGIN_FAILED', '账号或密码错误，或账号已停用'))
    accounts.clearAuthAttempts(`login:identity:${normalized}`)
    accounts.clearAuthAttempts(`login:ip:${request.ip}`)
    await accounts.deleteSession(sessionToken(request))
    const session = await accounts.createSession(user.id, {
      ip: request.ip,
      ...(request.headers['user-agent'] === undefined ? {} : { userAgent: request.headers['user-agent'] }),
    })
    setSession(reply, session); return { user: publicUser(user) }
  })
  app.post('/v1/auth/logout', async (request, reply) => {
    await accounts.deleteSession(sessionToken(request)); reply.header('Set-Cookie', 'dsh_session=; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'); return { ok: true }
  })
  app.post<{ Body: { currentPassword?: unknown; nextPassword?: unknown } }>('/v1/auth/change-password', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { currentPassword, nextPassword } = request.body ?? {}
    if (typeof currentPassword !== 'string' || !validPassword(nextPassword)) return reply.code(400).send(error('AUTH_INVALID_PASSWORD_CHANGE', '新密码至少 10 位且包含字母和数字'))
    if (!await accounts.changePassword(user.id, currentPassword, nextPassword)) return reply.code(401).send(error('AUTH_CURRENT_PASSWORD_INVALID', '当前密码错误'))
    reply.header('Set-Cookie', 'dsh_session=; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'); return { ok: true, reloginRequired: true }
  })
  app.get('/v1/me/sessions', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { items: accounts.sessions(user.id, sessionToken(request)) } })
  app.delete<{ Params: { id: string } }>('/v1/me/sessions/:id', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { ok: accounts.revokeSession(user.id, request.params.id) } })
  app.post('/v1/me/sessions/revoke-others', async (request, reply) => { const user = requireUser(request, reply); const token = sessionToken(request); if (user === undefined || token === undefined) return; return { revoked: accounts.revokeOtherSessions(user.id, token) } })

  for (const relation of ['favorites', 'subscriptions'] as const) app.post<{ Params: { id: string } }>(`/v1/me/${relation}/:id/toggle`, async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    try { return { [relation]: relation === 'favorites' ? await accounts.toggleFavorite(user.id, request.params.id) : await accounts.toggleSubscription(user.id, request.params.id) } }
    catch (cause) {
      if (cause instanceof Error && cause.message === 'CATALOG_PLUGIN_NOT_PUBLIC') return reply.code(404).send(error('CATALOG_PLUGIN_NOT_PUBLIC', '插件不存在或未公开'))
      throw cause
    }
  })
  for (const relation of ['favorites', 'subscriptions'] as const) app.get<{ Querystring: PageQuery }>(`/v1/me/${relation}`, async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return accounts.userRelations(user.id, relation, { page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.get<{ Params: { id: string } }>('/v1/me/plugins/:id/state', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const state = accounts.pluginState(user.id, request.params.id)
    return state === undefined ? reply.code(404).send(error('CATALOG_PLUGIN_NOT_PUBLIC', '插件不存在或未公开')) : { state }
  })
  app.get('/v1/me/collections', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { items: accounts.userCollections(user.id) } })
  app.post<{ Body: { name?: unknown; description?: unknown; pluginIds?: unknown } }>('/v1/me/collections', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { name, description, pluginIds } = request.body ?? {}
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof description !== 'string' || description.length > 500 || !Array.isArray(pluginIds) || !pluginIds.every(id => typeof id === 'string')) return reply.code(400).send(error('COLLECTION_INVALID', '合集名称、说明或插件列表无效'))
    return reply.code(201).send({ collection: await accounts.createCollection(user.id, name.trim(), description.trim(), pluginIds as string[]) })
  })
  app.patch<{ Params: { id: string }; Body: { name?: unknown; description?: unknown; pluginIds?: unknown } }>('/v1/me/collections/:id', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { name, description, pluginIds } = request.body ?? {}
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof description !== 'string' || description.length > 500 || !Array.isArray(pluginIds) || !pluginIds.every(id => typeof id === 'string')) return reply.code(400).send(error('COLLECTION_INVALID', '合集名称、说明或插件列表无效'))
    const collection = await accounts.updateCollection(user.id, request.params.id, { name: name.trim(), description: description.trim(), pluginIds: pluginIds as string[] })
    return collection === undefined ? reply.code(404).send(error('COLLECTION_NOT_FOUND', '合集不存在')) : { collection }
  })
  app.delete<{ Params: { id: string } }>('/v1/me/collections/:id', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { ok: await accounts.deleteCollection(user.id, request.params.id) } })
  const listReviews = async (request: FastifyRequest<{ Params: { id: string }; Querystring: PageQuery }>, reply: FastifyReply) => {
    const reviews = accounts.reviews(request.params.id, { page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 20) })
    return reviews === undefined ? reply.code(404).send(error('CATALOG_PLUGIN_NOT_PUBLIC', '插件不存在或未公开')) : reviews
  }
  app.get<{ Params: { id: string }; Querystring: PageQuery }>('/v1/plugins/:id/reviews', listReviews)
  app.get<{ Params: { id: string }; Querystring: PageQuery }>('/v1/github-plugins/:id/reviews', listReviews)
  const addReview = async (request: FastifyRequest<{ Params: { id: string }; Body: { rating?: unknown; body?: unknown } }>, reply: FastifyReply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { rating, body } = request.body ?? {}
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5 || typeof body !== 'string' || body.trim().length < 4 || body.trim().length > 1000) return reply.code(400).send(error('REVIEW_INVALID', '评分须为 1–5，评价正文须为 4–1000 字'))
    try { return reply.code(201).send({ review: await accounts.addReview(user.id, request.params.id, rating, body.trim()) }) }
    catch (cause) {
      if (cause instanceof Error && cause.message === 'CATALOG_PLUGIN_NOT_PUBLIC') return reply.code(404).send(error('CATALOG_PLUGIN_NOT_PUBLIC', '插件不存在或未公开'))
      throw cause
    }
  }
  app.post<{ Params: { id: string }; Body: { rating?: unknown; body?: unknown } }>('/v1/plugins/:id/reviews', addReview)
  app.post<{ Params: { id: string }; Body: { rating?: unknown; body?: unknown } }>('/v1/github-plugins/:id/reviews', addReview)

  app.get('/v1/admin/overview', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; return accounts.summary() })
  app.get<{ Querystring: PageQuery }>('/v1/admin/users', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.users({ ...(request.query.q ? { q: request.query.q } : {}), ...(request.query.role ? { role: request.query.role } : {}), ...(request.query.status ? { status: request.query.status } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.patch<{ Params: { id: string }; Body: { role?: unknown; status?: unknown } }>('/v1/admin/users/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { role, status } = request.body ?? {}
    if ((role !== undefined && !['user', 'admin'].includes(role as string)) || (status !== undefined && !['active', 'disabled'].includes(status as string))) return reply.code(400).send(error('ADMIN_INVALID_USER_UPDATE', '角色或状态无效'))
    if (admin.id === request.params.id && (role === 'user' || status === 'disabled')) return reply.code(400).send(error('ADMIN_SELF_LOCKOUT_DENIED', '不能停用自己或移除自己的管理员角色'))
    try {
      const user = await accounts.updateUser(admin.id, request.params.id, { ...(role === undefined ? {} : { role: role as UserRole }), ...(status === undefined ? {} : { status: status as UserStatus }) }, context(request))
      return user === undefined ? reply.code(404).send(error('ADMIN_USER_NOT_FOUND', '用户不存在')) : { user: publicUser(user) }
    } catch (cause) { if (cause instanceof Error && cause.message === 'ADMIN_LAST_ADMIN') return reply.code(409).send(error('ADMIN_LAST_ADMIN', '必须至少保留一名启用的管理员')); throw cause }
  })
  app.get<{ Params: { id: string } }>('/v1/admin/users/:id/sessions', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; return { items: accounts.sessions(request.params.id) } })
  app.delete<{ Params: { id: string; sessionId: string } }>('/v1/admin/users/:id/sessions/:sessionId', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; return { ok: accounts.revokeSession(request.params.id, request.params.sessionId) } })
  app.get<{ Querystring: PageQuery }>('/v1/admin/plugins', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.githubSnapshot(true, { ...(request.query.q ? { q: request.query.q } : {}), ...(request.query.status ? { status: request.query.status } : {}), ...(request.query.kind ? { kind: request.query.kind } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.patch<{ Params: { id: string }; Body: { revisionId?: unknown; status?: unknown; featured?: unknown; reason?: unknown } }>('/v1/admin/plugins/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { revisionId, status, featured, reason } = request.body ?? {}
    if ((status !== undefined && !['approved', 'pending', 'hidden', 'rejected'].includes(status as string)) || (featured !== undefined && typeof featured !== 'boolean') || (reason !== undefined && typeof reason !== 'string')) return reply.code(400).send(error('ADMIN_INVALID_PLUGIN_UPDATE', '审核请求无效'))
    if (['hidden', 'rejected'].includes(String(status)) && (typeof reason !== 'string' || reason.trim().length < 3)) return reply.code(400).send(error('ADMIN_REASON_REQUIRED', '隐藏或拒绝时必须填写原因'))
    const updated = await accounts.moderatePlugin(admin.id, request.params.id, { ...(typeof revisionId === 'string' ? { revisionId } : {}), ...(status === undefined ? {} : { status: status as ModerationStatus }), ...(featured === undefined ? {} : { featured }), ...(typeof reason === 'string' ? { reason: reason.trim() } : {}) }, context(request))
    return updated ? { ok: true } : reply.code(404).send(error('ADMIN_PLUGIN_NOT_FOUND', '插件或 revision 不存在'))
  })
  app.post('/v1/admin/sync-runs', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    try { return reply.code(202).send({ run: sync.create(admin.id, undefined, context(request)) }) } catch (cause) { if (cause instanceof Error && cause.message === 'SYNC_ALREADY_RUNNING') return reply.code(409).send(error('SYNC_ALREADY_RUNNING', '已有同步任务正在运行')); throw cause }
  })
  app.get('/v1/admin/sync-runs', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; return accounts.listSyncRuns() })
  app.get<{ Params: { id: string } }>('/v1/admin/sync-runs/:id', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; const run = accounts.syncRun(request.params.id); return run ?? reply.code(404).send(error('SYNC_RUN_NOT_FOUND', '同步任务不存在')) })
  app.post<{ Params: { id: string } }>('/v1/admin/sync-runs/:id/retry', async (request, reply) => { const admin = requireAdmin(request, reply); if (admin === undefined) return; if (accounts.syncRun(request.params.id) === undefined) return reply.code(404).send(error('SYNC_RUN_NOT_FOUND', '同步任务不存在')); try { return reply.code(202).send({ run: sync.create(admin.id, request.params.id, context(request)) }) } catch { return reply.code(409).send(error('SYNC_ALREADY_RUNNING', '已有同步任务正在运行')) } })
  app.get<{ Querystring: PageQuery }>('/v1/admin/audit', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; return accounts.auditRecords({ ...(request.query.q ? { q: request.query.q } : {}), ...(request.query.action ? { action: request.query.action } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) }) })

  app.post('/v1/admin/github-sync', async (request, reply) => { const admin = requireAdmin(request, reply); if (admin === undefined) return; try { return reply.code(202).send({ run: sync.create(admin.id, undefined, context(request)), deprecated: true }) } catch { return reply.code(409).send(error('SYNC_ALREADY_RUNNING', '已有同步任务正在运行')) } })
  app.setNotFoundHandler((request, reply) => reply.code(404).send(error('API_ROUTE_NOT_FOUND', '接口不存在', { method: request.method, url: request.url })))
  app.addHook('onReady', async () => sync.recover())
  if (options.accountStore === undefined) app.addHook('onClose', async () => accounts.close())
  return app
}
