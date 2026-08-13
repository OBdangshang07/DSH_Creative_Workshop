import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { EnvironmentProbeLike, EnvironmentSnapshot } from '../src/environment.ts'
import { buildCompanion } from '../src/app.ts'

const token = 'test-local-companion-token'
const auth = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' }
const environment: EnvironmentSnapshot = {
  dshVersion: '0.1.0-rc.5',
  nodeVersion: 'v22.19.0',
  pnpmVersion: '11.21.0',
  os: 'windows',
  arch: 'x64',
  dshHome: 'D:\\fixture-dsh-home',
  profiles: ['web'],
  detectedAt: '2026-08-14T00:00:00.000Z',
}
const probe: EnvironmentProbeLike = {
  async inspect() { return environment },
  async profileDigest(profile) { return `sha256:${createHash('sha256').update(profile).digest('hex')}` },
}

describe('local companion', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildCompanion({ authToken: token, probe })
  })

  afterAll(async () => app.close())

  it('reports a structured environment without mutation authority', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/environment' })
    expect(response.statusCode).toBe(200)
    expect(response.json().environment.os).toBe('windows')
    expect(response.json().mode).toBe('dry-run')
  })

  it('rejects mutations without a token and arbitrary command input', async () => {
    const unauthorized = await app.inject({
      method: 'POST', url: '/v1/plans', payload: { pluginVersionId: 'pv.workspace-inspector.1.2.0', profile: 'web' },
    })
    const unsafe = await app.inject({
      method: 'POST', url: '/v1/plans', headers: auth,
      payload: { pluginVersionId: 'pv.workspace-inspector.1.2.0', profile: 'web', argv: ['rm', '-rf'] },
    })
    expect(unauthorized.statusCode).toBe(401)
    expect(unsafe.statusCode).toBe(400)
    expect(unsafe.json().error.code).toBe('POLICY_UNSAFE_INPUT')
  })

  it('rejects unknown plugins and profile traversal', async () => {
    const [unknown, traversal] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/plans', headers: auth, payload: { pluginVersionId: 'missing', profile: 'web' } }),
      app.inject({ method: 'POST', url: '/v1/plans', headers: auth, payload: { pluginVersionId: 'pv.workspace-inspector.1.2.0', profile: '../web' } }),
    ])
    expect(unknown.json().error.code).toBe('CATALOG_VERSION_NOT_INSTALLABLE')
    expect(traversal.json().error.code).toBe('PROFILE_INVALID_NAME')
  })

  it('creates a dependency-aware plan and idempotent dry-run receipt', async () => {
    const planResponse = await app.inject({
      method: 'POST', url: '/v1/plans', headers: auth,
      payload: { pluginVersionId: 'pv.workflow-suite.0.9.0', profile: 'web' },
    })
    expect(planResponse.statusCode).toBe(201)
    const plan = planResponse.json()
    expect(plan.changes.map((change: { pluginId: string }) => change.pluginId)).toEqual([
      'plugin.workspace-inspector', 'plugin.workflow-suite',
    ])
    expect(plan.executionMode).toBe('dry-run')

    const operationRequest = {
      method: 'POST' as const,
      url: '/v1/operations',
      headers: { ...auth, 'idempotency-key': 'fixture-key-001' },
      payload: { planId: plan.planId, confirmationToken: plan.confirmationToken },
    }
    const first = await app.inject(operationRequest)
    const repeated = await app.inject(operationRequest)
    expect(first.statusCode).toBe(201)
    expect(first.json().state).toBe('DRY_RUN_COMPLETED')
    expect(first.json().receipt.rollbackAvailable).toBe(false)
    expect(first.json().receipt.changesDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(repeated.json().operationId).toBe(first.json().operationId)
  })

  it('enforces the origin allowlist', async () => {
    const response = await app.inject({
      method: 'GET', url: '/v1/environment', headers: { origin: 'https://evil.example' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PAIRING_ORIGIN_DENIED')
  })

  it('rejects a non-loopback Host and does not re-expose confirmation tokens', async () => {
    const denied = await app.inject({ method: 'GET', url: '/v1/environment', headers: { host: 'attacker.example' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('PAIRING_HOST_DENIED')

    const created = await app.inject({
      method: 'POST', url: '/v1/plans', headers: auth,
      payload: { pluginVersionId: 'pv.workspace-inspector.1.2.0', profile: 'web' },
    })
    const fetched = await app.inject({ method: 'GET', url: `/v1/plans/${created.json().planId}` })
    expect(created.json().confirmationToken).toBeTypeOf('string')
    expect(fetched.json()).not.toHaveProperty('confirmationToken')
  })
})
