import cors from '@fastify/cors'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { AccountStore, publicUser, type BootstrapAdmin, type CatalogQuery, type ModerationStatus, type NotificationPreferences, type RevisionChangeItem, type UserRole, type UserStatus } from './auth-store.js'
import { githubSeed } from './github-seed.js'
import { collectGitHubReleaseNotes } from './github-catalog.js'
import { CatalogSyncService } from './sync-service.js'
import { APP_VERSION } from './version.js'
import { PresenceService } from './presence-service.js'
import { loadWorkshopRelease } from './release-manifest.js'
import { MediaService, MediaUnavailableError } from './media-service.js'

interface ApiOptions {
  allowedOrigins?: readonly string[]
  accountStore?: AccountStore
  dataFile?: string
  legacyDataFile?: string
  bootstrapAdmin?: BootstrapAdmin
  githubToken?: string
  logger?: boolean
  presenceService?: PresenceService
  mediaDirectory?: string
  mediaFetcher?: typeof fetch
}

interface PageQuery {
  q?: string; role?: string; status?: string; kind?: string; action?: string
  surface?: string; topic?: string; author?: string; language?: string; license?: string; sort?: string
  category?: string; pluginId?: string; page?: string; pageSize?: string
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
function validGitHubUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && ['github.com','www.github.com'].includes(url.hostname) } catch { return false }
}
function pageNumber(value: string | undefined, fallback: number): number { const parsed = Number.parseInt(value ?? '', 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback }
const catalogSorts = new Set<NonNullable<CatalogQuery['sort']>>(['stars', 'recent', 'name', 'rating', 'subscriptions'])
function catalogSort(value: string | undefined): CatalogQuery['sort'] { return value !== undefined && catalogSorts.has(value as NonNullable<CatalogQuery['sort']>) ? value as NonNullable<CatalogQuery['sort']> : undefined }

export async function buildApi(options: ApiOptions = {}): Promise<FastifyInstance> {
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const accounts = options.accountStore ?? new AccountStore(options.dataFile, options.legacyDataFile)
  await accounts.initialize(options.bootstrapAdmin, githubSeed)
  accounts.publishWorkshopRelease(await loadWorkshopRelease())
  const sync = new CatalogSyncService(accounts, options.githubToken)
  const presence = options.presenceService ?? new PresenceService()
  const media = new MediaService(accounts,{...(options.mediaDirectory===undefined?{}:{directory:options.mediaDirectory}),...(options.mediaFetcher===undefined?{}:{fetcher:options.mediaFetcher})})
  await media.initialize()
  let lastPresenceBucket = ''
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
  const setPresence = (reply: FastifyReply, token: string) => reply.header(
    'Set-Cookie', `dsh_presence=${encodeURIComponent(token)}; Path=/api/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
  )

  app.get('/health', async () => ({ ok: true, service: 'marketplace-api', version: APP_VERSION }))
  app.get('/health/live', async () => ({ ok: true, version: APP_VERSION }))
  app.get('/health/ready', async () => ({ ok: true, version: APP_VERSION, storage: 'sqlite-wal', catalog: accounts.summary().plugins }))
  app.get('/v1/presence/summary', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); return presence.summary() })
  app.post('/v1/presence/heartbeat', async (request, reply) => {
    const result = presence.heartbeat(cookieValue(request.headers.cookie, 'dsh_presence'), request.ip, request.headers['user-agent'] ?? '')
    if (result.issued && result.token !== undefined) setPresence(reply, result.token)
    const bucket = result.sampledAt.slice(0, 16)
    if (result.token !== undefined && bucket !== lastPresenceBucket) { lastPresenceBucket = bucket; accounts.recordPresenceSnapshot(result.online, new Date(result.sampledAt)) }
    reply.header('Cache-Control', 'no-store')
    return { online: result.online, sampledAt: result.sampledAt, windowSeconds: result.windowSeconds }
  })
  app.post('/v1/presence/leave', async (request, reply) => {
    const online = presence.leave(cookieValue(request.headers.cookie, 'dsh_presence'))
    reply.header('Cache-Control', 'no-store')
    return { online }
  })

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
  app.get<{ Params: { id: string } }>('/v1/plugins/:id/cover.svg', async (request, reply) => {
    const svg = media.coverSvg(request.params.id)
    if (svg === undefined) return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '插件不存在或未公开'))
    return reply.header('Content-Type', 'image/svg+xml; charset=utf-8').header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400').send(svg)
  })
  app.get<{ Params: { id: string; index: string } }>('/v1/plugins/:id/media/:index', async (request, reply) => {
    const index = Number.parseInt(request.params.index, 10)
    if (!Number.isInteger(index) || index < 0 || index > 7) return reply.code(404).send(error('PLUGIN_MEDIA_NOT_FOUND', '媒体不存在'))
    try {
      const asset = await media.asset(request.params.id, index)
      return reply.header('Content-Type', asset.mime).header('ETag', `"${asset.etag}"`).header('Cache-Control', 'public, max-age=86400, immutable').send(Buffer.from(asset.body))
    } catch (cause) {
      if (cause instanceof MediaUnavailableError) return reply.code(404).send(error('PLUGIN_MEDIA_UNAVAILABLE', '媒体暂时不可用'))
      throw cause
    }
  })
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/v1/plugins/:id/related', async (request, reply) => {
    const result = accounts.relatedPlugins(request.params.id, pageNumber(request.query.limit, 8))
    return result === undefined ? reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '插件不存在或未公开')) : { items: result }
  })
  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/v1/plugins/:id/media/report', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const reason = request.body?.reason
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) return reply.code(400).send(error('PLUGIN_MEDIA_REPORT_INVALID', '请填写 3–500 字的媒体问题说明'))
    if (!accounts.allowAuthAttempt(`media-report:${user.id}`, 8, 60 * 60_000, 60 * 60_000)) return reply.code(429).send(error('PLUGIN_MEDIA_REPORT_RATE_LIMITED', '反馈过于频繁，请稍后再试'))
    try { accounts.createMediaReport(user.id, request.params.id, reason.trim()); return reply.code(201).send({ ok: true }) }
    catch (cause) { if (cause instanceof Error && cause.message === 'REPORT_TARGET_NOT_FOUND') return reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '插件不存在或未公开')); throw cause }
  })
  app.get<{ Params: { id: string } }>('/v1/plugins/:id/revisions', async (request, reply) => {
    const items = accounts.pluginRevisions(request.params.id)
    return items === undefined ? reply.code(404).send(error('CATALOG_PLUGIN_NOT_FOUND', '插件不存在或未公开')) : { items }
  })
  app.get<{ Params: { id: string; revisionId: string } }>('/v1/plugins/:id/revisions/:revisionId', async (request, reply) => {
    const revision = accounts.pluginRevision(request.params.id, request.params.revisionId)
    return revision === undefined ? reply.code(404).send(error('CATALOG_REVISION_NOT_FOUND', '插件版本不存在或未公开')) : { revision }
  })
  app.get('/v1/releases', async () => ({ items: accounts.workshopReleases() }))

  app.get('/v1/auth/me', async request => { const user = currentUser(request); return { authenticated: user !== undefined, user: user === undefined ? null : publicUser(user) } })
  app.get('/v1/me/plugin-submissions', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return { items: accounts.userPluginSubmissions(user.id) }
  })
  app.post<{ Body: { repositoryUrl?: unknown } }>('/v1/me/plugin-submissions', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const repositoryUrl = request.body?.repositoryUrl
    if (!validGitHubUrl(repositoryUrl)) return reply.code(400).send(error('PLUGIN_SUBMISSION_URL_INVALID', '请填写有效的 GitHub 仓库地址'))
    const url = new URL(repositoryUrl); const segments = url.pathname.replace(/\.git\/?$/i, '').split('/').filter(Boolean)
    if (segments.length !== 2 || !segments.every(segment => /^[A-Za-z0-9_.-]+$/.test(segment))) return reply.code(400).send(error('PLUGIN_SUBMISSION_URL_INVALID', '请填写仓库首页地址'))
    if (!accounts.allowAuthAttempt(`plugin-submission:${user.id}`, 5, 24 * 60 * 60_000, 24 * 60 * 60_000)) return reply.code(429).send(error('PLUGIN_SUBMISSION_RATE_LIMITED', '今日补录次数已用完'))
    const normalized = `${segments[0]}/${segments[1]}`
    return reply.code(201).send({ submission: accounts.createPluginSubmission(user.id, `https://github.com/${normalized}`, normalized) })
  })
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
      if (cause instanceof Error && ['AUTH_USERNAME_EXISTS', 'AUTH_USERNAME_RESERVED', 'AUTH_EMAIL_EXISTS'].includes(cause.message)) return reply.code(409).send(error('AUTH_IDENTITY_EXISTS', '该用户名或邮箱暂不可用'))
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
  app.get('/v1/me/profile', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return { profile: accounts.usernameProfile(user.id) }
  })
  app.patch<{ Body: { username?: unknown; currentPassword?: unknown } }>('/v1/me/profile', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { username, currentPassword } = request.body ?? {}
    if (!validUsername(username) || typeof currentPassword !== 'string') return reply.code(400).send(error('AUTH_INVALID_USERNAME_CHANGE', '用户名须为 3–32 位，并以字母或数字开头'))
    try {
      const updated = await accounts.changeUsername(user.id, currentPassword, username, context(request))
      return { user: publicUser(updated), profile: accounts.usernameProfile(user.id) }
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause
      if (cause.message === 'AUTH_CURRENT_PASSWORD_INVALID') return reply.code(401).send(error(cause.message, '当前密码错误'))
      if (cause.message === 'AUTH_USERNAME_UNCHANGED') return reply.code(400).send(error(cause.message, '新账号名与当前账号名相同'))
      if (['AUTH_USERNAME_EXISTS','AUTH_USERNAME_RESERVED'].includes(cause.message)) return reply.code(409).send(error('AUTH_USERNAME_UNAVAILABLE', '该账号名已被占用或仍在保留期'))
      if (cause.message.startsWith('AUTH_USERNAME_COOLDOWN:')) return reply.code(409).send(error('AUTH_USERNAME_COOLDOWN', '账号名每 30 天只能修改一次', { nextChangeAt: cause.message.slice('AUTH_USERNAME_COOLDOWN:'.length) }))
      throw cause
    }
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
  app.get('/v1/me/notification-preferences', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return { preferences: accounts.notificationPreferences(user.id) }
  })
  app.patch<{ Body: Partial<Record<keyof NotificationPreferences, unknown>> }>('/v1/me/notification-preferences', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const current = accounts.notificationPreferences(user.id); const body = request.body ?? {}
    const keys: Array<keyof NotificationPreferences> = ['pluginUpdates','discussionReplies','collectionUpdates','platformReleases']
    if (Object.keys(body).some(key => !keys.includes(key as keyof NotificationPreferences)) || keys.some(key => body[key] !== undefined && typeof body[key] !== 'boolean')) return reply.code(400).send(error('NOTIFICATION_PREFERENCES_INVALID', '通知偏好设置无效'))
    const preferences = Object.fromEntries(keys.map(key => [key, body[key] ?? current[key]])) as unknown as NotificationPreferences
    return { preferences: accounts.updateNotificationPreferences(user.id, preferences) }
  })
  app.get('/v1/me/saved-searches', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { items: accounts.savedSearches(user.id) } })
  app.post<{ Body: { name?: unknown; query?: unknown } }>('/v1/me/saved-searches', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { name, query } = request.body ?? {}; const allowed = new Set(['q','kind','surface','topic','author','language','license','sort'])
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60 || typeof query !== 'object' || query === null || Array.isArray(query)) return reply.code(400).send(error('SAVED_SEARCH_INVALID', '搜索名称或筛选条件无效'))
    const entries = Object.entries(query as Record<string, unknown>)
    if (entries.some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || value.length > 200)) return reply.code(400).send(error('SAVED_SEARCH_INVALID', '筛选条件包含不支持的字段'))
    return reply.code(201).send({ search: accounts.createSavedSearch(user.id, name.trim(), Object.fromEntries(entries) as Record<string, string>) })
  })
  app.delete<{ Params: { id: string } }>('/v1/me/saved-searches/:id', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { ok: accounts.deleteSavedSearch(user.id, request.params.id) } })
  app.get<{ Querystring: PageQuery }>('/v1/collections', async request => accounts.publicCollections({
    ...(request.query.q ? { q: request.query.q } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 20),
  }))
  app.get<{ Params: { id: string } }>('/v1/collections/:id', async (request, reply) => {
    const collection = accounts.publicCollection(request.params.id)
    return collection === undefined ? reply.code(404).send(error('COLLECTION_NOT_FOUND', '公开合集不存在')) : { collection }
  })
  app.post<{ Params: { id: string } }>('/v1/collections/:id/clone', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const collection = await accounts.cloneCollection(user.id, request.params.id)
    return collection === undefined ? reply.code(404).send(error('COLLECTION_NOT_FOUND', '公开合集不存在')) : reply.code(201).send({ collection })
  })
  app.get('/v1/me/collections', async (request, reply) => { const user = requireUser(request, reply); if (user === undefined) return; return { items: accounts.userCollections(user.id) } })
  app.post<{ Body: { name?: unknown; description?: unknown; pluginIds?: unknown; visibility?: unknown } }>('/v1/me/collections', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { name, description, pluginIds, visibility = 'private' } = request.body ?? {}
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof description !== 'string' || description.length > 500 || !Array.isArray(pluginIds) || !pluginIds.every(id => typeof id === 'string') || !['private','public'].includes(String(visibility))) return reply.code(400).send(error('COLLECTION_INVALID', '合集名称、说明、可见性或插件列表无效'))
    return reply.code(201).send({ collection: await accounts.createCollection(user.id, name.trim(), description.trim(), pluginIds as string[], visibility as 'private' | 'public') })
  })
  app.patch<{ Params: { id: string }; Body: { name?: unknown; description?: unknown; pluginIds?: unknown; visibility?: unknown } }>('/v1/me/collections/:id', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { name, description, pluginIds, visibility } = request.body ?? {}
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof description !== 'string' || description.length > 500 || !Array.isArray(pluginIds) || !pluginIds.every(id => typeof id === 'string') || !['private','public'].includes(String(visibility))) return reply.code(400).send(error('COLLECTION_INVALID', '合集名称、说明、可见性或插件列表无效'))
    const collection = await accounts.updateCollection(user.id, request.params.id, { name: name.trim(), description: description.trim(), pluginIds: pluginIds as string[], visibility: visibility as 'private' | 'public' })
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

  app.get<{ Querystring: PageQuery }>('/v1/reviews', async request => accounts.recentReviews({
    page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 20),
  }))
  app.get<{ Querystring: PageQuery & { pluginId?: string } }>('/v1/discussions', async request => accounts.discussionThreads({
    ...(request.query.q ? { q: request.query.q } : {}), ...(request.query.pluginId ? { pluginId: request.query.pluginId } : {}),
    page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 20),
  }))
  app.post<{ Body: { title?: unknown; body?: unknown; pluginId?: unknown } }>('/v1/discussions', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { title, body, pluginId } = request.body ?? {}
    if (typeof title !== 'string' || title.trim().length < 4 || title.trim().length > 120 || typeof body !== 'string' || body.trim().length < 10 || body.trim().length > 5000 || (pluginId !== undefined && typeof pluginId !== 'string')) return reply.code(400).send(error('DISCUSSION_INVALID', '标题须为 4–120 字，正文须为 10–5000 字'))
    if (!accounts.allowAuthAttempt(`discussion:thread:${user.id}`, 3, 10 * 60_000, 10 * 60_000)) return reply.code(429).send(error('DISCUSSION_RATE_LIMITED', '发帖过于频繁，请稍后再试'))
    try { return reply.code(201).send({ thread: await accounts.createDiscussion(user.id, title.trim(), body.trim(), typeof pluginId === 'string' && pluginId ? pluginId : undefined) }) }
    catch (cause) { if (cause instanceof Error && cause.message === 'CATALOG_PLUGIN_NOT_PUBLIC') return reply.code(404).send(error('CATALOG_PLUGIN_NOT_PUBLIC', '关联插件不存在或未公开')); throw cause }
  })
  app.get<{ Params: { id: string } }>('/v1/discussions/:id', async (request, reply) => {
    const thread = accounts.discussionThread(request.params.id)
    return thread === undefined ? reply.code(404).send(error('DISCUSSION_NOT_FOUND', '讨论不存在或不可见')) : { thread }
  })
  app.delete<{ Params: { id: string } }>('/v1/discussions/:id', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return { ok: await accounts.deleteDiscussionContent(user.id, 'thread', request.params.id) }
  })
  app.get<{ Params: { id: string }; Querystring: PageQuery }>('/v1/discussions/:id/replies', async (request, reply) => {
    const result = accounts.discussionReplies(request.params.id, { page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 30) })
    return result === undefined ? reply.code(404).send(error('DISCUSSION_NOT_FOUND', '讨论不存在或不可见')) : result
  })
  app.post<{ Params: { id: string }; Body: { body?: unknown } }>('/v1/discussions/:id/replies', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const body = request.body?.body
    if (typeof body !== 'string' || body.trim().length < 2 || body.trim().length > 3000) return reply.code(400).send(error('DISCUSSION_REPLY_INVALID', '回复须为 2–3000 字'))
    if (!accounts.allowAuthAttempt(`discussion:reply:${user.id}`, 10, 10 * 60_000, 10 * 60_000)) return reply.code(429).send(error('DISCUSSION_RATE_LIMITED', '回复过于频繁，请稍后再试'))
    try { return reply.code(201).send({ reply: await accounts.createDiscussionReply(user.id, request.params.id, body.trim()) }) }
    catch (cause) {
      if (cause instanceof Error && cause.message === 'DISCUSSION_LOCKED') return reply.code(409).send(error('DISCUSSION_LOCKED', '该讨论已锁定'))
      if (cause instanceof Error && cause.message === 'DISCUSSION_NOT_FOUND') return reply.code(404).send(error('DISCUSSION_NOT_FOUND', '讨论不存在或不可见'))
      throw cause
    }
  })
  app.get<{ Params: { id: string } }>('/v1/me/discussions/:id/subscription', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    if (accounts.discussionThread(request.params.id) === undefined) return reply.code(404).send(error('DISCUSSION_NOT_FOUND', '讨论不存在或不可见'))
    return { subscribed: accounts.discussionSubscription(user.id, request.params.id) }
  })
  app.put<{ Params: { id: string }; Body: { subscribed?: unknown } }>('/v1/me/discussions/:id/subscription', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    if (typeof request.body?.subscribed !== 'boolean') return reply.code(400).send(error('DISCUSSION_SUBSCRIPTION_INVALID', '关注状态无效'))
    try { return { subscribed: accounts.setDiscussionSubscription(user.id, request.params.id, request.body.subscribed) } }
    catch (cause) { if (cause instanceof Error && cause.message === 'DISCUSSION_NOT_FOUND') return reply.code(404).send(error('DISCUSSION_NOT_FOUND', '讨论不存在或不可见')); throw cause }
  })
  app.delete<{ Params: { id: string } }>('/v1/discussion-replies/:id', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return { ok: await accounts.deleteDiscussionContent(user.id, 'reply', request.params.id) }
  })
  app.post<{ Body: { targetType?: unknown; targetId?: unknown; reason?: unknown } }>('/v1/reports', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const { targetType, targetId, reason } = request.body ?? {}
    if (!['thread','reply','review','collection'].includes(String(targetType)) || typeof targetId !== 'string' || typeof reason !== 'string' || reason.trim().length < 4 || reason.trim().length > 500) return reply.code(400).send(error('REPORT_INVALID', '举报目标或原因无效'))
    if (!accounts.allowAuthAttempt(`report:${user.id}`, 10, 60 * 60_000, 60 * 60_000)) return reply.code(429).send(error('REPORT_RATE_LIMITED', '举报提交过于频繁'))
    try { return reply.code(201).send({ created: await accounts.createReport(user.id, targetType as 'thread' | 'reply' | 'review' | 'collection', targetId, reason.trim()) }) }
    catch (cause) { if (cause instanceof Error && cause.message === 'REPORT_TARGET_NOT_FOUND') return reply.code(404).send(error('REPORT_TARGET_NOT_FOUND', '举报目标不存在')); throw cause }
  })
  app.get<{ Querystring: PageQuery }>('/v1/activity', async (request, reply) => {
    const categories = ['plugin','platform','discussion','collection'] as const
    if (request.query.category !== undefined && !categories.includes(request.query.category as typeof categories[number])) return reply.code(400).send(error('ACTIVITY_CATEGORY_INVALID', '动态分类无效'))
    return accounts.activityFeed({ ...(request.query.category === undefined ? {} : { category: request.query.category as typeof categories[number] }), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.get<{ Querystring: PageQuery }>('/v1/me/notifications', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    return accounts.notifications(user.id, { page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.post<{ Body: { ids?: unknown } }>('/v1/me/notifications/read', async (request, reply) => {
    const user = requireUser(request, reply); if (user === undefined) return
    const ids = request.body?.ids
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every(id => typeof id === 'string'))) return reply.code(400).send(error('NOTIFICATION_IDS_INVALID', '通知 ID 列表无效'))
    return { updated: accounts.markNotificationsRead(user.id, ids as string[] | undefined) }
  })

  app.get('/v1/admin/overview', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    const current = presence.summary(); const history = accounts.presenceHistory()
    return {
      ...accounts.summary(),
      githubSync: { authenticated: options.githubToken !== undefined, batchLimit: options.githubToken === undefined ? 15 : 60 },
      presence: { ...current, peak24h: Math.max(current.peak24h, history.peak24h), buckets: history.buckets },
    }
  })
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
  app.get<{ Params: { id: string } }>('/v1/admin/users/:id/username-history', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; const profile = accounts.usernameProfile(request.params.id); return profile === undefined ? reply.code(404).send(error('ADMIN_USER_NOT_FOUND', '用户不存在')) : { profile } })
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
  app.get<{ Params: { id: string; revisionId: string } }>('/v1/admin/plugins/:id/revisions/:revisionId', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    const revision = accounts.pluginRevision(request.params.id, request.params.revisionId, true)
    return revision === undefined ? reply.code(404).send(error('CATALOG_REVISION_NOT_FOUND', '插件版本不存在')) : { revision }
  })
  app.patch<{ Params: { id: string; revisionId: string }; Body: { title?: unknown; summary?: unknown; changes?: unknown; breakingChanges?: unknown; sourceUrl?: unknown } }>('/v1/admin/plugins/:id/revisions/:revisionId/changelog', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { title, summary, changes, breakingChanges, sourceUrl } = request.body ?? {}
    const validChanges = Array.isArray(changes) && changes.every(item => typeof item === 'object' && item !== null && !Array.isArray(item) && ['added','changed','fixed','removed','security','other'].includes(String((item as Record<string, unknown>).type)) && typeof (item as Record<string, unknown>).text === 'string')
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 180 || typeof summary !== 'string' || summary.trim().length < 2 || summary.trim().length > 800 || !validChanges || changes.length > 40 || !Array.isArray(breakingChanges) || !breakingChanges.every(item => typeof item === 'string' && item.length <= 400) || breakingChanges.length > 12 || (sourceUrl !== undefined && !validGitHubUrl(sourceUrl))) return reply.code(400).send(error('CHANGELOG_INVALID', '更新日志内容或来源地址无效'))
    const release = accounts.updateRevisionChange(admin.id, request.params.id, request.params.revisionId, {
      title: title.trim(), summary: summary.trim(), changes: (changes as RevisionChangeItem[]).map(item => ({ ...item, text: item.text.trim().slice(0, 400) })),
      breakingChanges: (breakingChanges as string[]).map(item => item.trim()).filter(Boolean), ...(typeof sourceUrl === 'string' ? { sourceUrl } : {}),
    }, context(request))
    return release === undefined ? reply.code(404).send(error('CATALOG_REVISION_NOT_FOUND', '插件版本不存在')) : { release }
  })
  app.post<{ Params: { id: string; revisionId: string } }>('/v1/admin/plugins/:id/revisions/:revisionId/changelog/retry', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const revision = accounts.pluginRevision(request.params.id, request.params.revisionId, true)
    if (revision === undefined) return reply.code(404).send(error('CATALOG_REVISION_NOT_FOUND', '插件版本不存在'))
    if (!accounts.allowAuthAttempt(`changelog:retry:${admin.id}`, 10, 10 * 60_000, 10 * 60_000)) return reply.code(429).send(error('CHANGELOG_RETRY_RATE_LIMITED', '更新日志重新采集过于频繁'))
    try {
      const notes = await collectGitHubReleaseNotes(revision.record, options.githubToken)
      return { release: accounts.refreshRevisionChange(admin.id, request.params.id, request.params.revisionId, notes, context(request)) }
    } catch (cause) {
      request.log.warn({ cause, pluginId: request.params.id, revisionId: request.params.revisionId }, 'changelog refresh failed')
      return reply.code(502).send(error('CHANGELOG_REFRESH_FAILED', '无法从 GitHub 重新采集更新日志'))
    }
  })
  app.post('/v1/admin/sync-runs', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    try { return reply.code(202).send({ run: sync.create(admin.id, undefined, context(request)) }) } catch (cause) { if (cause instanceof Error && cause.message === 'SYNC_ALREADY_RUNNING') return reply.code(409).send(error('SYNC_ALREADY_RUNNING', '已有同步任务正在运行')); throw cause }
  })
  app.get('/v1/admin/sync-runs', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return { ...accounts.listSyncRuns(), github: { authenticated: options.githubToken !== undefined, batchLimit: options.githubToken === undefined ? 15 : 60 } }
  })
  app.get<{ Querystring: PageQuery }>('/v1/admin/media', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.adminMedia({ ...(request.query.status ? { status: request.query.status } : {}), ...(request.query.q ? { q: request.query.q } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.get<{ Querystring: PageQuery }>('/v1/admin/media-reports', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.adminMediaReports({ ...(request.query.status ? { status: request.query.status } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.patch<{ Params: { id: string }; Body: { status?: unknown; resolution?: unknown } }>('/v1/admin/media-reports/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { status, resolution } = request.body ?? {}
    if (!['resolved','dismissed'].includes(String(status)) || typeof resolution !== 'string' || resolution.trim().length < 3 || resolution.trim().length > 500) return reply.code(400).send(error('PLUGIN_MEDIA_REPORT_RESOLUTION_INVALID', '媒体反馈处理参数无效'))
    const ok = accounts.resolveMediaReport(admin.id, request.params.id, status as 'resolved' | 'dismissed', resolution.trim(), context(request))
    return ok ? { ok: true } : reply.code(404).send(error('PLUGIN_MEDIA_REPORT_NOT_FOUND', '媒体反馈记录不存在'))
  })
  app.post<{ Params: { id: string } }>('/v1/admin/plugins/:id/media/retry', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const cacheKeys = accounts.resetPluginMedia(admin.id, request.params.id, context(request))
    if (cacheKeys === undefined) return reply.code(404).send(error('ADMIN_PLUGIN_NOT_FOUND', '插件不存在'))
    await media.clear(cacheKeys)
    return { ok: true, cleared: cacheKeys.length }
  })
  app.get<{ Querystring: PageQuery }>('/v1/admin/plugin-submissions', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.adminPluginSubmissions({ ...(request.query.status ? { status: request.query.status } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.patch<{ Params: { id: string }; Body: { status?: unknown; note?: unknown } }>('/v1/admin/plugin-submissions/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { status, note } = request.body ?? {}
    if (!['pending','accepted','rejected'].includes(String(status)) || (note !== undefined && (typeof note !== 'string' || note.length > 500))) return reply.code(400).send(error('PLUGIN_SUBMISSION_MODERATION_INVALID', '补录审核参数无效'))
    if (status === 'rejected' && (typeof note !== 'string' || note.trim().length < 3)) return reply.code(400).send(error('PLUGIN_SUBMISSION_NOTE_REQUIRED', '拒绝时请填写原因'))
    const submission = accounts.moderatePluginSubmission(admin.id, request.params.id, status as 'pending' | 'accepted' | 'rejected', typeof note === 'string' ? note.trim() : undefined, context(request))
    return submission === undefined ? reply.code(404).send(error('PLUGIN_SUBMISSION_NOT_FOUND', '补录记录不存在')) : { submission }
  })
  app.get<{ Params: { id: string } }>('/v1/admin/sync-runs/:id', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; const run = accounts.syncRun(request.params.id); return run ?? reply.code(404).send(error('SYNC_RUN_NOT_FOUND', '同步任务不存在')) })
  app.post<{ Params: { id: string } }>('/v1/admin/sync-runs/:id/retry', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    if (accounts.syncRun(request.params.id) === undefined) return reply.code(404).send(error('SYNC_RUN_NOT_FOUND', '同步任务不存在'))
    if (accounts.retryableSyncRepositories(request.params.id).length === 0) return reply.code(409).send(error('SYNC_NOTHING_TO_RETRY', '该任务没有失败或延后处理的候选仓库'))
    try { return reply.code(202).send({ run: sync.create(admin.id, request.params.id, context(request)) }) } catch { return reply.code(409).send(error('SYNC_ALREADY_RUNNING', '已有同步任务正在运行')) }
  })
  app.get<{ Querystring: PageQuery & { type?: string } }>('/v1/admin/community', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.communityModeration({
      ...(request.query.q ? { q: request.query.q } : {}), ...(request.query.type ? { type: request.query.type } : {}),
      ...(request.query.status ? { status: request.query.status } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25),
    })
  })
  app.get<{ Querystring: PageQuery }>('/v1/admin/reports', async (request, reply) => {
    if (requireAdmin(request, reply) === undefined) return
    return accounts.reports({ ...(request.query.status ? { status: request.query.status } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) })
  })
  app.patch<{ Params: { id: string }; Body: { status?: unknown; resolution?: unknown } }>('/v1/admin/reports/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { status, resolution } = request.body ?? {}
    if (!['resolved','dismissed'].includes(String(status)) || typeof resolution !== 'string' || resolution.trim().length < 3 || resolution.trim().length > 500) return reply.code(400).send(error('REPORT_RESOLUTION_INVALID', '处理状态或说明无效'))
    const ok = await accounts.resolveReport(admin.id, request.params.id, status as 'resolved' | 'dismissed', resolution.trim(), context(request))
    return ok ? { ok: true } : reply.code(404).send(error('REPORT_NOT_FOUND', '举报记录不存在'))
  })
  app.patch<{ Params: { type: string; id: string }; Body: { status?: unknown; reason?: unknown } }>('/v1/admin/discussions/:type/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { status, reason } = request.body ?? {}; const type = request.params.type
    const allowed = type === 'thread' ? ['open','locked','hidden'] : type === 'reply' ? ['visible','hidden'] : []
    if (!allowed.includes(String(status)) || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) return reply.code(400).send(error('COMMUNITY_MODERATION_INVALID', '治理状态或原因无效'))
    const ok = await accounts.moderateDiscussionContent(admin.id, type as 'thread' | 'reply', request.params.id, status as 'open' | 'locked' | 'hidden' | 'visible', reason.trim(), context(request))
    return ok ? { ok: true } : reply.code(404).send(error('COMMUNITY_CONTENT_NOT_FOUND', '社区内容不存在'))
  })
  app.patch<{ Params: { id: string }; Body: { status?: unknown; reason?: unknown } }>('/v1/admin/collections/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply); if (admin === undefined) return
    const { status, reason } = request.body ?? {}
    if (!['visible','hidden'].includes(String(status)) || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) return reply.code(400).send(error('COLLECTION_MODERATION_INVALID', '合集治理状态或原因无效'))
    const ok = await accounts.moderateCollection(admin.id, request.params.id, status as 'visible' | 'hidden', reason.trim(), context(request))
    return ok ? { ok: true } : reply.code(404).send(error('COLLECTION_NOT_FOUND', '合集不存在'))
  })
  app.get<{ Querystring: PageQuery }>('/v1/admin/audit', async (request, reply) => { if (requireAdmin(request, reply) === undefined) return; return accounts.auditRecords({ ...(request.query.q ? { q: request.query.q } : {}), ...(request.query.action ? { action: request.query.action } : {}), page: pageNumber(request.query.page, 1), pageSize: pageNumber(request.query.pageSize, 25) }) })

  app.post('/v1/admin/github-sync', async (request, reply) => { const admin = requireAdmin(request, reply); if (admin === undefined) return; try { return reply.code(202).send({ run: sync.create(admin.id, undefined, context(request)), deprecated: true }) } catch { return reply.code(409).send(error('SYNC_ALREADY_RUNNING', '已有同步任务正在运行')) } })
  app.setNotFoundHandler((request, reply) => reply.code(404).send(error('API_ROUTE_NOT_FOUND', '接口不存在', { method: request.method, url: request.url })))
  app.addHook('onReady', async () => sync.recover())
  if (options.accountStore === undefined) app.addHook('onClose', async () => accounts.close())
  return app
}
