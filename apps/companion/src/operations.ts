import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { CompanionInputError } from './environment.js'
import type { InstallPlan, PlanService } from './planner.js'

export interface OperationEvent {
  eventId: string
  operationId: string
  sequence: number
  type: string
  at: string
  data: Record<string, unknown>
}

export interface DryRunReceipt {
  receiptId: string
  planId: string
  catalogRevision: string
  profileDigest: string
  changesDigest: string
  mode: 'dry-run'
  rollbackAvailable: false
  createdAt: string
}

export interface Operation {
  operationId: string
  planId: string
  state: 'DRY_RUN_COMPLETED'
  mode: 'dry-run'
  events: readonly OperationEvent[]
  receipt: DryRunReceipt
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function digestChanges(plan: InstallPlan): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(plan.changes)).digest('hex')}`
}

export class OperationService {
  private readonly operations = new Map<string, Operation>()
  private readonly idempotency = new Map<string, string>()
  private readonly consumedPlans = new Set<string>()

  constructor(private readonly plans: PlanService) {}

  create(planId: string, confirmationToken: string, idempotencyKey: string): Operation {
    if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 128) {
      throw new CompanionInputError('OPERATION_INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key 长度必须为 8–128 个字符')
    }
    const existingId = this.idempotency.get(idempotencyKey)
    if (existingId !== undefined) return this.operations.get(existingId)!
    const plan = this.plans.get(planId)
    if (plan === undefined) throw new CompanionInputError('PLAN_NOT_FOUND', '找不到安装计划')
    if (this.consumedPlans.has(planId)) throw new CompanionInputError('PLAN_ALREADY_CONSUMED', '计划确认令牌已使用')
    if (!sameSecret(plan.confirmationToken, confirmationToken)) {
      throw new CompanionInputError('PLAN_CONFIRMATION_FAILED', '计划确认令牌无效')
    }
    if (plan.conflicts.length > 0) throw new CompanionInputError('RESOLVE_CONFLICTS_PRESENT', '计划仍有未解决冲突')

    const operationId = `op_${randomUUID()}`
    const at = new Date().toISOString()
    const events: OperationEvent[] = [
      { eventId: `evt_${randomUUID()}`, operationId, sequence: 1, type: 'operation.created', at, data: { mode: 'dry-run' } },
      { eventId: `evt_${randomUUID()}`, operationId, sequence: 2, type: 'operation.step.completed', at, data: { step: 'validate-locked-inputs' } },
      { eventId: `evt_${randomUUID()}`, operationId, sequence: 3, type: 'operation.committed', at, data: { changedLocalState: false } },
    ]
    const operation: Operation = {
      operationId,
      planId,
      state: 'DRY_RUN_COMPLETED',
      mode: 'dry-run',
      events,
      receipt: {
        receiptId: `receipt_${randomUUID()}`,
        planId,
        catalogRevision: plan.lockedInputs.catalogRevision,
        profileDigest: plan.lockedInputs.profileDigest,
        changesDigest: digestChanges(plan),
        mode: 'dry-run',
        rollbackAvailable: false,
        createdAt: at,
      },
    }
    this.operations.set(operationId, operation)
    this.idempotency.set(idempotencyKey, operationId)
    this.consumedPlans.add(planId)
    return operation
  }

  get(operationId: string): Operation | undefined {
    return this.operations.get(operationId)
  }
}
