import type { Collection, GraphSnapshot, Plugin, PluginVersion, Review, ReviewSummary, RiskLevel, SearchHit } from '@dsh-workshop/domain'

const apiBase = import.meta.env.VITE_API_URL ?? '/api'
const companionBase = import.meta.env.VITE_COMPANION_URL ?? '/companion'

export interface CatalogInfo {
  catalogRevision: string
  generatedAt: string
  counts: { plugins: number; collections: number; reviews: number }
  tags: readonly string[]
}

export interface ResolvedCollection {
  collection: Collection
  release: Collection['releases'][number]
  members: readonly { plugin: Plugin; version: PluginVersion; role: string; order: number }[]
  warnings: readonly string[]
}

export interface InstallPlan {
  planId: string
  executionMode: 'dry-run'
  target: { profile: string }
  rootPlugin: { id: string; name: string; version: string }
  lockedInputs: { catalogRevision: string; profileDigest: string; dshVersion?: string }
  changes: readonly { pluginId: string; packageSpec: string; dependencyOf?: string }[]
  permissionsAdded: readonly { scope: string; items: readonly string[]; reason?: string }[]
  warnings: readonly string[]
  conflicts: readonly string[]
  confirmationToken: string
  activation: { requiresRestart: boolean; requiresNewSession: boolean; requiresPageRefresh: boolean }
}

export interface CompanionEnvironment {
  mode: 'dry-run'
  environment: {
    dshVersion?: string
    nodeVersion: string
    pnpmVersion?: string
    os: string
    arch: string
    profiles: readonly string[]
  }
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
  if (!response.ok) {
    throw new ApiError(body.error?.code ?? 'REQUEST_FAILED', body.error?.message ?? `HTTP ${response.status}`, response.status)
  }
  return body as T
}

export function catalogInfo(): Promise<CatalogInfo> {
  return request(`${apiBase}/v1/catalog`)
}

export function searchPlugins(filters: { q: string; tag: string; maxRisk: '' | RiskLevel; sort: string }): Promise<{ items: readonly SearchHit[] }> {
  const query = new URLSearchParams()
  if (filters.q.trim() !== '') query.set('q', filters.q.trim())
  if (filters.tag !== '') query.set('tags', filters.tag)
  if (filters.maxRisk !== '') query.set('maxRisk', filters.maxRisk)
  if (filters.sort !== '') query.set('sort', filters.sort)
  return request(`${apiBase}/v1/plugins?${query}`)
}

export function pluginGraph(pluginId: string): Promise<{ graph: GraphSnapshot }> {
  return request(`${apiBase}/v1/plugins/${encodeURIComponent(pluginId)}/graph`)
}

export function pluginReviews(pluginVersionId: string): Promise<{ summary: ReviewSummary; items: readonly Review[] }> {
  return request(`${apiBase}/v1/plugin-versions/${encodeURIComponent(pluginVersionId)}/reviews`)
}

export function collections(): Promise<{ items: readonly Collection[] }> {
  return request(`${apiBase}/v1/collections`)
}

export function collectionDetails(collectionId: string): Promise<ResolvedCollection> {
  return request(`${apiBase}/v1/collections/${encodeURIComponent(collectionId)}`)
}

export function companionEnvironment(): Promise<CompanionEnvironment> {
  return request(`${companionBase}/v1/environment`)
}

export function createPlan(pluginVersionId: string, profile: string, token: string): Promise<InstallPlan> {
  return request(`${companionBase}/v1/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pluginVersionId, profile }),
  })
}

export function confirmDryRun(plan: InstallPlan, token: string): Promise<{ operationId: string; state: string; receipt: { receiptId: string } }> {
  return request(`${companionBase}/v1/operations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `web-${plan.planId}`,
    },
    body: JSON.stringify({ planId: plan.planId, confirmationToken: plan.confirmationToken }),
  })
}
