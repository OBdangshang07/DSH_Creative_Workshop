export type PluginKind =
  | 'bundle'
  | 'cordis-plugin'
  | 'skill-pack'
  | 'mcp-bundle'
  | 'integration'
  | 'collection'
  | 'ecosystem-tool'

export type EvidenceLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'
export type EvidenceVerdict = 'pass' | 'warn' | 'fail' | 'inconclusive'
export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical'
export type PluginPlane = 'host' | 'agent' | 'client' | 'external'
export type ActivationMode = 'hot-config' | 'page-refresh' | 'process-restart' | 'new-session' | 'manual'
export type RelationKind =
  | 'requires'
  | 'optional'
  | 'peer'
  | 'conflicts'
  | 'replaces'
  | 'extends'
  | 'provides-service'
  | 'injects-service'
  | 'registers-slot'
  | 'registers-route'
  | 'member-of'

export interface PermissionDeclaration {
  required: boolean
  items: readonly string[]
  reason?: string
}

export interface PermissionSet {
  filesystem: PermissionDeclaration
  process: PermissionDeclaration
  network: PermissionDeclaration
  credentials: PermissionDeclaration
  modelContext: PermissionDeclaration
  telemetry: PermissionDeclaration
  lifecycleScripts: PermissionDeclaration
}

export interface Compatibility {
  dsh: string
  verifiedDshCommits: readonly string[]
  node?: string
  os: readonly ('windows' | 'linux' | 'macos')[]
  arch: readonly ('x64' | 'arm64')[]
  surfaces: readonly ('web' | 'headless' | 'tui' | 'desktop')[]
}

export interface Evidence {
  id: string
  level: EvidenceLevel
  verdict: EvidenceVerdict
  producer: string
  summary: string
  dshVersion?: string
  dshCommit?: string
  os?: string
  checkedAt: string
  expiresAt?: string
}

export interface ReviewSummary {
  count: number
  verifiedCount: number
  score: number
  confidenceLowerBound: number
}

export interface PluginRelation {
  kind: RelationKind
  target: string
  targetLabel: string
  range?: string
  reason?: string
  source: 'package' | 'bundle-patch' | 'manifest' | 'derived' | 'runtime' | 'curated'
}

export interface PluginVersion {
  id: string
  pluginId: string
  version: string
  sourceRef: string
  sourceCommit: string
  artifactDigest: string
  packageName: string
  packageManagerSpec: string
  compatibility: Compatibility
  permissions: PermissionSet
  planes: readonly PluginPlane[]
  activation: ActivationMode
  relations: readonly PluginRelation[]
  evidence: readonly Evidence[]
  publishedAt: string
  yankedAt?: string
}

export interface Plugin {
  id: string
  slug: string
  name: string
  kind: PluginKind
  publisher: string
  summary: string
  description: string
  sourceUrl: string
  homepage?: string
  tags: readonly string[]
  previewUrl?: string
  status: 'candidate' | 'published' | 'suspended' | 'retired'
  featured: boolean
  review: ReviewSummary
  versions: readonly PluginVersion[]
}

export interface CollectionMember {
  pluginId: string
  versionId: string
  role: 'required' | 'optional' | 'alternative'
  order: number
}

export interface CollectionRelease {
  id: string
  collectionId: string
  version: string
  targetProfile: string
  dshRange: string
  members: readonly CollectionMember[]
  permissions: PermissionSet
  evidence: readonly Evidence[]
  publishedAt: string
}

export interface Collection {
  id: string
  slug: string
  name: string
  summary: string
  maintainer: string
  tags: readonly string[]
  releases: readonly CollectionRelease[]
}

export interface Review {
  id: string
  pluginVersionId: string
  author: string
  receiptBacked: boolean
  worksAsDescribed: number
  installationEase: number
  documentation: number
  stability: number
  permissionClarity: number
  body: string
  dshVersion?: string
  os?: string
  createdAt: string
}

export interface CatalogSnapshot {
  revision: string
  generatedAt: string
  plugins: readonly Plugin[]
  collections: readonly Collection[]
  reviews: readonly Review[]
}

export interface RuntimeEnvironment {
  dshVersion?: string
  dshCommit?: string
  nodeVersion: string
  pnpmVersion?: string
  os: 'windows' | 'linux' | 'macos'
  arch: 'x64' | 'arm64'
  profile?: string
}

export interface SearchQuery {
  q?: string
  tags?: readonly string[]
  kind?: PluginKind
  os?: RuntimeEnvironment['os']
  surface?: Compatibility['surfaces'][number]
  maxRisk?: RiskLevel
  sort?: 'relevance' | 'trusted' | 'rating' | 'recent'
}

export interface SearchHit {
  plugin: Plugin
  selectedVersion?: PluginVersion
  score: number
  matchReasons: readonly string[]
  warnings: readonly string[]
  risk: RiskLevel
}

export interface GraphNode {
  id: string
  kind: 'plugin' | 'collection' | 'service' | 'slot' | 'route'
  label: string
  status?: string
}

export interface GraphEdge {
  from: string
  to: string
  kind: RelationKind
  label: string
  source: PluginRelation['source']
}

export interface GraphSnapshot {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, critical: 3 }

export function compareRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_ORDER[left] - RISK_ORDER[right]
}

export function permissionRisk(permissions: PermissionSet): RiskLevel {
  if (permissions.lifecycleScripts.required || permissions.credentials.required) return 'high'
  if (permissions.process.required || permissions.network.required || permissions.filesystem.items.some(item => item.includes('write'))) {
    return 'moderate'
  }
  return 'low'
}

export function latestVersion(plugin: Plugin): PluginVersion | undefined {
  return plugin.versions.find(version => version.yankedAt === undefined)
}
