import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApi } from '../src/app.ts'

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
})
