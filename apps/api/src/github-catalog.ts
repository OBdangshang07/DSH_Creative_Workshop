import { posix as path } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { GitHubPluginRecord, PluginVerification } from './auth-store.js'

interface GitHubRepository {
  name?: unknown
  full_name?: unknown
  description?: unknown
  html_url?: unknown
  homepage?: unknown
  stargazers_count?: unknown
  forks_count?: unknown
  language?: unknown
  license?: { spdx_id?: unknown } | null
  updated_at?: unknown
  pushed_at?: unknown
  topics?: unknown
  archived?: unknown
  fork?: unknown
  default_branch?: unknown
  owner?: { login?: unknown }
}

interface GitTreeEntry {
  path?: unknown
  type?: unknown
  size?: unknown
}

interface RepositoryTree {
  sha?: unknown
  truncated?: unknown
  tree?: GitTreeEntry[]
}

interface GitCommit {
  sha?: unknown
}

interface PackageManifest {
  name?: unknown
  dsh?: {
    bundle?: { patch?: unknown }
    client?: { platform?: unknown; inject?: unknown }
  }
}

interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<FetchResponse>

const headers = (token?: string) => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'DSH-Creative-Workshop/0.1',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
})

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

function validCandidate(repository: GitHubRepository): boolean {
  const topics = Array.isArray(repository.topics) ? repository.topics : []
  return repository.archived !== true && repository.fork !== true && topics.includes('dsh-plugin') &&
    repository.full_name !== 'deepseek-ai/deepseek-harness' &&
    typeof repository.full_name === 'string' && typeof repository.description === 'string' &&
    repository.description.trim().length >= 12 && typeof repository.html_url === 'string' &&
    typeof repository.pushed_at === 'string' && typeof repository.default_branch === 'string'
}

function safeBundlePatch(packageJsonPath: string, patchSpecifier: unknown): string | undefined {
  if (typeof patchSpecifier !== 'string' || patchSpecifier.trim() === '') return undefined
  const specifier = patchSpecifier.replaceAll('\\', '/')
  if (specifier.startsWith('/') || /^(?:[a-z]+:|\\\\)/i.test(specifier)) return undefined
  const packageDirectory = path.dirname(packageJsonPath)
  const patchPath = path.normalize(path.join(packageDirectory, specifier))
  if (patchPath === '..' || patchPath.startsWith('../')) return undefined
  return patchPath.replace(/^\.\//, '')
}

function patchHasCordisEntries(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.some(layer => {
    if (typeof layer !== 'object' || layer === null || Array.isArray(layer)) return false
    const record = layer as Record<string, unknown>
    if (Array.isArray(record.insert) && record.insert.some(entry => typeof entry === 'object' && entry !== null)) return true
    return typeof record.id === 'string' && (typeof record.name === 'string' || record.config !== undefined || record.disabled !== undefined)
  })
}

function rawUrl(fullName: string, commitSha: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${fullName}/${commitSha}/${filePath.split('/').map(encodeURIComponent).join('/')}`
}

async function fetchText(fetcher: Fetcher, url: string, token?: string): Promise<string | undefined> {
  const response = await fetcher(url, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
  if (!response.ok) return undefined
  return response.text()
}

export async function verifyGitHubRepository(
  repository: GitHubRepository,
  token?: string,
  fetcher: Fetcher = fetch,
): Promise<GitHubPluginRecord | undefined> {
  if (!validCandidate(repository)) return undefined
  const fullName = repository.full_name as string
  const defaultBranch = repository.default_branch as string
  const commitResponse = await fetcher(`https://api.github.com/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`, {
    headers: headers(token), signal: AbortSignal.timeout(20_000),
  })
  if (!commitResponse.ok) return undefined
  const commit = await commitResponse.json() as GitCommit
  if (typeof commit.sha !== 'string') return undefined
  const treeResponse = await fetcher(`https://api.github.com/repos/${fullName}/git/trees/${commit.sha}?recursive=1`, {
    headers: headers(token), signal: AbortSignal.timeout(20_000),
  })
  if (!treeResponse.ok) return undefined
  const tree = await treeResponse.json() as RepositoryTree
  if (tree.truncated === true || !Array.isArray(tree.tree)) return undefined

  const files = new Map<string, GitTreeEntry>()
  for (const entry of tree.tree) {
    if (entry.type === 'blob' && typeof entry.path === 'string') files.set(entry.path, entry)
  }
  const packageJsonPaths = [...files.keys()]
    .filter(file => file === 'package.json' || file.endsWith('/package.json'))
    .filter(file => !/(^|\/)(?:node_modules|vendor|fixtures?|examples?|tests?|archive)(\/|$)/i.test(file))
    .slice(0, 80)

  for (const packageJsonPath of packageJsonPaths) {
    const manifestEntry = files.get(packageJsonPath)
    if (typeof manifestEntry?.size === 'number' && manifestEntry.size > 256_000) continue
    const manifestText = await fetchText(fetcher, rawUrl(fullName, commit.sha, packageJsonPath), token)
    if (manifestText === undefined) continue
    let manifest: PackageManifest
    try {
      manifest = JSON.parse(manifestText) as PackageManifest
    } catch {
      continue
    }
    const patchPath = safeBundlePatch(packageJsonPath, manifest.dsh?.bundle?.patch)
    if (patchPath === undefined || !files.has(patchPath)) continue
    const patchEntry = files.get(patchPath)
    if (typeof patchEntry?.size === 'number' && patchEntry.size > 512_000) continue
    const patchText = await fetchText(fetcher, rawUrl(fullName, commit.sha, patchPath), token)
    if (patchText === undefined) continue
    try {
      if (!patchHasCordisEntries(parseYaml(patchText.replace(/!!js\s+/g, '')))) continue
    } catch {
      continue
    }

    const kind = kindFor(manifest, patchText)
    const checkedAt = new Date().toISOString()
    const verification: PluginVerification = {
      status: 'verified_bundle', commitSha: commit.sha, packageJsonPath, patchPath, checkedAt,
    }
    return {
      id: `github.${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}`,
      fullName,
      name: typeof manifest.name === 'string' && manifest.name.trim() !== ''
        ? manifest.name : typeof repository.name === 'string' ? repository.name : fullName.split('/').at(-1)!,
      ...(typeof manifest.name === 'string' ? { packageName: manifest.name } : {}),
      author: typeof repository.owner?.login === 'string' ? repository.owner.login : fullName.split('/')[0]!,
      description: repository.description as string,
      url: repository.html_url as string,
      ...(typeof repository.homepage === 'string' && repository.homepage !== '' ? { homepage: repository.homepage } : {}),
      stars: typeof repository.stargazers_count === 'number' ? repository.stargazers_count : 0,
      forks: typeof repository.forks_count === 'number' ? repository.forks_count : 0,
      ...(typeof repository.language === 'string' ? { language: repository.language } : {}),
      ...(typeof repository.license?.spdx_id === 'string' && repository.license.spdx_id !== 'NOASSERTION'
        ? { license: repository.license.spdx_id } : {}),
      updatedAt: typeof repository.updated_at === 'string' ? repository.updated_at : repository.pushed_at as string,
      pushedAt: repository.pushed_at as string,
      topics: Array.isArray(repository.topics) ? repository.topics.filter((topic): topic is string => typeof topic === 'string') : [],
      kind,
      surfaces: surfacesFor(manifest, kind),
      source: 'github-topic',
      securityReviewed: false,
      verification,
    }
  }
  return undefined
}

export async function fetchGitHubTopic(token?: string, fetcher: Fetcher = fetch): Promise<GitHubPluginRecord[]> {
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', 'topic:dsh-plugin archived:false fork:false')
  url.searchParams.set('sort', 'stars')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '100')
  const response = await fetcher(url, {
    headers: headers(token), signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GITHUB_SYNC_FAILED_${response.status}`)
  const body = await response.json() as { items?: GitHubRepository[] }
  const candidates = (body.items ?? []).filter(validCandidate).slice(0, 28)
  const verified: GitHubPluginRecord[] = []
  const batchSize = token === undefined ? 3 : 6
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = await Promise.all(candidates.slice(index, index + batchSize).map(async repository => {
      try {
        return await verifyGitHubRepository(repository, token, fetcher)
      } catch {
        return undefined
      }
    }))
    verified.push(...batch.filter((plugin): plugin is GitHubPluginRecord => plugin !== undefined))
    if (verified.length >= 24) break
  }
  if (candidates.length > 0 && verified.length === 0) throw new Error('GITHUB_VERIFICATION_EMPTY')
  return verified.slice(0, 24)
}
