import { randomBytes, randomUUID } from 'node:crypto'
import { latestVersion, type PermissionDeclaration, type Plugin, type PluginVersion } from '@dsh-workshop/domain'
import type { CatalogRepository } from '@dsh-workshop/catalog'
import { CompanionInputError, assertValidProfile, type EnvironmentProbeLike } from './environment.js'

export interface PlanChange {
  action: 'add'
  pluginId: string
  pluginVersionId: string
  packageSpec: string
  sourceCommit: string
  artifactDigest: string
  dependencyOf?: string
}

export interface AddedPermission {
  scope: string
  items: readonly string[]
  reason?: string
}

export interface InstallPlan {
  planId: string
  state: 'READY_FOR_CONFIRMATION'
  executionMode: 'dry-run'
  target: { profile: string }
  lockedInputs: {
    catalogRevision: string
    profileDigest: string
    dshVersion?: string
  }
  rootPlugin: { id: string; name: string; version: string }
  changes: readonly PlanChange[]
  permissionsAdded: readonly AddedPermission[]
  conflicts: readonly string[]
  warnings: readonly string[]
  activation: { requiresRestart: boolean; requiresNewSession: boolean; requiresPageRefresh: boolean }
  verification: readonly string[]
  rollback: { supported: true; limitations: readonly string[] }
  confirmationToken: string
  createdAt: string
}

export interface CreatePlanInput {
  pluginVersionId: string
  profile: string
}

const permissionEntries = [
  'filesystem', 'process', 'network', 'credentials', 'modelContext', 'telemetry', 'lifecycleScripts',
] as const

function permissionRows(version: PluginVersion): AddedPermission[] {
  return permissionEntries.flatMap(scope => {
    const declaration: PermissionDeclaration = version.permissions[scope]
    if (!declaration.required && declaration.items.length === 0) return []
    return [{ scope, items: declaration.items, ...(declaration.reason === undefined ? {} : { reason: declaration.reason }) }]
  })
}

function addVersion(
  plugin: Plugin,
  version: PluginVersion,
  dependencyOf: string | undefined,
  changes: PlanChange[],
  permissions: AddedPermission[],
): void {
  changes.push({
    action: 'add',
    pluginId: plugin.id,
    pluginVersionId: version.id,
    packageSpec: version.packageManagerSpec,
    sourceCommit: version.sourceCommit,
    artifactDigest: version.artifactDigest,
    ...(dependencyOf === undefined ? {} : { dependencyOf }),
  })
  permissions.push(...permissionRows(version))
}

export class PlanService {
  private readonly plans = new Map<string, InstallPlan>()

  constructor(private readonly repository: CatalogRepository, private readonly probe: EnvironmentProbeLike) {}

  async create(input: CreatePlanInput): Promise<InstallPlan> {
    assertValidProfile(input.profile)
    const rootVersion = this.repository.pluginVersion(input.pluginVersionId)
    if (rootVersion === undefined || rootVersion.yankedAt !== undefined) {
      throw new CompanionInputError('CATALOG_VERSION_NOT_INSTALLABLE', '插件版本不存在或已撤回')
    }
    const rootPlugin = this.repository.plugin(rootVersion.pluginId)
    if (rootPlugin === undefined || rootPlugin.status !== 'published') {
      throw new CompanionInputError('CATALOG_PLUGIN_NOT_INSTALLABLE', '插件未处于可安装状态')
    }
    if (rootPlugin.kind !== 'bundle') {
      throw new CompanionInputError('POLICY_ONE_CLICK_UNSUPPORTED', 'MVP 仅对 dsh.bundle 提供一键安装计划')
    }

    const environment = await this.probe.inspect()
    if (!rootVersion.compatibility.os.includes(environment.os) || !rootVersion.compatibility.arch.includes(environment.arch)) {
      throw new CompanionInputError('COMPAT_ENVIRONMENT_UNSUPPORTED', '该版本与本机 OS 或架构不兼容')
    }

    const changes: PlanChange[] = []
    const permissions: AddedPermission[] = []
    const warnings: string[] = []
    const conflicts: string[] = []
    const selected = new Set<string>()

    const visit = (plugin: Plugin, selectedVersion: PluginVersion, dependencyOf?: string): void => {
      if (selected.has(selectedVersion.id)) return
      selected.add(selectedVersion.id)
      for (const relation of selectedVersion.relations) {
        if (relation.kind === 'requires') {
          const dependency = this.repository.plugin(relation.target)
          const dependencyVersion = dependency === undefined ? undefined : latestVersion(dependency)
          if (dependency === undefined || dependencyVersion === undefined) {
            conflicts.push(`缺少必需依赖 ${relation.target}${relation.range === undefined ? '' : ` ${relation.range}`}`)
            continue
          }
          visit(dependency, dependencyVersion, plugin.id)
        } else if (relation.kind === 'optional') {
          warnings.push(`可选依赖未自动安装：${relation.target}${relation.range === undefined ? '' : ` ${relation.range}`}`)
        } else if (relation.kind === 'conflicts') {
          conflicts.push(`声明与 ${relation.target} 冲突：${relation.reason ?? '未提供原因'}`)
        }
      }
      addVersion(plugin, selectedVersion, dependencyOf, changes, permissions)
    }

    visit(rootPlugin, rootVersion)
    const activations = changes.map(change => this.repository.pluginVersion(change.pluginVersionId)?.activation)
    const profileExists = environment.profiles.includes(input.profile)
    if (!profileExists) warnings.push(`本机尚未发现 profile “${input.profile}”；执行前需要由 DSH 创建或确认目标。`)
    if (conflicts.length > 0) warnings.push('计划含未解决冲突，dry-run 会保留诊断但不会执行变更。')

    const plan: InstallPlan = {
      planId: `plan_${randomUUID()}`,
      state: 'READY_FOR_CONFIRMATION',
      executionMode: 'dry-run',
      target: { profile: input.profile },
      lockedInputs: {
        catalogRevision: this.repository.snapshot().revision,
        profileDigest: await this.probe.profileDigest(input.profile),
        ...(environment.dshVersion === undefined ? {} : { dshVersion: environment.dshVersion }),
      },
      rootPlugin: { id: rootPlugin.id, name: rootPlugin.name, version: rootVersion.version },
      changes,
      permissionsAdded: permissions,
      conflicts,
      warnings,
      activation: {
        requiresRestart: activations.includes('process-restart'),
        requiresNewSession: activations.includes('new-session'),
        requiresPageRefresh: activations.includes('page-refresh'),
      },
      verification: rootVersion.evidence.map(item => `${item.level}/${item.verdict}: ${item.summary}`),
      rollback: { supported: true, limitations: ['当前公开操作仅为 dry-run；未写入真实 profile。'] },
      confirmationToken: randomBytes(24).toString('base64url'),
      createdAt: new Date().toISOString(),
    }
    this.plans.set(plan.planId, plan)
    return plan
  }

  get(planId: string): InstallPlan | undefined {
    return this.plans.get(planId)
  }
}
