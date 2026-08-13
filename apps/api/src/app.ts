import cors from '@fastify/cors'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
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
  const app = Fastify({ logger: false })
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin))
    },
  })

  app.get('/health', async () => ({ ok: true, service: 'marketplace-api', catalogRevision: repository.snapshot().revision }))

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
