import { posix as path } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { GitHubPluginRecord, PluginVerification, SyncCandidateInput } from './auth-store.js'

interface GitHubRepository {
  name?: unknown; full_name?: unknown; description?: unknown; html_url?: unknown; homepage?: unknown
  stargazers_count?: unknown; forks_count?: unknown; language?: unknown; license?: { spdx_id?: unknown } | null
  updated_at?: unknown; pushed_at?: unknown; topics?: unknown; archived?: unknown; fork?: unknown
  default_branch?: unknown; owner?: { login?: unknown }
}
interface GitTreeEntry { path?: unknown; type?: unknown; size?: unknown }
interface RepositoryTree { truncated?: unknown; tree?: GitTreeEntry[] }
interface PackageManifest {
  name?: unknown; exports?: unknown; dependencies?: unknown; peerDependencies?: unknown; engines?: unknown
  dsh?: { bundle?: { patch?: unknown }; client?: { platform?: unknown; inject?: unknown } }
}
interface FetchResponse {
  ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string>
}
export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<FetchResponse>

export interface RepositoryVerificationResult {
  repository: string
  commitSha?: string
  plugins: GitHubPluginRecord[]
  status: 'verified' | 'rejected' | 'failed'
  reason?: string
  evidence: Record<string, unknown>
}

export interface GitHubDiscoveryResult {
  repositories: GitHubRepository[]
  totalCount: number
  rateLimit: { remaining?: number; resetAt?: string }
}

export interface GitHubSyncResult {
  plugins: GitHubPluginRecord[]
  candidates: SyncCandidateInput[]
  discovered: number
  verified: number
  rejected: number
  failed: number
  rateLimit: { remaining?: number; resetAt?: string }
}

export const VERIFIER_VERSION = '2.0.0'

const headers = (token?: string) => ({
  Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Creative-Workshop/0.2', 'X-GitHub-Api-Version': '2022-11-28',
  ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
})

function rateLimit(response: FetchResponse) {
  const remainingText = response.headers?.get('x-ratelimit-remaining')
  const resetText = response.headers?.get('x-ratelimit-reset')
  return {
    ...(remainingText === undefined || remainingText === null ? {} : { remaining: Number(remainingText) }),
    ...(resetText === undefined || resetText === null ? {} : { resetAt: new Date(Number(resetText) * 1000).toISOString() }),
  }
}

function validCandidate(repository: GitHubRepository): boolean {
  const topics = Array.isArray(repository.topics) ? repository.topics : []
  return repository.archived !== true && repository.fork !== true && topics.includes('dsh-plugin') &&
    repository.full_name !== 'deepseek-ai/deepseek-harness' && typeof repository.full_name === 'string' &&
    typeof repository.description === 'string' && repository.description.trim().length >= 12 &&
    typeof repository.html_url === 'string' && typeof repository.pushed_at === 'string' && typeof repository.default_branch === 'string'
}

function safeBundlePatch(packageJsonPath: string, patchSpecifier: unknown): string | undefined {
  if (typeof patchSpecifier !== 'string' || patchSpecifier.trim() === '') return undefined
  const specifier = patchSpecifier.replaceAll('\\', '/')
  if (specifier.startsWith('/') || /^(?:[a-z]+:|\\\\)/i.test(specifier)) return undefined
  const patchPath = path.normalize(path.join(path.dirname(packageJsonPath), specifier))
  if (patchPath === '..' || patchPath.startsWith('../')) return undefined
  return patchPath.replace(/^\.\//, '')
}

function patchEvidence(value: unknown): { entryIds: string[]; moduleSpecifiers: string[] } | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const entries: Record<string, unknown>[] = []
  for (const layer of value) {
    if (typeof layer !== 'object' || layer === null || Array.isArray(layer)) continue
    const record = layer as Record<string, unknown>
    if (Array.isArray(record.insert)) entries.push(...record.insert.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry)))
    else if (typeof record.id === 'string') entries.push(record)
  }
  const valid = entries.filter(entry => typeof entry.id === 'string' && entry.id.trim() !== '' &&
    (typeof entry.name === 'string' || entry.config !== undefined || entry.disabled !== undefined))
  if (valid.length === 0) return undefined
  return {
    entryIds: [...new Set(valid.map(entry => String(entry.id)))],
    moduleSpecifiers: [...new Set(valid.flatMap(entry => typeof entry.name === 'string' ? [entry.name] : []))],
  }
}

function rawUrl(fullName: string, commitSha: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${fullName}/${commitSha}/${filePath.split('/').map(encodeURIComponent).join('/')}`
}

async function fetchText(fetcher: Fetcher, url: string, token?: string): Promise<string | undefined> {
  const response = await fetcher(url, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
  return response.ok ? response.text() : undefined
}

function pluginId(fullName: string, packageJsonPath: string): string {
  const base = `${fullName}.${path.dirname(packageJsonPath)}`.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/\.+$/, '')
  return `github.${base}`
}

function kindFor(manifest: PackageManifest, patchText: string): string {
  if (manifest.dsh?.client?.platform === 'web') return 'web-ui'
  if (/\btui\b|terminal/i.test(patchText)) return 'tui'
  if (/\bmcp\b/i.test(patchText)) return 'mcp-bundle'
  return 'bundle'
}

function surfacesFor(manifest: PackageManifest, kind: string): string[] {
  if (manifest.dsh?.client?.platform === 'web' || kind === 'web-ui') return ['web']
  if (kind === 'tui') return ['tui', 'headless']
  return ['web', 'headless']
}

function dependenciesFor(manifest: PackageManifest): Set<string> {
  const keys = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : []
  return new Set([...keys(manifest.dependencies), ...keys(manifest.peerDependencies)])
}

export async function discoverGitHubTopic(token?: string, fetcher: Fetcher = fetch): Promise<GitHubDiscoveryResult> {
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', 'topic:dsh-plugin archived:false fork:false')
  url.searchParams.set('sort', 'stars'); url.searchParams.set('order', 'desc'); url.searchParams.set('per_page', '100')
  const response = await fetcher(url, { headers: headers(token), signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GITHUB_DISCOVERY_FAILED_${response.status}`)
  const body = await response.json() as { items?: GitHubRepository[]; total_count?: number }
  return { repositories: (body.items ?? []).filter(validCandidate).slice(0, 60), totalCount: Number(body.total_count ?? 0), rateLimit: rateLimit(response) }
}

export async function verifyGitHubRepositoryDetailed(repository: GitHubRepository, token?: string, fetcher: Fetcher = fetch): Promise<RepositoryVerificationResult> {
  const repositoryName = typeof repository.full_name === 'string' ? repository.full_name : 'unknown'
  if (!validCandidate(repository)) return { repository: repositoryName, plugins: [], status: 'rejected', reason: 'NOT_A_VALID_TOPIC_CANDIDATE', evidence: {} }
  const fullName = repository.full_name as string
  const branch = repository.default_branch as string
  const commitResponse = await fetcher(`https://api.github.com/repos/${fullName}/commits/${encodeURIComponent(branch)}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) })
  if (!commitResponse.ok) return { repository: fullName, plugins: [], status: 'failed', reason: `COMMIT_FETCH_${commitResponse.status}`, evidence: {} }
  const commit = await commitResponse.json() as { sha?: unknown }
  if (typeof commit.sha !== 'string') return { repository: fullName, plugins: [], status: 'failed', reason: 'COMMIT_SHA_MISSING', evidence: {} }
  const treeResponse = await fetcher(`https://api.github.com/repos/${fullName}/git/trees/${commit.sha}?recursive=1`, { headers: headers(token), signal: AbortSignal.timeout(20_000) })
  if (!treeResponse.ok) return { repository: fullName, commitSha: commit.sha, plugins: [], status: 'failed', reason: `TREE_FETCH_${treeResponse.status}`, evidence: {} }
  const tree = await treeResponse.json() as RepositoryTree
  if (tree.truncated === true || !Array.isArray(tree.tree)) return { repository: fullName, commitSha: commit.sha, plugins: [], status: 'failed', reason: 'TREE_TRUNCATED_OR_INVALID', evidence: {} }

  const files = new Map<string, GitTreeEntry>()
  for (const entry of tree.tree) if (entry.type === 'blob' && typeof entry.path === 'string') files.set(entry.path, entry)
  const packagePaths = [...files.keys()].filter(file => file === 'package.json' || file.endsWith('/package.json'))
    .filter(file => !/(^|\/)(?:node_modules|vendor|fixtures?|examples?|tests?|archive)(\/|$)/i.test(file)).slice(0, 100)
  const plugins: GitHubPluginRecord[] = []
  const failures: Array<{ packageJsonPath: string; reason: string }> = []

  for (const packageJsonPath of packagePaths) {
    const packageEntry = files.get(packageJsonPath)
    if (typeof packageEntry?.size === 'number' && packageEntry.size > 256_000) { failures.push({ packageJsonPath, reason: 'MANIFEST_TOO_LARGE' }); continue }
    const manifestText = await fetchText(fetcher, rawUrl(fullName, commit.sha, packageJsonPath), token)
    if (manifestText === undefined) { failures.push({ packageJsonPath, reason: 'MANIFEST_FETCH_FAILED' }); continue }
    let manifest: PackageManifest
    try { manifest = JSON.parse(manifestText) as PackageManifest } catch { failures.push({ packageJsonPath, reason: 'MANIFEST_JSON_INVALID' }); continue }
    if (manifest.dsh?.bundle === undefined) continue
    if (typeof manifest.name !== 'string' || manifest.name.trim() === '') { failures.push({ packageJsonPath, reason: 'PACKAGE_NAME_MISSING' }); continue }
    const patchPath = safeBundlePatch(packageJsonPath, manifest.dsh.bundle.patch)
    if (patchPath === undefined) { failures.push({ packageJsonPath, reason: 'PATCH_PATH_INVALID' }); continue }
    if (!files.has(patchPath)) { failures.push({ packageJsonPath, reason: 'PATCH_FILE_MISSING' }); continue }
    const patchEntry = files.get(patchPath)
    if (typeof patchEntry?.size === 'number' && patchEntry.size > 512_000) { failures.push({ packageJsonPath, reason: 'PATCH_TOO_LARGE' }); continue }
    const patchText = await fetchText(fetcher, rawUrl(fullName, commit.sha, patchPath), token)
    if (patchText === undefined) { failures.push({ packageJsonPath, reason: 'PATCH_FETCH_FAILED' }); continue }
    let evidence: ReturnType<typeof patchEvidence>
    try { evidence = patchEvidence(parseYaml(patchText.replace(/!!js\s+/g, ''))) } catch { failures.push({ packageJsonPath, reason: 'PATCH_YAML_INVALID' }); continue }
    if (evidence === undefined) { failures.push({ packageJsonPath, reason: 'CORDIS_ENTRIES_MISSING' }); continue }
    const dependencies = dependenciesFor(manifest)
    const dshDependencies = [...dependencies].filter(name => name.includes('deepseek-ai') || name.includes('cordis') || name.includes('dsh'))
    const kind = kindFor(manifest, patchText)
    const checkedAt = new Date().toISOString()
    const verification: PluginVerification = {
      status: 'verified_bundle', commitSha: commit.sha, packageJsonPath, patchPath, checkedAt,
      verifierVersion: VERIFIER_VERSION, entryIds: evidence.entryIds, moduleSpecifiers: evidence.moduleSpecifiers,
    }
    if (dshDependencies.length === 0 && evidence.moduleSpecifiers.length === 0) {
      failures.push({ packageJsonPath, reason: 'DSH_DEPENDENCY_EVIDENCE_WEAK' })
      continue
    }
    plugins.push({
      id: pluginId(fullName, packageJsonPath), fullName, name: manifest.name, packageName: manifest.name,
      packagePath: path.dirname(packageJsonPath) === '.' ? '.' : path.dirname(packageJsonPath),
      author: typeof repository.owner?.login === 'string' ? repository.owner.login : fullName.split('/')[0]!,
      description: repository.description as string, url: repository.html_url as string,
      ...(typeof repository.homepage === 'string' && repository.homepage !== '' ? { homepage: repository.homepage } : {}),
      stars: typeof repository.stargazers_count === 'number' ? repository.stargazers_count : 0,
      forks: typeof repository.forks_count === 'number' ? repository.forks_count : 0,
      ...(typeof repository.language === 'string' ? { language: repository.language } : {}),
      ...(typeof repository.license?.spdx_id === 'string' && repository.license.spdx_id !== 'NOASSERTION' ? { license: repository.license.spdx_id } : {}),
      updatedAt: typeof repository.updated_at === 'string' ? repository.updated_at : repository.pushed_at as string,
      pushedAt: repository.pushed_at as string,
      topics: Array.isArray(repository.topics) ? repository.topics.filter((topic): topic is string => typeof topic === 'string') : [],
      kind, surfaces: surfacesFor(manifest, kind), declaredDependencies: [...dependencies].sort(), dshDependencies: dshDependencies.sort(),
      source: 'github-topic', securityReviewed: false, verification,
    })
  }
  if (plugins.length === 0) return { repository: fullName, commitSha: commit.sha, plugins: [], status: 'rejected', reason: failures[0]?.reason ?? 'DSH_BUNDLE_NOT_FOUND', evidence: { packageCount: packagePaths.length, failures } }
  return { repository: fullName, commitSha: commit.sha, plugins, status: 'verified', evidence: { packageCount: packagePaths.length, bundleCount: plugins.length, failures } }
}

export async function verifyGitHubRepository(repository: GitHubRepository, token?: string, fetcher: Fetcher = fetch): Promise<GitHubPluginRecord | undefined> {
  return (await verifyGitHubRepositoryDetailed(repository, token, fetcher)).plugins[0]
}

export async function fetchGitHubTopicDetailed(token?: string, fetcher: Fetcher = fetch, onProgress?: (progress: { phase: 'discovering' | 'verifying'; discovered: number; processed: number }) => void): Promise<GitHubSyncResult> {
  onProgress?.({ phase: 'discovering', discovered: 0, processed: 0 })
  const discovery = await discoverGitHubTopic(token, fetcher)
  onProgress?.({ phase: 'verifying', discovered: discovery.repositories.length, processed: 0 })
  const results: RepositoryVerificationResult[] = []
  const batchSize = token === undefined ? 3 : 6
  for (let index = 0; index < discovery.repositories.length; index += batchSize) {
    const batch = await Promise.all(discovery.repositories.slice(index, index + batchSize).map(repository => verifyGitHubRepositoryDetailed(repository, token, fetcher).catch(cause => ({
      repository: typeof repository.full_name === 'string' ? repository.full_name : 'unknown', plugins: [], status: 'failed' as const,
      reason: cause instanceof Error ? cause.message : 'UNKNOWN', evidence: {},
    }))))
    results.push(...batch)
    onProgress?.({ phase: 'verifying', discovered: discovery.repositories.length, processed: results.length })
  }
  const plugins = results.flatMap(result => result.plugins)
  if (discovery.repositories.length > 0 && plugins.length === 0 && results.every(result => result.status === 'failed')) throw new Error('GITHUB_VERIFICATION_UNAVAILABLE')
  return {
    plugins, discovered: discovery.repositories.length, verified: results.filter(result => result.status === 'verified').length,
    rejected: results.filter(result => result.status === 'rejected').length, failed: results.filter(result => result.status === 'failed').length,
    candidates: results.map(result => ({ repository: result.repository, ...(result.commitSha === undefined ? {} : { commitSha: result.commitSha }), status: result.status, bundleCount: result.plugins.length, ...(result.reason === undefined ? {} : { reason: result.reason }), evidence: result.evidence })),
    rateLimit: discovery.rateLimit,
  }
}

export async function fetchGitHubTopic(token?: string, fetcher: Fetcher = fetch): Promise<GitHubPluginRecord[]> {
  return (await fetchGitHubTopicDetailed(token, fetcher)).plugins
}
