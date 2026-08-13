import {
  compareRisk,
  latestVersion,
  permissionRisk,
  type CatalogSnapshot,
  type Collection,
  type CollectionRelease,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type Plugin,
  type PluginVersion,
  type Review,
  type ReviewSummary,
  type RuntimeEnvironment,
  type SearchHit,
  type SearchQuery,
} from '@dsh-workshop/domain'
import { seedCatalog } from './seed.js'

export interface CatalogRepository {
  snapshot(): CatalogSnapshot
  plugin(idOrSlug: string): Plugin | undefined
  pluginVersion(id: string): PluginVersion | undefined
  collection(idOrSlug: string): Collection | undefined
  reviews(pluginVersionId: string): readonly Review[]
}

export interface CommunityCatalogRepository extends CatalogRepository {
  addReview(review: Review): ReviewSummary
}

export class InMemoryCatalogRepository implements CatalogRepository {
  private data: CatalogSnapshot

  constructor(data: CatalogSnapshot = seedCatalog) {
    // Catalog fixtures are JSON-compatible; cloning isolates mutable community
    // submissions between repository instances and tests.
    this.data = JSON.parse(JSON.stringify(data)) as CatalogSnapshot
  }

  snapshot(): CatalogSnapshot {
    return this.data
  }

  plugin(idOrSlug: string): Plugin | undefined {
    return this.data.plugins.find(plugin => plugin.id === idOrSlug || plugin.slug === idOrSlug)
  }

  pluginVersion(id: string): PluginVersion | undefined {
    return this.data.plugins.flatMap(plugin => plugin.versions).find(version => version.id === id)
  }

  collection(idOrSlug: string): Collection | undefined {
    return this.data.collections.find(collection => collection.id === idOrSlug || collection.slug === idOrSlug)
  }

  reviews(pluginVersionId: string): readonly Review[] {
    return this.data.reviews.filter(review => review.pluginVersionId === pluginVersionId)
  }

  addReview(review: Review): ReviewSummary {
    if (this.data.reviews.some(existing => existing.id === review.id)) {
      throw new Error(`Duplicate review id: ${review.id}`)
    }
    const reviews = [...this.data.reviews, review]
    const summary = aggregateReviews(reviews.filter(item => item.pluginVersionId === review.pluginVersionId))
    const plugins = this.data.plugins.map(plugin => plugin.versions.some(version => version.id === review.pluginVersionId)
      ? { ...plugin, review: summary }
      : plugin)
    this.data = { ...this.data, reviews, plugins, generatedAt: new Date().toISOString() }
    return summary
  }
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
}

export function searchCatalog(repository: CatalogRepository, query: SearchQuery = {}): readonly SearchHit[] {
  const words = query.q?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? []
  const tags = query.tags?.map(tag => tag.toLocaleLowerCase()) ?? []
  const hits: SearchHit[] = []

  for (const plugin of repository.snapshot().plugins) {
    if (plugin.status !== 'published') continue
    const selectedVersion = latestVersion(plugin)
    if (selectedVersion === undefined) continue
    const risk = permissionRisk(selectedVersion.permissions)
    if (query.kind !== undefined && plugin.kind !== query.kind) continue
    if (query.os !== undefined && !selectedVersion.compatibility.os.includes(query.os)) continue
    if (query.surface !== undefined && !selectedVersion.compatibility.surfaces.includes(query.surface)) continue
    if (query.maxRisk !== undefined && compareRisk(risk, query.maxRisk) > 0) continue
    if (!tags.every(tag => plugin.tags.some(candidate => candidate.toLocaleLowerCase() === tag))) continue

    const searchable = [plugin.name, plugin.summary, plugin.description, plugin.publisher, ...plugin.tags].join(' ')
    if (!words.every(word => contains(searchable, word))) continue

    const reasons: string[] = []
    let score = plugin.featured ? 2 : 0
    for (const word of words) {
      if (contains(plugin.name, word)) {
        score += 8
        reasons.push(`名称匹配“${word}”`)
      } else if (plugin.tags.some(tag => contains(tag, word))) {
        score += 5
        reasons.push(`标签匹配“${word}”`)
      } else {
        score += 2
        reasons.push(`描述匹配“${word}”`)
      }
    }
    if (tags.length > 0) reasons.push(`匹配 ${tags.length} 个筛选标签`)
    score += plugin.review.confidenceLowerBound * 5 + plugin.review.score
    hits.push({
      plugin,
      selectedVersion,
      score,
      matchReasons: reasons.length === 0 ? ['已发布且具有可安装版本'] : reasons,
      warnings: selectedVersion.permissions.credentials.required ? ['需要凭据权限'] : [],
      risk,
    })
  }

  return hits.sort((left, right) => {
    switch (query.sort) {
      case 'rating': return right.plugin.review.score - left.plugin.review.score || right.score - left.score
      case 'recent': return right.selectedVersion!.publishedAt.localeCompare(left.selectedVersion!.publishedAt)
      case 'trusted': return right.plugin.review.confidenceLowerBound - left.plugin.review.confidenceLowerBound || right.score - left.score
      default: return right.score - left.score
    }
  })
}

export function buildPluginGraph(repository: CatalogRepository, pluginId: string): GraphSnapshot | undefined {
  const root = repository.plugin(pluginId)
  if (root === undefined) return undefined
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  nodes.set(root.id, { id: root.id, kind: 'plugin', label: root.name, status: root.status })

  for (const relation of latestVersion(root)?.relations ?? []) {
    const targetPlugin = repository.plugin(relation.target)
    const nodeKind: GraphNode['kind'] = targetPlugin !== undefined
      ? 'plugin'
      : relation.kind === 'registers-slot'
        ? 'slot'
        : relation.kind === 'registers-route'
          ? 'route'
          : 'service'
    nodes.set(relation.target, {
      id: relation.target,
      kind: nodeKind,
      label: targetPlugin?.name ?? relation.targetLabel,
      ...(targetPlugin === undefined ? {} : { status: targetPlugin.status }),
    })
    edges.push({
      from: root.id,
      to: relation.target,
      kind: relation.kind,
      label: relation.range === undefined ? relation.kind : `${relation.kind} ${relation.range}`,
      source: relation.source,
    })
  }
  return { nodes: [...nodes.values()], edges }
}

export interface ResolvedCollection {
  collection: Collection
  release: CollectionRelease
  members: readonly { plugin: Plugin; version: PluginVersion; role: CollectionRelease['members'][number]['role']; order: number }[]
  warnings: readonly string[]
}

export function resolveCollection(repository: CatalogRepository, collectionId: string): ResolvedCollection | undefined {
  const collection = repository.collection(collectionId)
  const release = collection?.releases[0]
  if (collection === undefined || release === undefined) return undefined
  const warnings: string[] = []
  const members = release.members
    .slice()
    .sort((left, right) => left.order - right.order || left.pluginId.localeCompare(right.pluginId))
    .flatMap(member => {
      const plugin = repository.plugin(member.pluginId)
      const selected = repository.pluginVersion(member.versionId)
      if (plugin === undefined || selected === undefined || selected.yankedAt !== undefined) {
        warnings.push(`无法解析合集成员 ${member.pluginId}@${member.versionId}`)
        return []
      }
      return [{ plugin, version: selected, role: member.role, order: member.order }]
    })
  return { collection, release, members, warnings }
}

function wilsonLowerBound(positive: number, total: number): number {
  if (total === 0) return 0
  const z = 1.96
  const proportion = positive / total
  return (
    proportion + z * z / (2 * total) - z * Math.sqrt((proportion * (1 - proportion) + z * z / (4 * total)) / total)
  ) / (1 + z * z / total)
}

export function aggregateReviews(reviews: readonly Review[]): ReviewSummary {
  if (reviews.length === 0) return { count: 0, verifiedCount: 0, score: 0, confidenceLowerBound: 0 }
  let weightedScore = 0
  let totalWeight = 0
  let positiveWeight = 0
  let verifiedCount = 0
  for (const review of reviews) {
    const score = (
      review.worksAsDescribed + review.installationEase + review.documentation + review.stability + review.permissionClarity
    ) / 5
    const weight = review.receiptBacked ? 2 : 1
    if (review.receiptBacked) verifiedCount += 1
    weightedScore += score * weight
    totalWeight += weight
    if (score >= 4) positiveWeight += weight
  }
  return {
    count: reviews.length,
    verifiedCount,
    score: Number((weightedScore / totalWeight).toFixed(2)),
    confidenceLowerBound: Number(wilsonLowerBound(positiveWeight, totalWeight).toFixed(4)),
  }
}

export interface ResolutionResult {
  catalogRevision: string
  plugin: Plugin
  version?: PluginVersion
  compatible: boolean
  reasons: readonly string[]
}

export function resolvePlugin(
  repository: CatalogRepository,
  pluginId: string,
  environment: RuntimeEnvironment,
): ResolutionResult | undefined {
  const plugin = repository.plugin(pluginId)
  if (plugin === undefined) return undefined
  const selected = plugin.versions.find(version =>
    version.yankedAt === undefined &&
    version.compatibility.os.includes(environment.os) &&
    version.compatibility.arch.includes(environment.arch),
  )
  const reasons = selected === undefined
    ? [`没有适用于 ${environment.os}/${environment.arch} 的未撤回版本`]
    : [`已选择 ${selected.version}`, `支持 ${environment.os}/${environment.arch}`]
  return {
    catalogRevision: repository.snapshot().revision,
    plugin,
    ...(selected === undefined ? {} : { version: selected }),
    compatible: selected !== undefined,
    reasons,
  }
}

export { seedCatalog, seedCollections, seedPlugins, seedReviews } from './seed.js'
