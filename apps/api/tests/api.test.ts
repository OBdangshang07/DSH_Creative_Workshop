import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApi } from '../src/app.ts'
import { AccountStore, type GitHubPluginRecord } from '../src/auth-store.ts'

describe('marketplace API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApi()
  })

  afterAll(async () => app.close())

  it('searches published plugins and returns the catalog revision', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/plugins?q=workspace&tags=capability%2Finspection&maxRisk=moderate' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.catalogRevision).toMatch(/^cr\./)
    expect(body.items.map((item: { plugin: { slug: string } }) => item.plugin.slug)).toEqual(['workspace-inspector'])
  })

  it('returns graph, collection, reviews and stable errors', async () => {
    const [graph, collection, reviews, missing] = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/plugins/workflow-suite/graph' }),
      app.inject({ method: 'GET', url: '/v1/collections/developer-essentials' }),
      app.inject({ method: 'GET', url: '/v1/plugin-versions/pv.workspace-inspector.1.2.0/reviews' }),
      app.inject({ method: 'GET', url: '/v1/plugins/missing' }),
    ])
    expect(graph.json().graph.edges.length).toBeGreaterThan(0)
    expect(collection.json().members).toHaveLength(3)
    expect(reviews.json().summary.verifiedCount).toBe(1)
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('CATALOG_PLUGIN_NOT_FOUND')
  })

  it('resolves a version for a structured environment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/resolve',
      payload: { pluginId: 'workspace-inspector', environment: { os: 'windows', arch: 'x64', nodeVersion: 'v22.19.0' } },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().version.id).toBe('pv.workspace-inspector.1.2.0')
  })

  it('accepts a structured community review and recomputes the live summary', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/plugin-versions/pv.workspace-inspector.1.2.0/reviews',
      payload: {
        author: 'community-tester',
        worksAsDescribed: 5,
        installationEase: 4,
        documentation: 5,
        stability: 4,
        permissionClarity: 5,
        body: 'A structured review submitted through the API.',
        os: 'windows',
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().review.receiptBacked).toBe(false)
    expect(created.json().summary.count).toBe(3)
    const read = await app.inject({ method: 'GET', url: '/v1/plugin-versions/pv.workspace-inspector.1.2.0/reviews' })
    expect(read.json().items).toHaveLength(3)
  })

  it('does not expose unverified Topic projects as plugins', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/github-plugins' })
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toEqual([])
    expect(response.json().verificationNotice).toContain('dsh.bundle.patch')
  })
})

describe('account and administration API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const accounts = new AccountStore()
    const verifiedPlugin: GitHubPluginRecord = {
      id: 'github.verified.bundle', fullName: 'community/verified-bundle', name: '@community/verified-bundle',
      packageName: '@community/verified-bundle', author: 'community', description: 'A verified DSH bundle fixture.',
      url: 'https://github.com/community/verified-bundle', stars: 1, forks: 0, updatedAt: '2026-08-14T00:00:00Z',
      pushedAt: '2026-08-14T00:00:00Z', topics: ['dsh-plugin'], kind: 'bundle', surfaces: ['headless'],
      source: 'github-topic', securityReviewed: false,
      verification: { status: 'verified_bundle', commitSha: 'abc123', packageJsonPath: 'package.json', patchPath: 'cordis.patch.yml', checkedAt: '2026-08-14T00:00:00Z' },
    }
    await accounts.initialize(undefined, [verifiedPlugin])
    await accounts.moderatePlugin('system', verifiedPlugin.id, { status: 'approved' })
    app = await buildApi({
      allowedOrigins: ['https://workshop.example'],
      bootstrapAdmin: { username: 'admin', email: 'admin@example.test', password: 'AdminPassword12345' },
      accountStore: accounts,
    })
  })

  afterAll(async () => app.close())

  it('registers and authenticates a normal user with an HttpOnly session', async () => {
    const registered = await app.inject({
      method: 'POST', url: '/v1/auth/register', headers: { origin: 'https://workshop.example' },
      payload: { username: 'normal-user', email: 'normal@example.test', password: 'NormalPassword123' },
    })
    expect(registered.statusCode).toBe(201)
    expect(registered.json().user.role).toBe('user')
    expect(registered.headers['set-cookie']).toContain('HttpOnly')
    expect(registered.headers['set-cookie']).toContain('SameSite=Strict')
    const cookie = registered.headers['set-cookie']!.split(';', 1)[0]!
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } })
    expect(me.json().user.username).toBe('normal-user')

    const pluginId = 'github.verified.bundle'
    const subscribed = await app.inject({
      method: 'POST', url: `/v1/me/subscriptions/${encodeURIComponent(pluginId)}/toggle`,
      headers: { cookie, origin: 'https://workshop.example' },
    })
    expect(subscribed.json().subscriptions).toContain(pluginId)
    const collection = await app.inject({
      method: 'POST', url: '/v1/me/collections', headers: { cookie, origin: 'https://workshop.example' },
      payload: { name: 'My DSH stack', description: 'A saved stack', pluginIds: [pluginId] },
    })
    expect(collection.statusCode).toBe(201)
    const reviewed = await app.inject({
      method: 'POST', url: `/v1/github-plugins/${encodeURIComponent(pluginId)}/reviews`,
      headers: { cookie, origin: 'https://workshop.example' }, payload: { rating: 5, body: 'Works well in my local setup.' },
    })
    expect(reviewed.statusCode).toBe(201)
  })

  it('enforces administrator authorization and supports moderation', async () => {
    const denied = await app.inject({ method: 'GET', url: '/v1/admin/users' })
    expect(denied.statusCode).toBe(403)
    const loggedIn = await app.inject({
      method: 'POST', url: '/v1/auth/login', headers: { origin: 'https://workshop.example' },
      payload: { identity: 'admin', password: 'AdminPassword12345' },
    })
    const cookie = loggedIn.headers['set-cookie']!.split(';', 1)[0]!
    const plugins = await app.inject({ method: 'GET', url: '/v1/admin/plugins', headers: { cookie } })
    const pluginId = plugins.json().items[0].id as string
    const moderated = await app.inject({
      method: 'PATCH', url: `/v1/admin/plugins/${encodeURIComponent(pluginId)}`,
      headers: { cookie, origin: 'https://workshop.example' }, payload: { featured: true },
    })
    expect(moderated.statusCode).toBe(200)
  })

  it('rejects cross-origin mutations', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/auth/login', headers: { origin: 'https://evil.example' },
      payload: { identity: 'admin', password: 'AdminPassword12345' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('AUTH_ORIGIN_DENIED')
  })
})
