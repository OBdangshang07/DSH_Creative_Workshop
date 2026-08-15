import { posix as path } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { CollectedReleaseNotes, GitHubPluginRecord, PluginVerification, RevisionChangeItem, SyncCandidateInput } from './auth-store.js'

interface GitHubRepository {
  name?: unknown; full_name?: unknown; description?: unknown; html_url?: unknown; homepage?: unknown
  stargazers_count?: unknown; forks_count?: unknown; language?: unknown; license?: { spdx_id?: unknown } | null
  updated_at?: unknown; pushed_at?: unknown; topics?: unknown; archived?: unknown; fork?: unknown
  default_branch?: unknown; owner?: { login?: unknown }
}
interface GitTreeEntry { path?: unknown; type?: unknown; size?: unknown }
interface RepositoryTree { truncated?: unknown; tree?: GitTreeEntry[] }
interface PackageManifest {
  name?: unknown; version?: unknown; private?: unknown; exports?: unknown; dependencies?: unknown; peerDependencies?: unknown; engines?: unknown
  dsh?: { bundle?: { patch?: unknown }; client?: { platform?: unknown; inject?: unknown }; workshop?: { releaseNotes?: unknown } }
}
interface GitHubRelease { tag_name?: unknown; name?: unknown; body?: unknown; html_url?: unknown; published_at?: unknown }
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
  deferred: number
  bundlesFound: number
  githubAuthenticated: boolean
  rateLimit: { remaining?: number; resetAt?: string }
}

export interface GitHubSyncOptions {
  repositories?: string[]
  maxRepositories?: number
}

export const VERIFIER_VERSION = '2.1.0'

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

function apiFailure(stage: 'COMMIT_FETCH' | 'TREE_FETCH', response: FetchResponse) {
  if (response.status !== 403) return `${stage}_${response.status}`
  const limit = rateLimit(response)
  return limit.remaining === 0 ? 'GITHUB_RATE_LIMIT_EXHAUSTED' : 'GITHUB_SECONDARY_RATE_LIMIT'
}

async function coreRateLimit(token: string | undefined, fetcher: Fetcher) {
  try {
    const response = await fetcher('https://api.github.com/rate_limit', { headers: headers(token), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return {}
    const body = await response.json() as { resources?: { core?: { remaining?: unknown; reset?: unknown } } }
    const remaining = body.resources?.core?.remaining
    const reset = body.resources?.core?.reset
    return {
      ...(typeof remaining === 'number' ? { remaining } : {}),
      ...(typeof reset === 'number' ? { resetAt: new Date(reset * 1000).toISOString() } : {}),
    }
  } catch {
    return {}
  }
}

function validCandidate(repository: GitHubRepository): boolean {
  const topics = Array.isArray(repository.topics) ? repository.topics : []
  return repository.archived !== true && repository.fork !== true && topics.includes('dsh-plugin') &&
    repository.full_name !== 'deepseek-ai/deepseek-harness' && typeof repository.full_name === 'string' &&
    typeof repository.description === 'string' && repository.description.trim().length >= 12 &&
    typeof repository.html_url === 'string' && typeof repository.pushed_at === 'string' && typeof repository.default_branch === 'string'
}

function isDshDependency(name: string): boolean {
  return name === 'cordis' || name.startsWith('@cordisjs/') ||
    /(^|[/@_.-])(?:deepseek-ai|deepseek-harness|dsh)(?:[/@_.-]|$)/i.test(name)
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

const previewName = /^(?:cover|banner|hero|screenshot[^/]*)\.(?:png|jpe?g|webp|gif)$/i

function previewFiles(files: Iterable<string>, packageJsonPath: string): string[] {
  const directory = path.dirname(packageJsonPath)
  const prefix = directory === '.' ? '' : `${directory}/`
  return [...files].flatMap(file => {
    if (!file.startsWith(prefix)) return []
    const relative = file.slice(prefix.length)
    if (/(^|\/)(?:node_modules|vendor|fixtures?|examples?|tests?|archive|scripts?|templates?)(\/|$)/i.test(relative)) return []
    const name = path.basename(relative)
    const screenshotDirectory = /(^|\/)screenshots?\//i.test(relative)
    if (!previewName.test(name) && !(screenshotDirectory && /\.(?:png|jpe?g|webp|gif)$/i.test(name))) return []
    const stem = name.replace(/\.[^.]+$/, '').toLowerCase()
    const role = stem === 'cover' ? 0 : stem === 'banner' ? 1 : stem === 'hero' ? 2 : 3
    const preferredDirectory = relative.toLowerCase().startsWith('preview/') ? 0 : relative.includes('/') ? 2 : 1
    return [{ file, priority: role * 10 + preferredDirectory }]
  }).sort((left, right) => left.priority - right.priority || left.file.length - right.file.length || left.file.localeCompare(right.file))
    .slice(0, 8).map(item => item.file)
}

function packagePreference(plugin: GitHubPluginRecord): number {
  const packagePath = plugin.packagePath ?? '.'
  return packagePath === '.' ? 0 : packagePath.split('/').length * 1000 + packagePath.length
}

async function fetchText(fetcher: Fetcher, url: string, token?: string): Promise<string | undefined> {
  const response = await fetcher(url, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
  return response.ok ? response.text() : undefined
}

function cleanText(value: unknown, maximum = 800): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, maximum)
}

function changeType(text: string, heading = ''): RevisionChangeItem['type'] {
  const value = `${heading} ${text}`.toLowerCase()
  if (/security|安全|漏洞|cve/.test(value)) return 'security'
  if (/remove|removed|delete|deprecated|移除|删除|废弃/.test(value)) return 'removed'
  if (/fix|fixed|bug|修复|纠正/.test(value)) return 'fixed'
  if (/add|added|new|feature|新增|增加/.test(value)) return 'added'
  if (/change|changed|update|improve|调整|更新|优化|改进/.test(value)) return 'changed'
  return 'other'
}

function markdownNotes(markdown: string, version: string | undefined, title: string, sourceType: 'github_release' | 'changelog' | 'commit', sourceUrl: string | undefined, collectedAt: string): CollectedReleaseNotes {
  const limited = markdown.replace(/\r/g, '').slice(0, 80_000)
  const lines = limited.split('\n')
  let heading = ''
  const changes: RevisionChangeItem[] = []
  const breakingChanges: string[] = []
  const paragraphs: string[] = []
  let selected = sourceType !== 'changelog' || version === undefined
  let sawSelectedHeading = false
  for (const raw of lines) {
    const line = raw.trim()
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line)
    if (headingMatch !== null) {
      const text = headingMatch[2]!.trim()
      if (sourceType === 'changelog' && headingMatch[1]!.length <= 2 && version !== undefined) {
        const normalized = version.replace(/^v/i, '').toLowerCase()
        const matches = text.toLowerCase().replace(/^v/, '').includes(normalized)
        if (matches) { selected = true; sawSelectedHeading = true; heading = text; continue }
        if (selected && sawSelectedHeading) break
      }
      if (selected) heading = text
      continue
    }
    if (!selected || line === '') continue
    const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line)?.[1]
    if (bullet !== undefined && changes.length < 40) {
      const text = cleanText(bullet, 400)
      if (text !== undefined) {
        if (/breaking|不兼容|破坏性/i.test(`${heading} ${text}`) && breakingChanges.length < 12) breakingChanges.push(text)
        else changes.push({ type: changeType(text, heading), text })
      }
    } else if (!line.startsWith('```') && paragraphs.length < 3) {
      const text = cleanText(line, 500)
      if (text !== undefined && !/^[-=]{3,}$/.test(text)) paragraphs.push(text)
    }
  }
  const summary = cleanText(paragraphs.join(' '), 800) ?? changes[0]?.text ?? '作者提供了更新记录，但未包含可提取的摘要。'
  return {
    ...(version === undefined ? {} : { version }), title: cleanText(title, 180) ?? '插件更新', summary,
    changes, breakingChanges, sourceType, ...(sourceUrl === undefined ? {} : { sourceUrl }), collectedAt,
  }
}

function changelogHasVersion(markdown: string, version: string | undefined): boolean {
  if (version === undefined) return true
  const normalized = version.replace(/^v/i, '').toLowerCase()
  return markdown.replace(/\r/g, '').split('\n').some(line => /^#{1,2}\s+/.test(line.trim()) && line.toLowerCase().replace(/^#{1,2}\s+v?/, '').includes(normalized))
}

function declaredNotes(value: unknown, version: string | undefined, fallbackTitle: string, collectedAt: string): CollectedReleaseNotes | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const summary = cleanText(record.summary)
  const rawChanges = Array.isArray(record.changes) ? record.changes : []
  const changes = rawChanges.slice(0, 40).flatMap(entry => {
    if (typeof entry === 'string') { const text = cleanText(entry, 400); return text === undefined ? [] : [{ type: changeType(text), text } satisfies RevisionChangeItem] }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>; const text = cleanText(item.text, 400)
    const type = ['added','changed','fixed','removed','security','other'].includes(String(item.type)) ? String(item.type) as RevisionChangeItem['type'] : text === undefined ? 'other' : changeType(text)
    return text === undefined ? [] : [{ type, text }]
  })
  const breakingChanges = (Array.isArray(record.breakingChanges) ? record.breakingChanges : []).flatMap(entry => { const text = cleanText(entry, 400); return text === undefined ? [] : [text] }).slice(0, 12)
  if (summary === undefined && changes.length === 0 && breakingChanges.length === 0) return undefined
  return {
    ...(version === undefined ? {} : { version }), title: cleanText(record.title, 180) ?? fallbackTitle,
    summary: summary ?? changes[0]?.text ?? '作者提供了结构化更新记录。', changes, breakingChanges,
    sourceType: 'declared', ...(cleanText(record.sourceUrl, 500) === undefined ? {} : { sourceUrl: cleanText(record.sourceUrl, 500)! }), collectedAt,
  }
}

function releaseMatches(release: GitHubRelease, version: string | undefined): boolean {
  if (version === undefined) return true
  const normalized = version.replace(/^v/i, '').toLowerCase()
  return [release.tag_name, release.name].some(value => typeof value === 'string' && value.toLowerCase().replace(/^v/, '').includes(normalized))
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
  const resultSets: GitHubRepository[][] = []
  let totalCount = 0
  let latestRateLimit: { remaining?: number; resetAt?: string } = {}
  for (const sort of ['updated', 'stars']) {
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', 'topic:dsh-plugin archived:false fork:false')
    url.searchParams.set('sort', sort); url.searchParams.set('order', 'desc'); url.searchParams.set('per_page', '100')
    const response = await fetcher(url, { headers: headers(token), signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      if (resultSets.length === 0) throw new Error(`GITHUB_DISCOVERY_FAILED_${response.status}`)
      continue
    }
    const body = await response.json() as { items?: GitHubRepository[]; total_count?: number }
    resultSets.push((body.items ?? []).filter(validCandidate))
    totalCount = Math.max(totalCount, Number(body.total_count ?? 0))
    latestRateLimit = rateLimit(response)
  }
  const repositories: GitHubRepository[] = []
  const seen = new Set<string>()
  const longest = Math.max(0, ...resultSets.map(items => items.length))
  for (let index = 0; index < longest && repositories.length < 120; index += 1) {
    for (const items of resultSets) {
      const repository = items[index]
      if (repository === undefined || typeof repository.full_name !== 'string' || seen.has(repository.full_name.toLowerCase())) continue
      seen.add(repository.full_name.toLowerCase())
      repositories.push(repository)
    }
  }
  return { repositories, totalCount, rateLimit: latestRateLimit }
}

export async function verifyGitHubRepositoryDetailed(repository: GitHubRepository, token?: string, fetcher: Fetcher = fetch): Promise<RepositoryVerificationResult> {
  const repositoryName = typeof repository.full_name === 'string' ? repository.full_name : 'unknown'
  if (!validCandidate(repository)) return { repository: repositoryName, plugins: [], status: 'rejected', reason: 'NOT_A_VALID_TOPIC_CANDIDATE', evidence: {} }
  const fullName = repository.full_name as string
  const branch = repository.default_branch as string
  const commitResponse = await fetcher(`https://api.github.com/repos/${fullName}/commits/${encodeURIComponent(branch)}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) })
  if (!commitResponse.ok) return { repository: fullName, plugins: [], status: 'failed', reason: apiFailure('COMMIT_FETCH', commitResponse), evidence: { rateLimit: rateLimit(commitResponse) } }
  const commit = await commitResponse.json() as { sha?: unknown; html_url?: unknown; commit?: { message?: unknown } }
  if (typeof commit.sha !== 'string') return { repository: fullName, plugins: [], status: 'failed', reason: 'COMMIT_SHA_MISSING', evidence: {} }
  const treeResponse = await fetcher(`https://api.github.com/repos/${fullName}/git/trees/${commit.sha}?recursive=1`, { headers: headers(token), signal: AbortSignal.timeout(20_000) })
  if (!treeResponse.ok) return { repository: fullName, commitSha: commit.sha, plugins: [], status: 'failed', reason: apiFailure('TREE_FETCH', treeResponse), evidence: { rateLimit: rateLimit(treeResponse) } }
  const tree = await treeResponse.json() as RepositoryTree
  if (tree.truncated === true || !Array.isArray(tree.tree)) return { repository: fullName, commitSha: commit.sha, plugins: [], status: 'failed', reason: 'TREE_TRUNCATED_OR_INVALID', evidence: {} }

  const files = new Map<string, GitTreeEntry>()
  for (const entry of tree.tree) if (entry.type === 'blob' && typeof entry.path === 'string') files.set(entry.path, entry)
  const fileNames = new Map([...files.keys()].map(file => [file.toLowerCase(), file]))
  const textCache = new Map<string, string | undefined>()
  const cachedText = async (file: string) => {
    if (!textCache.has(file)) textCache.set(file, await fetchText(fetcher, rawUrl(fullName, commit.sha as string, file), token))
    return textCache.get(file)
  }
  let releasesPromise: Promise<GitHubRelease[]> | undefined
  const releases = () => {
    releasesPromise ??= (async () => {
      try {
        const releaseResponse = await fetcher(`https://api.github.com/repos/${fullName}/releases?per_page=20`, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
        if (!releaseResponse.ok) return []
        const value = await releaseResponse.json()
        return Array.isArray(value) ? value as GitHubRelease[] : []
      } catch {
        return []
      }
    })()
    return releasesPromise
  }
  const packagePaths = [...files.keys()].filter(file => file === 'package.json' || file.endsWith('/package.json'))
    .filter(file => !/(^|\/)(?:node_modules|vendor|fixtures?|examples?|tests?|archive|scripts?|templates?)(\/|$)/i.test(file)).slice(0, 100)
  const plugins: GitHubPluginRecord[] = []
  const failures: Array<{ packageJsonPath: string; reason: string }> = []

  for (const packageJsonPath of packagePaths) {
    const packageEntry = files.get(packageJsonPath)
    if (typeof packageEntry?.size === 'number' && packageEntry.size > 256_000) { failures.push({ packageJsonPath, reason: 'MANIFEST_TOO_LARGE' }); continue }
    const manifestText = await fetchText(fetcher, rawUrl(fullName, commit.sha, packageJsonPath), token)
    if (manifestText === undefined) { failures.push({ packageJsonPath, reason: 'MANIFEST_FETCH_FAILED' }); continue }
    let manifest: PackageManifest
    try { manifest = JSON.parse(manifestText) as PackageManifest } catch { failures.push({ packageJsonPath, reason: 'MANIFEST_JSON_INVALID' }); continue }
    if (manifest.private === true) { failures.push({ packageJsonPath, reason: 'PRIVATE_PACKAGE_EXCLUDED' }); continue }
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
    const dshDependencies = [...dependencies].filter(isDshDependency)
    const kind = kindFor(manifest, patchText)
    const checkedAt = new Date().toISOString()
    const version = typeof manifest.version === 'string' && manifest.version.trim() !== '' ? manifest.version.trim().slice(0, 80) : undefined
    let releaseNotes = declaredNotes(manifest.dsh?.workshop?.releaseNotes, version, `${manifest.name} 更新`, checkedAt)
    if (releaseNotes === undefined) {
      const release = (await releases()).find(item => releaseMatches(item, version) && typeof item.body === 'string')
      if (release !== undefined) releaseNotes = markdownNotes(
        String(release.body), version, cleanText(release.name, 180) ?? `${manifest.name} ${version ?? '更新'}`,
        'github_release', typeof release.html_url === 'string' ? release.html_url : undefined, checkedAt,
      )
    }
    if (releaseNotes === undefined) {
      const packageDirectory = path.dirname(packageJsonPath)
      const candidates = [
        ...(packageDirectory === '.' ? [] : [`${packageDirectory}/CHANGELOG.md`, `${packageDirectory}/CHANGES.md`]),
        'CHANGELOG.md', 'CHANGES.md',
      ]
      const changelogPath = candidates.map(candidate => fileNames.get(candidate.toLowerCase())).find((candidate): candidate is string => candidate !== undefined)
      if (changelogPath !== undefined) {
        const changelog = await cachedText(changelogPath)
        if (changelog !== undefined && changelogHasVersion(changelog, version)) releaseNotes = markdownNotes(
          changelog, version, `${manifest.name} ${version ?? '更新'}`, 'changelog',
          `${repository.html_url}/blob/${commit.sha}/${changelogPath.split('/').map(encodeURIComponent).join('/')}`, checkedAt,
        )
      }
    }
    if (releaseNotes === undefined) {
      const message = cleanText(commit.commit?.message, 800)
      const commitUrl = typeof commit.html_url === 'string' ? commit.html_url : `${repository.html_url}/commit/${commit.sha}`
      if (message !== undefined) releaseNotes = {
        ...(version === undefined ? {} : { version }), title: `${manifest.name} ${version ?? 'Revision 更新'}`,
        summary: message, changes: [{ type: 'changed', text: message.split(/\n/)[0]!.slice(0, 400) }], breakingChanges: [],
        sourceType: 'commit', sourceUrl: commitUrl, collectedAt: checkedAt,
      }
    }
    const verification: PluginVerification = {
      status: 'verified_bundle', commitSha: commit.sha, packageJsonPath, patchPath, checkedAt,
      verifierVersion: VERIFIER_VERSION, entryIds: evidence.entryIds, moduleSpecifiers: evidence.moduleSpecifiers,
    }
    if (dshDependencies.length === 0) {
      failures.push({ packageJsonPath, reason: 'DSH_DEPENDENCY_EVIDENCE_WEAK' })
      continue
    }
    const previewUrls = previewFiles(files.keys(), packageJsonPath).map(file => rawUrl(fullName, commit.sha as string, file))
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
      ...(version === undefined ? {} : { version }), ...(releaseNotes === undefined ? {} : { releaseNotes }),
      ...(previewUrls.length === 0 ? {} : { previewUrls }),
      source: 'github-topic', securityReviewed: false, verification,
    })
  }
  const uniquePlugins = new Map<string, GitHubPluginRecord>()
  for (const plugin of plugins) {
    const key = String(plugin.packageName ?? plugin.name).trim().toLowerCase()
    const current = uniquePlugins.get(key)
    if (current === undefined || packagePreference(plugin) < packagePreference(current)) {
      if (current !== undefined) failures.push({ packageJsonPath: current.verification.packageJsonPath, reason: 'DUPLICATE_PACKAGE_NAME' })
      uniquePlugins.set(key, plugin)
    } else failures.push({ packageJsonPath: plugin.verification.packageJsonPath, reason: 'DUPLICATE_PACKAGE_NAME' })
  }
  const verifiedPlugins = [...uniquePlugins.values()]
  if (verifiedPlugins.length === 0) return { repository: fullName, commitSha: commit.sha, plugins: [], status: 'rejected', reason: failures[0]?.reason ?? 'DSH_BUNDLE_NOT_FOUND', evidence: { packageCount: packagePaths.length, failures } }
  return { repository: fullName, commitSha: commit.sha, plugins: verifiedPlugins, status: 'verified', evidence: { packageCount: packagePaths.length, bundleCount: verifiedPlugins.length, failures } }
}

export async function verifyGitHubRepository(repository: GitHubRepository, token?: string, fetcher: Fetcher = fetch): Promise<GitHubPluginRecord | undefined> {
  return (await verifyGitHubRepositoryDetailed(repository, token, fetcher)).plugins[0]
}

export async function collectGitHubReleaseNotes(plugin: GitHubPluginRecord, token?: string, fetcher: Fetcher = fetch): Promise<CollectedReleaseNotes> {
  const collectedAt = new Date().toISOString()
  const manifestText = await fetchText(fetcher, rawUrl(plugin.fullName, plugin.verification.commitSha, plugin.verification.packageJsonPath), token)
  let manifest: PackageManifest = {}
  try { if (manifestText !== undefined) manifest = JSON.parse(manifestText) as PackageManifest } catch { manifest = {} }
  const version = typeof manifest.version === 'string' && manifest.version.trim() !== '' ? manifest.version.trim().slice(0, 80) : plugin.version
  const declared = declaredNotes(manifest.dsh?.workshop?.releaseNotes, version, `${plugin.name} 更新`, collectedAt)
  if (declared !== undefined) return declared

  try {
    const response = await fetcher(`https://api.github.com/repos/${plugin.fullName}/releases?per_page=20`, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
    if (response.ok) {
      const value = await response.json()
      if (Array.isArray(value)) {
        const release = (value as GitHubRelease[]).find(item => releaseMatches(item, version) && typeof item.body === 'string')
        if (release !== undefined) return markdownNotes(
          String(release.body), version, cleanText(release.name, 180) ?? `${plugin.name} ${version ?? '更新'}`,
          'github_release', typeof release.html_url === 'string' ? release.html_url : undefined, collectedAt,
        )
      }
    }
  } catch {
    // Continue through deterministic repository-local fallbacks.
  }

  const packageDirectory = path.dirname(plugin.verification.packageJsonPath)
  const changelogCandidates = [
    ...(packageDirectory === '.' ? [] : [`${packageDirectory}/CHANGELOG.md`, `${packageDirectory}/CHANGES.md`]),
    'CHANGELOG.md', 'CHANGES.md',
  ]
  for (const changelogPath of changelogCandidates) {
    const changelog = await fetchText(fetcher, rawUrl(plugin.fullName, plugin.verification.commitSha, changelogPath), token)
    if (changelog !== undefined && changelogHasVersion(changelog, version)) return markdownNotes(
      changelog, version, `${plugin.name} ${version ?? '更新'}`, 'changelog',
      `${plugin.url.replace(/\/$/, '')}/blob/${plugin.verification.commitSha}/${changelogPath.split('/').map(encodeURIComponent).join('/')}`, collectedAt,
    )
  }

  try {
    const response = await fetcher(`https://api.github.com/repos/${plugin.fullName}/commits/${encodeURIComponent(plugin.verification.commitSha)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
    if (response.ok) {
      const commit = await response.json() as { html_url?: unknown; commit?: { message?: unknown } }
      const message = cleanText(commit.commit?.message, 800)
      if (message !== undefined) return {
        ...(version === undefined ? {} : { version }), title: `${plugin.name} ${version ?? 'Revision 更新'}`, summary: message,
        changes: [{ type: 'changed', text: message.split(/\n/)[0]!.slice(0, 400) }], breakingChanges: [], sourceType: 'commit',
        sourceUrl: typeof commit.html_url === 'string' ? commit.html_url : `${plugin.url.replace(/\/$/, '')}/commit/${plugin.verification.commitSha}`,
        collectedAt,
      }
    }
  } catch {
    // Missing notes are an explicit, valid terminal state.
  }
  return {
    ...(version === undefined ? {} : { version }), title: `${plugin.name} ${version ?? '更新'}`,
    summary: '作者未提供更新日志。', changes: [], breakingChanges: [], sourceType: 'missing', collectedAt,
  }
}

export async function fetchGitHubTopicDetailed(
  token?: string,
  fetcher: Fetcher = fetch,
  onProgress?: (progress: { phase: 'discovering' | 'verifying'; discovered: number; processed: number }) => void,
  options: GitHubSyncOptions = {},
): Promise<GitHubSyncResult> {
  onProgress?.({ phase: 'discovering', discovered: 0, processed: 0 })
  const discovery = await discoverGitHubTopic(token, fetcher)
  const repositoryByName = new Map(discovery.repositories.flatMap(repository => typeof repository.full_name === 'string' ? [[repository.full_name.toLowerCase(), repository] as const] : []))
  const requested = options.repositories?.map(repository => repository.toLowerCase())
  const eligible = requested === undefined
    ? discovery.repositories
    : requested.flatMap(repository => repositoryByName.get(repository) ?? [])
  const missing = requested === undefined ? [] : requested.filter(repository => !repositoryByName.has(repository))
  const discovered = requested?.length ?? discovery.repositories.length
  const before = await coreRateLimit(token, fetcher)
  const configuredLimit = Math.max(0, options.maxRepositories ?? (token === undefined ? 15 : 60))
  const rateLimitCapacity = before.remaining === undefined ? configuredLimit : Math.max(0, Math.floor((before.remaining - 5) / 3))
  const processLimit = Math.min(configuredLimit, rateLimitCapacity)
  const selected = eligible.slice(0, processLimit)
  const deferredRepositories = eligible.slice(processLimit)
  onProgress?.({ phase: 'verifying', discovered, processed: 0 })
  const results: RepositoryVerificationResult[] = []
  const batchSize = token === undefined ? 3 : 6
  for (let index = 0; index < selected.length; index += batchSize) {
    const batch = await Promise.all(selected.slice(index, index + batchSize).map(repository => verifyGitHubRepositoryDetailed(repository, token, fetcher).catch(cause => ({
      repository: typeof repository.full_name === 'string' ? repository.full_name : 'unknown', plugins: [], status: 'failed' as const,
      reason: cause instanceof Error ? cause.message : 'UNKNOWN', evidence: {},
    }))))
    results.push(...batch)
    onProgress?.({ phase: 'verifying', discovered, processed: results.length })
  }
  const plugins = results.flatMap(result => result.plugins)
  const deferred: SyncCandidateInput[] = [
    ...deferredRepositories.map(repository => ({
      repository: String(repository.full_name), status: 'deferred' as const, bundleCount: 0,
      reason: processLimit === 0 ? 'GITHUB_RATE_LIMIT_DEFERRED' : 'SYNC_BATCH_DEFERRED',
      evidence: { githubAuthenticated: token !== undefined, ...(before.resetAt === undefined ? {} : { resetAt: before.resetAt }) },
    })),
    ...missing.map(repository => ({
      repository, status: 'deferred' as const, bundleCount: 0, reason: 'CANDIDATE_NOT_IN_CURRENT_DISCOVERY', evidence: {},
    })),
  ]
  const after = await coreRateLimit(token, fetcher)
  return {
    plugins, discovered, verified: results.filter(result => result.status === 'verified').length,
    rejected: results.filter(result => result.status === 'rejected').length, failed: results.filter(result => result.status === 'failed').length,
    deferred: deferred.length, bundlesFound: plugins.length, githubAuthenticated: token !== undefined,
    candidates: [
      ...results.map(result => ({ repository: result.repository, ...(result.commitSha === undefined ? {} : { commitSha: result.commitSha }), status: result.status, bundleCount: result.plugins.length, ...(result.reason === undefined ? {} : { reason: result.reason }), evidence: result.evidence })),
      ...deferred,
    ],
    rateLimit: Object.keys(after).length > 0 ? after : Object.keys(before).length > 0 ? before : discovery.rateLimit,
  }
}

export async function fetchGitHubTopic(token?: string, fetcher: Fetcher = fetch): Promise<GitHubPluginRecord[]> {
  return (await fetchGitHubTopicDetailed(token, fetcher)).plugins
}
