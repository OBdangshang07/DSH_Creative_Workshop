import type { GitHubPluginRecord } from './auth-store.js'

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
  owner?: { login?: unknown }
}

function kindFor(repository: GitHubRepository): string {
  const text = `${repository.name ?? ''} ${repository.description ?? ''} ${Array.isArray(repository.topics) ? repository.topics.join(' ') : ''}`.toLowerCase()
  if (/tui|terminal|cli/.test(text)) return 'tui'
  if (/vision|image|ocr|multimodal/.test(text)) return 'mcp-bundle'
  if (/skill/.test(text)) return 'skill-pack'
  if (/web|ui|skin|sidebar/.test(text)) return 'web-ui'
  if (/awesome|collection|suite|toolkit/.test(text)) return 'collection'
  return 'bundle'
}

function surfacesFor(kind: string): string[] {
  if (kind === 'web-ui') return ['web']
  if (kind === 'tui') return ['tui', 'headless']
  return ['web', 'headless']
}

function validRepository(repository: GitHubRepository): boolean {
  const topics = Array.isArray(repository.topics) ? repository.topics : []
  return repository.archived !== true && repository.fork !== true && topics.includes('dsh-plugin') &&
    typeof repository.full_name === 'string' && typeof repository.description === 'string' &&
    repository.description.trim().length >= 12 && typeof repository.html_url === 'string' &&
    typeof repository.pushed_at === 'string' && Date.parse(repository.pushed_at) >= Date.now() - 365 * 24 * 60 * 60 * 1000
}

export function normalizeGitHubRepositories(items: GitHubRepository[], limit = 24): GitHubPluginRecord[] {
  return items.filter(validRepository).slice(0, limit).map(repository => {
    const fullName = repository.full_name as string
    const kind = kindFor(repository)
    return {
      id: `github.${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}`,
      fullName,
      name: typeof repository.name === 'string' ? repository.name : fullName.split('/').at(-1)!,
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
      surfaces: surfacesFor(kind),
      source: 'github-topic',
      securityReviewed: false,
    }
  })
}

export async function fetchGitHubTopic(token?: string): Promise<GitHubPluginRecord[]> {
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', 'topic:dsh-plugin archived:false fork:false')
  url.searchParams.set('sort', 'stars')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '100')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DSH-Creative-Workshop/0.1',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`GITHUB_SYNC_FAILED_${response.status}`)
  const body = await response.json() as { items?: GitHubRepository[] }
  return normalizeGitHubRepositories(body.items ?? [])
}
