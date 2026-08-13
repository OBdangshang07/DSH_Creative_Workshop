import { describe, expect, it } from 'vitest'
import {
  aggregateReviews,
  buildPluginGraph,
  InMemoryCatalogRepository,
  resolveCollection,
  searchCatalog,
} from '../src/index.ts'

const repository = new InMemoryCatalogRepository()

describe('catalog search and projections', () => {
  it('supports text, tag, environment and risk filters with reasons', () => {
    const hits = searchCatalog(repository, {
      q: 'workspace',
      tags: ['capability/inspection'],
      os: 'windows',
      surface: 'web',
      maxRisk: 'moderate',
    })
    expect(hits.map(hit => hit.plugin.slug)).toEqual(['workspace-inspector'])
    expect(hits[0]?.matchReasons.length).toBeGreaterThan(0)
  })

  it('hides yanked versions and filters credential risk', () => {
    const lowRisk = searchCatalog(repository, { maxRisk: 'moderate' })
    expect(lowRisk.some(hit => hit.plugin.slug === 'vision-bridge')).toBe(false)
    expect(lowRisk.find(hit => hit.plugin.slug === 'workspace-inspector')?.selectedVersion?.version).toBe('1.2.0')
  })

  it('projects plugin, service, route and dependency nodes', () => {
    const graph = buildPluginGraph(repository, 'workflow-suite')
    expect(graph?.nodes.map(node => node.kind)).toEqual(expect.arrayContaining(['plugin', 'service', 'route']))
    expect(graph?.edges.some(edge => edge.kind === 'requires')).toBe(true)
  })

  it('resolves collection members in deterministic order', () => {
    const resolved = resolveCollection(repository, 'developer-essentials')
    expect(resolved?.members.map(member => member.order)).toEqual([1, 2, 3])
    expect(resolved?.warnings).toEqual([])
  })

  it('weights receipt-backed reviews and provides a confidence bound', () => {
    const summary = aggregateReviews(repository.reviews('pv.workspace-inspector.1.2.0'))
    expect(summary.verifiedCount).toBe(1)
    expect(summary.score).toBeGreaterThan(4)
    expect(summary.confidenceLowerBound).toBeGreaterThan(0)
  })

  it('keeps card summaries consistent with their version reviews', () => {
    for (const plugin of repository.snapshot().plugins) {
      const version = plugin.versions.find(item => item.yankedAt === undefined)
      expect(version).toBeDefined()
      expect(plugin.review).toEqual(aggregateReviews(repository.reviews(version!.id)))
    }
  })
})
