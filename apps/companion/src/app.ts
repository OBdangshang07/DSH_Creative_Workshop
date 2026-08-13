import { randomBytes } from 'node:crypto'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { InMemoryCatalogRepository, type CatalogRepository } from '@dsh-workshop/catalog'
import { CompanionInputError, EnvironmentProbe, type EnvironmentProbeLike } from './environment.js'
import { OperationService } from './operations.js'
import { PlanService } from './planner.js'

interface CompanionOptions {
  repository?: CatalogRepository
  probe?: EnvironmentProbeLike
  authToken?: string
  allowedOrigins?: readonly string[]
}

interface PlanBody {
  pluginVersionId?: unknown
  profile?: unknown
  argv?: unknown
  script?: unknown
  path?: unknown
}

interface OperationBody {
  planId?: unknown
  confirmationToken?: unknown
  argv?: unknown
}

function error(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } }
}

function rejectCommandLikeFields(body: object): void {
  for (const field of ['argv', 'script', 'command', 'path']) {
    if (field in body) throw new CompanionInputError('POLICY_UNSAFE_INPUT', `不接受客户端提供的 ${field} 字段`)
  }
}

export async function buildCompanion(options: CompanionOptions = {}): Promise<FastifyInstance> {
  const repository = options.repository ?? new InMemoryCatalogRepository()
  const probe = options.probe ?? new EnvironmentProbe()
  const token = options.authToken ?? randomBytes(32).toString('base64url')
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'])
  const plans = new PlanService(repository, probe)
  const operations = new OperationService(plans)
  const app = Fastify({ logger: false })
  app.decorate('companionToken', token)

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin))
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!new Set(['127.0.0.1', 'localhost', '::1', '[::1]']).has(request.hostname)) {
      return reply.code(403).send(error('PAIRING_HOST_DENIED', 'Host 不是允许的 loopback 地址'))
    }
    const origin = request.headers.origin
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return reply.code(403).send(error('PAIRING_ORIGIN_DENIED', 'Origin 未获本机 Companion 授权'))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      if (request.headers.authorization !== `Bearer ${token}`) {
        return reply.code(401).send(error('PAIRING_TOKEN_REQUIRED', 'Mutation 需要本机 Companion token'))
      }
    }
  })

  app.get('/health', async () => ({ ok: true, service: 'local-companion', mode: 'dry-run' }))
  app.get('/v1/environment', async () => ({ protocol: '1.0', mode: 'dry-run', environment: await probe.inspect() }))
  app.get('/v1/profiles', async () => ({ items: (await probe.inspect()).profiles }))

  app.post<{ Body: PlanBody }>('/v1/plans', async (request, reply) => {
    try {
      const body = request.body ?? {}
      rejectCommandLikeFields(body)
      if (typeof body.pluginVersionId !== 'string' || typeof body.profile !== 'string') {
        return reply.code(400).send(error('PLAN_INVALID_REQUEST', 'pluginVersionId 和 profile 为必填字符串'))
      }
      const plan = await plans.create({ pluginVersionId: body.pluginVersionId, profile: body.profile })
      return reply.code(201).send(plan)
    } catch (cause) {
      if (cause instanceof CompanionInputError) return reply.code(400).send(error(cause.code, cause.message))
      throw cause
    }
  })

  app.get<{ Params: { id: string } }>('/v1/plans/:id', async (request, reply) => {
    const plan = plans.get(request.params.id)
    if (plan === undefined) return reply.code(404).send(error('PLAN_NOT_FOUND', '找不到安装计划'))
    const { confirmationToken: _confirmationToken, ...readablePlan } = plan
    return readablePlan
  })

  app.post<{ Body: OperationBody }>('/v1/operations', async (request, reply) => {
    try {
      const body = request.body ?? {}
      rejectCommandLikeFields(body)
      if (typeof body.planId !== 'string' || typeof body.confirmationToken !== 'string') {
        return reply.code(400).send(error('OPERATION_INVALID_REQUEST', 'planId 和 confirmationToken 为必填字符串'))
      }
      const idempotencyKey = request.headers['idempotency-key']
      if (typeof idempotencyKey !== 'string') {
        return reply.code(400).send(error('OPERATION_IDEMPOTENCY_REQUIRED', '需要 Idempotency-Key 请求头'))
      }
      return reply.code(201).send(operations.create(body.planId, body.confirmationToken, idempotencyKey))
    } catch (cause) {
      if (cause instanceof CompanionInputError) return reply.code(400).send(error(cause.code, cause.message))
      throw cause
    }
  })

  app.get<{ Params: { id: string } }>('/v1/operations/:id', async (request, reply) => {
    const operation = operations.get(request.params.id)
    if (operation === undefined) return reply.code(404).send(error('OPERATION_NOT_FOUND', '找不到操作记录'))
    return operation
  })

  app.get<{ Params: { id: string } }>('/v1/operations/:id/events', async (request, reply) => {
    const operation = operations.get(request.params.id)
    if (operation === undefined) return reply.code(404).send(error('OPERATION_NOT_FOUND', '找不到操作记录'))
    return { items: operation.events }
  })

  app.setNotFoundHandler((request, reply) => reply.code(404).send(error('COMPANION_ROUTE_NOT_FOUND', '接口不存在', { method: request.method, url: request.url })))
  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    companionToken: string
  }
}
