import type {
  CatalogSnapshot,
  Collection,
  Evidence,
  PermissionSet,
  Plugin,
  PluginRelation,
  PluginVersion,
  Review,
} from '@dsh-workshop/domain'

const publishedAt = '2026-08-14T00:00:00.000Z'

function fixtureHex(value: string, length: number): string {
  const encoded = [...value].map(character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  return encoded.repeat(Math.ceil(length / encoded.length)).slice(0, length)
}

const noPermissions = (): PermissionSet => ({
  filesystem: { required: false, items: [] },
  process: { required: false, items: [] },
  network: { required: false, items: [] },
  credentials: { required: false, items: [] },
  modelContext: { required: false, items: [] },
  telemetry: { required: false, items: [] },
  lifecycleScripts: { required: false, items: [] },
})

const evidence = (id: string, summary: string, level: Evidence['level'] = 'L3'): Evidence => ({
  id,
  level,
  verdict: 'pass',
  producer: 'workshop-fixture-verifier',
  summary,
  dshVersion: '0.1.0-rc.5',
  dshCommit: '47f943859bef60e4160492346772ded9b24f765a',
  os: 'windows',
  checkedAt: publishedAt,
})

const relation = (
  kind: PluginRelation['kind'],
  target: string,
  targetLabel: string,
  source: PluginRelation['source'] = 'manifest',
): PluginRelation => ({ kind, target, targetLabel, source })

function version(
  pluginId: string,
  versionNumber: string,
  options: {
    permissions?: PermissionSet
    relations?: readonly PluginRelation[]
    planes?: PluginVersion['planes']
    activation?: PluginVersion['activation']
    yankedAt?: string
  } = {},
): PluginVersion {
  const packageSlug = pluginId.replace('plugin.', '')
  const syntheticDigest = fixtureHex(`dsh-workshop-fixture:${packageSlug}`, 64)
  const result: PluginVersion = {
    id: `pv.${packageSlug}.${versionNumber}`,
    pluginId,
    version: versionNumber,
    sourceRef: `refs/tags/v${versionNumber}`,
    sourceCommit: syntheticDigest.slice(0, 40),
    artifactDigest: `sha256:${syntheticDigest}`,
    packageName: `@dsh-community/${packageSlug}`,
    packageManagerSpec: `@dsh-community/${packageSlug}@${versionNumber}`,
    compatibility: {
      dsh: '^0.1.0-rc.5',
      verifiedDshCommits: ['47f943859bef60e4160492346772ded9b24f765a'],
      node: '>=22',
      os: ['windows', 'linux', 'macos'],
      arch: ['x64', 'arm64'],
      surfaces: ['web', 'headless', 'desktop'],
    },
    permissions: options.permissions ?? noPermissions(),
    planes: options.planes ?? ['host'],
    activation: options.activation ?? 'process-restart',
    relations: options.relations ?? [],
    evidence: [evidence(`ev.${packageSlug}.${versionNumber}`, 'Reproducible fixture build completed')],
    publishedAt,
  }
  return options.yankedAt === undefined ? result : { ...result, yankedAt: options.yankedAt }
}

const inspectorPermissions = noPermissions()
inspectorPermissions.filesystem = {
  required: true,
  items: ['read:$DSH_HOME/profiles'],
  reason: 'Reads profile manifests to build an inventory.',
}

const visionPermissions = noPermissions()
visionPermissions.network = {
  required: true,
  items: ['https://api.vision.example'],
  reason: 'Calls the configured vision endpoint.',
}
visionPermissions.credentials = {
  required: true,
  items: ['VISION_API_KEY'],
  reason: 'Authenticates to the vision endpoint.',
}

const workflowPermissions = noPermissions()
workflowPermissions.filesystem = {
  required: true,
  items: ['write:$DSH_HOME/workspace-cache'],
  reason: 'Persists resumable workflow state.',
}

export const seedPlugins: readonly Plugin[] = [
  {
    id: 'plugin.workspace-inspector',
    slug: 'workspace-inspector',
    name: 'Workspace Inspector',
    kind: 'bundle',
    publisher: 'DSH Community Lab',
    summary: 'Inspect profiles, bundles, services, and slots without changing local state.',
    description: 'A read-only diagnostics bundle for understanding a DeepSeek Harness workspace.',
    sourceUrl: 'https://github.com/example/dsh-workspace-inspector',
    tags: ['purpose/developer-tools', 'capability/inspection', 'risk/read-only', 'surface/web'],
    status: 'published',
    featured: true,
    review: { count: 2, verifiedCount: 1, score: 4.6, confidenceLowerBound: 0.4385 },
    versions: [
      version('plugin.workspace-inspector', '1.2.0', {
        permissions: inspectorPermissions,
        relations: [
          relation('provides-service', 'service.workspace-inventory', 'Workspace inventory service', 'bundle-patch'),
          relation('registers-route', 'route./inspector', '/inspector', 'bundle-patch'),
        ],
      }),
      version('plugin.workspace-inspector', '1.1.0', {
        permissions: inspectorPermissions,
        yankedAt: '2026-07-10T00:00:00.000Z',
      }),
    ],
  },
  {
    id: 'plugin.vision-bridge',
    slug: 'vision-bridge',
    name: 'Vision Bridge',
    kind: 'bundle',
    publisher: 'Northstar Tools',
    summary: 'Add an image understanding service backed by a configurable remote endpoint.',
    description: 'Provides a model-context vision service and a small web configuration surface.',
    sourceUrl: 'https://github.com/example/dsh-vision-bridge',
    tags: ['capability/vision', 'integration/remote-api', 'risk/credentialed', 'surface/web'],
    status: 'published',
    featured: true,
    review: { count: 1, verifiedCount: 1, score: 4.2, confidenceLowerBound: 0.3424 },
    versions: [
      version('plugin.vision-bridge', '2.0.1', {
        permissions: visionPermissions,
        planes: ['host', 'agent', 'client'],
        activation: 'new-session',
        relations: [
          relation('provides-service', 'service.vision', 'Vision service', 'bundle-patch'),
          relation('registers-slot', 'slot.settings.vision', 'Vision settings slot', 'bundle-patch'),
        ],
      }),
    ],
  },
  {
    id: 'plugin.workflow-suite',
    slug: 'workflow-suite',
    name: 'Workflow Suite',
    kind: 'bundle',
    publisher: 'DSH Community Lab',
    summary: 'Compose workspace inspection and vision into repeatable agent workflows.',
    description: 'A bundle demonstrating explicit requirements, services, and a client route.',
    sourceUrl: 'https://github.com/example/dsh-workflow-suite',
    tags: ['purpose/automation', 'capability/workflows', 'surface/web', 'audience/advanced'],
    status: 'published',
    featured: false,
    review: { count: 1, verifiedCount: 1, score: 4.4, confidenceLowerBound: 0.3424 },
    versions: [
      version('plugin.workflow-suite', '0.9.0', {
        permissions: workflowPermissions,
        planes: ['host', 'agent', 'client'],
        relations: [
          { ...relation('requires', 'plugin.workspace-inspector', 'Workspace Inspector'), range: '^1.2.0' },
          { ...relation('optional', 'plugin.vision-bridge', 'Vision Bridge'), range: '^2.0.0' },
          relation('injects-service', 'service.workspace-inventory', 'Workspace inventory service', 'bundle-patch'),
          relation('registers-route', 'route./workflows', '/workflows', 'bundle-patch'),
        ],
      }),
    ],
  },
  {
    id: 'plugin.night-theme-pack',
    slug: 'night-theme-pack',
    name: 'Night Theme Pack',
    kind: 'bundle',
    publisher: 'Small Hours Studio',
    summary: 'A client-only theme bundle for late-night sessions.',
    description: 'Registers a theme slot contribution and requires only a page refresh.',
    sourceUrl: 'https://github.com/example/dsh-night-theme',
    tags: ['purpose/personalization', 'capability/theme', 'surface/web', 'risk/read-only'],
    status: 'published',
    featured: false,
    review: { count: 1, verifiedCount: 0, score: 4.0, confidenceLowerBound: 0.2065 },
    versions: [
      version('plugin.night-theme-pack', '1.0.0', {
        planes: ['client'],
        activation: 'page-refresh',
        relations: [relation('registers-slot', 'slot.theme.night', 'Night theme slot', 'bundle-patch')],
      }),
    ],
  },
]

export const seedCollections: readonly Collection[] = [
  {
    id: 'collection.developer-essentials',
    slug: 'developer-essentials',
    name: 'Developer Essentials',
    summary: 'A curated, deterministic starting point for inspecting and automating DSH workspaces.',
    maintainer: 'DSH Community Lab',
    tags: ['audience/developer', 'purpose/productivity'],
    releases: [
      {
        id: 'cr.developer-essentials.1.0.0',
        collectionId: 'collection.developer-essentials',
        version: '1.0.0',
        targetProfile: 'web',
        dshRange: '^0.1.0-rc.5',
        members: [
          { pluginId: 'plugin.workspace-inspector', versionId: 'pv.workspace-inspector.1.2.0', role: 'required', order: 1 },
          { pluginId: 'plugin.workflow-suite', versionId: 'pv.workflow-suite.0.9.0', role: 'required', order: 2 },
          { pluginId: 'plugin.night-theme-pack', versionId: 'pv.night-theme-pack.1.0.0', role: 'optional', order: 3 },
        ],
        permissions: workflowPermissions,
        evidence: [evidence('ev.collection.developer-essentials.1.0.0', 'Collection members resolved and checked', 'L2')],
        publishedAt,
      },
    ],
  },
]

export const seedReviews: readonly Review[] = [
  {
    id: 'review.inspector.1',
    pluginVersionId: 'pv.workspace-inspector.1.2.0',
    author: 'fixture-user-a',
    receiptBacked: true,
    worksAsDescribed: 5,
    installationEase: 5,
    documentation: 4,
    stability: 5,
    permissionClarity: 5,
    body: 'The inventory matched my local profile and the permission declaration was clear.',
    dshVersion: '0.1.0-rc.5',
    os: 'windows',
    createdAt: publishedAt,
  },
  {
    id: 'review.inspector.2',
    pluginVersionId: 'pv.workspace-inspector.1.2.0',
    author: 'fixture-user-b',
    receiptBacked: false,
    worksAsDescribed: 4,
    installationEase: 4,
    documentation: 4,
    stability: 4,
    permissionClarity: 5,
    body: 'Useful overview; I would like more export formats.',
    createdAt: publishedAt,
  },
  {
    id: 'review.vision.1',
    pluginVersionId: 'pv.vision-bridge.2.0.1',
    author: 'fixture-user-c',
    receiptBacked: true,
    worksAsDescribed: 5,
    installationEase: 4,
    documentation: 4,
    stability: 4,
    permissionClarity: 4,
    body: 'Works after configuring the endpoint and key.',
    dshVersion: '0.1.0-rc.5',
    os: 'linux',
    createdAt: publishedAt,
  },
  {
    id: 'review.workflow.1',
    pluginVersionId: 'pv.workflow-suite.0.9.0',
    author: 'fixture-user-d',
    receiptBacked: true,
    worksAsDescribed: 5,
    installationEase: 4,
    documentation: 4,
    stability: 4,
    permissionClarity: 5,
    body: 'The declared dependency was resolved before the workflow bundle.',
    dshVersion: '0.1.0-rc.5',
    os: 'windows',
    createdAt: publishedAt,
  },
  {
    id: 'review.theme.1',
    pluginVersionId: 'pv.night-theme-pack.1.0.0',
    author: 'fixture-user-e',
    receiptBacked: false,
    worksAsDescribed: 4,
    installationEase: 4,
    documentation: 4,
    stability: 4,
    permissionClarity: 4,
    body: 'A small theme contribution with a clear activation mode.',
    createdAt: publishedAt,
  },
]

export const seedCatalog: CatalogSnapshot = {
  revision: 'cr.fixture.2026-08-14.1',
  generatedAt: publishedAt,
  plugins: seedPlugins,
  collections: seedCollections,
  reviews: seedReviews,
}
