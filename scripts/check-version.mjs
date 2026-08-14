import { readFile } from 'node:fs/promises'

const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const manifests = [
  'apps/api/package.json',
  'apps/companion/package.json',
  'packages/catalog/package.json',
  'packages/domain/package.json',
  'packages/manifest/package.json',
]

const mismatches = []
for (const relative of manifests) {
  const manifest = JSON.parse(await readFile(new URL(`../${relative}`, import.meta.url), 'utf8'))
  if (manifest.version !== expected) mismatches.push(`${relative}: ${manifest.version}`)
}

const versionSource = await readFile(new URL('../apps/api/src/version.ts', import.meta.url), 'utf8')
if (!versionSource.includes(`APP_VERSION = '${expected}'`)) mismatches.push('apps/api/src/version.ts')
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
if (!changelog.includes(`## [${expected}]`)) mismatches.push('CHANGELOG.md')
try {
  const release = JSON.parse(await readFile(new URL(`../releases/v${expected}.json`, import.meta.url), 'utf8'))
  if (release.version !== expected || typeof release.title !== 'string' || typeof release.summary !== 'string' || !Array.isArray(release.changes) || release.changes.length === 0 || !Number.isFinite(Date.parse(release.publishedAt))) mismatches.push(`releases/v${expected}.json`)
} catch {
  mismatches.push(`releases/v${expected}.json`)
}
const storefront = await readFile(new URL('../index.html', import.meta.url), 'utf8')
if (!storefront.includes(`workshop-app.js?v=${expected}`) || !storefront.includes(`workshop-v1.css?v=${expected}`)) mismatches.push('index.html asset versions')
const storefrontApp = await readFile(new URL('../js/workshop-app.js', import.meta.url), 'utf8')
if (!storefrontApp.includes(`version: '${expected}'`)) mismatches.push('js/workshop-app.js')
const adminPage = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8')
if (!adminPage.includes(`admin-v${expected.replaceAll('.', '')}.css?v=${expected}`)) mismatches.push('admin/index.html asset versions')
const nginx = await readFile(new URL('../deploy/nginx-site.conf', import.meta.url), 'utf8')
if (!nginx.includes(`"version":"${expected}"`)) mismatches.push('deploy/nginx-site.conf')

if (mismatches.length > 0) {
  throw new Error(`Version ${expected} is not synchronized:\n${mismatches.join('\n')}`)
}
process.stdout.write(`Version ${expected} is synchronized across the workspace.\n`)
