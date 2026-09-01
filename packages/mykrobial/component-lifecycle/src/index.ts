/** Model-free CORDIS-shaped reversible component lifecycle reference. */
import { createHash } from 'node:crypto'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA = /^[0-9a-f]{64}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

export interface ComponentDefinition {
  component_id: string
  logical_identity: string
  source_sha256: string
  configuration_sha256: string
  dependency_ids: string[]
}

export type ComponentLifecycleState =
  | 'registered'
  | 'pending_dependencies'
  | 'active'
  | 'unloading'
  | 'inactive'
  | 'failed'
  | 'disposed'

export interface ComponentLifecycleEvent {
  schema: 'mykrobial.component-lifecycle-event.v1'
  sequence: number
  generation: number
  component_id: string
  kind: 'registered' | 'pending' | 'activated' | 'unloading' | 'inactive' | 'failed' | 'rollback' | 'disposed'
  reason: string
  definition_sha256: string
}

export interface ComponentSnapshot {
  schema: 'mykrobial.component-snapshot.v1'
  definition: ComponentDefinition
  state: ComponentLifecycleState
  generation: number
  available_dependency_ids: string[]
  active_effect_labels: string[]
  events: ComponentLifecycleEvent[]
}

export interface EffectRegistrar {
  effect(label: string, disposer: () => void): void
}

export type ComponentInstaller = (definition: ComponentDefinition, effects: EffectRegistrar) => void

export interface ComponentActivationPermit {
  schema: 'mykrobial.component-activation-permit.v1'
  transaction_id: string
  plan_sha256: string
  target_component_id: string
  before_snapshot_sha256: string
  candidate_definition_sha256: string
  prediction_rehearsal_receipt_sha256: string
  replay_receipt_sha256: string
  rollback_contract_sha256: string
  external_effect_boundary_sha256: string
  expires_at: string
  permit_sha256: string
}

export interface ComponentActivationPermitExpectation {
  transaction_id: string
  plan_sha256: string
  target_component_id: string
  before_snapshot_sha256: string
  candidate_definition_sha256: string
  prediction_rehearsal_receipt_sha256: string
  replay_receipt_sha256: string
  rollback_contract_sha256: string
  external_effect_boundary_sha256: string
  expires_at: string
}

export interface ComponentActivationPermitDecision {
  schema: 'mykrobial.component-activation-permit-decision.v1'
  status: 'admitted' | 'rejected'
  expectation_sha256: string
  permit_sha256: string
  verifier_identity_sha256: string
  verifier_source_sha256: string
  execution_authorized: boolean
  decision_sha256: string
}

export interface ComponentActivationPermitVerifier {
  identity_sha256: string
  source_sha256: string
  verify(
    permit: ComponentActivationPermit,
    expectation: ComponentActivationPermitExpectation,
  ): ComponentActivationPermitDecision
}

export interface ComponentHealthObservation {
  sequence: number
  check_id: string
  passed: boolean
  snapshot_sha256: string
}

export interface ComponentActivationTransactionReceipt {
  schema: 'mykrobial.component-activation-transaction-receipt.v1'
  transaction_id: string
  plan_sha256: string
  component_id: string
  before_generation: number
  candidate_generation: number | null
  final_generation: number
  before_snapshot_sha256: string
  candidate_definition_sha256: string
  candidate_snapshot_sha256: string | null
  final_snapshot_sha256: string
  prediction_rehearsal_receipt_sha256: string
  replay_receipt_sha256: string
  rollback_contract_sha256: string
  external_effect_boundary_sha256: string
  permit_sha256: string
  permit_decision_sha256: string
  permit_verifier_identity_sha256: string
  permit_verifier_source_sha256: string
  planned_health_observation_count: number
  completed_health_observation_count: number
  health_observations: ComponentHealthObservation[]
  outcome: 'committed' | 'rolled_back' | 'rollback_failed'
  blocker: string | null
  residual_effect_labels: string[]
  environment_contamination_possible: boolean
  component_effects_executed: true
  promotion_authorized: false
  trace_append_authorized: false
  deployment_authorized: false
  non_claims: [
    'not_optimizer_execution',
    'not_evaluator_execution',
    'not_permit_issuer_or_verifier_implementation',
    'not_trace_append',
    'not_promotion',
    'not_deployment',
  ]
  receipt_sha256: string
}

export interface ExecuteComponentActivationTransactionInput {
  transaction_id: string
  plan_sha256: string
  candidate_definition: ComponentDefinition
  candidate_installer: ComponentInstaller
  rollback_installer: ComponentInstaller
  permit: ComponentActivationPermit
  permit_verifier: ComponentActivationPermitVerifier
  prediction_rehearsal_receipt_sha256: string
  replay_receipt_sha256: string
  rollback_contract_sha256: string
  external_effect_boundary_sha256: string
  observed_at: string
  health_check_ids: string[]
  health_observation_count: number
  observe_health: (
    sequence: number,
    snapshot: ComponentSnapshot,
  ) => Readonly<Record<string, boolean>>
}

class ComponentCleanupIncompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComponentCleanupIncompleteError'
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => (
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
    )).join(',')}}`
  }
  throw new Error('unsupported canonical value')
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

export function componentCanonicalSha256(value: unknown): string {
  return hash(value)
}

function uniqueIds(values: readonly string[]): string[] {
  const result = [...values].sort()
  if (result.some(value => !ID.test(value)) || new Set(result).size !== result.length) {
    throw new Error('typed_blocker:component_dependency_identity_invalid')
  }
  return result
}

function validateDefinition(source: ComponentDefinition): ComponentDefinition {
  const value = structuredClone(source)
  if (!ID.test(value.component_id) || !ID.test(value.logical_identity)) {
    throw new Error('typed_blocker:component_identity_invalid')
  }
  if (!SHA.test(value.source_sha256) || !SHA.test(value.configuration_sha256)) {
    throw new Error('typed_blocker:component_source_or_configuration_invalid')
  }
  value.dependency_ids = uniqueIds(value.dependency_ids)
  return value
}

export class ComponentLifecycleController {
  private definition: ComponentDefinition
  private state: ComponentLifecycleState = 'registered'
  private generation = 0
  private readonly events: ComponentLifecycleEvent[] = []
  private available = new Set<string>()
  private effects: Array<{ label: string; dispose: () => void }> = []
  private installer: ComponentInstaller | null = null

  constructor(definition: ComponentDefinition) {
    this.definition = validateDefinition(definition)
    this.record('registered', 'component_registered')
  }

  reconcile(availableDependencyIds: readonly string[], installer: ComponentInstaller): ComponentSnapshot {
    this.assertNotDisposed()
    this.available = new Set(uniqueIds(availableDependencyIds))
    this.installer = installer
    const missing = this.definition.dependency_ids.filter(id => !this.available.has(id))
    if (missing.length > 0) {
      if (this.state === 'active') this.deactivate(`dependencies_lost:${missing.join(',')}`)
      this.state = 'pending_dependencies'
      this.record('pending', `dependencies_missing:${missing.join(',')}`)
      return this.snapshot()
    }
    if (this.state !== 'active') this.activate('dependencies_satisfied')
    return this.snapshot()
  }

  replace(nextDefinition: ComponentDefinition, installer: ComponentInstaller): ComponentSnapshot {
    this.assertNotDisposed()
    const previousDefinition = structuredClone(this.definition)
    const previousInstaller = this.installer
    if (this.state === 'active') this.deactivate('replacement_requested')
    this.definition = validateDefinition(nextDefinition)
    this.generation += 1
    this.installer = installer
    try {
      const missing = this.definition.dependency_ids.filter(id => !this.available.has(id))
      if (missing.length > 0) {
        this.state = 'pending_dependencies'
        this.record('pending', `replacement_dependencies_missing:${missing.join(',')}`)
        return this.snapshot()
      }
      this.activate('replacement_dependencies_satisfied')
      return this.snapshot()
    } catch (error: unknown) {
      if (error instanceof ComponentCleanupIncompleteError) throw error
      this.definition = previousDefinition
      this.installer = previousInstaller
      this.generation += 1
      this.record('rollback', 'replacement_activation_failed')
      if (previousInstaller !== null) this.activate('rollback_previous_generation')
      throw error
    }
  }

  rollbackTo(
    previousDefinition: ComponentDefinition,
    installer: ComponentInstaller,
    reason = 'component_activation_health_horizon_failed',
  ): ComponentSnapshot {
    this.assertNotDisposed()
    if (!ID.test(reason)) throw new Error('typed_blocker:component_rollback_reason_invalid')
    if (this.state === 'active') this.deactivate('rollback_requested')
    this.definition = validateDefinition(previousDefinition)
    this.generation += 1
    this.installer = installer
    this.record('rollback', reason)
    const missing = this.definition.dependency_ids.filter(id => !this.available.has(id))
    if (missing.length > 0) {
      this.state = 'pending_dependencies'
      this.record('pending', `rollback_dependencies_missing:${missing.join(',')}`)
      return this.snapshot()
    }
    this.activate('rollback_previous_generation')
    return this.snapshot()
  }

  restart(): ComponentSnapshot {
    this.assertNotDisposed()
    if (this.installer === null) throw new Error('typed_blocker:component_installer_unavailable')
    if (this.state === 'active') this.deactivate('restart_requested')
    this.generation += 1
    return this.reconcile([...this.available], this.installer)
  }

  dispose(): ComponentSnapshot {
    if (this.state === 'disposed') return this.snapshot()
    if (this.state === 'active') this.deactivate('component_disposed')
    this.state = 'disposed'
    this.record('disposed', 'component_disposed')
    return this.snapshot()
  }

  snapshot(): ComponentSnapshot {
    return {
      schema: 'mykrobial.component-snapshot.v1',
      definition: structuredClone(this.definition),
      state: this.state,
      generation: this.generation,
      available_dependency_ids: [...this.available].sort(),
      active_effect_labels: this.effects.map(effect => effect.label),
      events: structuredClone(this.events),
    }
  }

  private activate(reason: string): void {
    if (this.installer === null) throw new Error('typed_blocker:component_installer_unavailable')
    const installed: Array<{ label: string; dispose: () => void }> = []
    try {
      this.installer(this.definition, {
        effect(label, disposer) {
          if (!ID.test(label) || typeof disposer !== 'function') {
            throw new Error('typed_blocker:component_effect_invalid')
          }
          installed.push({ label, dispose: disposer })
        },
      })
      this.effects = installed
      this.state = 'active'
      this.record('activated', reason)
    } catch (error: unknown) {
      const failedEffects: Array<{ label: string; dispose: () => void }> = []
      for (const effect of [...installed].reverse()) {
        try {
          effect.dispose()
        } catch {
          failedEffects.push(effect)
        }
      }
      this.effects = failedEffects.reverse()
      this.state = 'failed'
      this.record(
        'failed',
        failedEffects.length === 0
          ? 'activation_failed_cleanup_complete'
          : 'activation_failed_cleanup_incomplete',
      )
      if (failedEffects.length > 0) {
        throw new ComponentCleanupIncompleteError(
          'typed_blocker:component_activation_cleanup_incomplete',
        )
      }
      throw error
    }
  }

  private deactivate(reason: string): void {
    this.state = 'unloading'
    this.record('unloading', reason)
    const failedEffects: Array<{ label: string; dispose: () => void }> = []
    for (const effect of [...this.effects].reverse()) {
      try {
        effect.dispose()
      } catch {
        failedEffects.push(effect)
      }
    }
    this.effects = failedEffects.reverse()
    const cleanupFailed = failedEffects.length > 0
    this.state = cleanupFailed ? 'failed' : 'inactive'
    this.record(cleanupFailed ? 'failed' : 'inactive', cleanupFailed ? 'cleanup_failed' : reason)
    if (cleanupFailed) throw new Error('typed_blocker:component_cleanup_failed')
  }

  private record(kind: ComponentLifecycleEvent['kind'], reason: string): void {
    this.events.push({
      schema: 'mykrobial.component-lifecycle-event.v1',
      sequence: this.events.length,
      generation: this.generation,
      component_id: this.definition.component_id,
      kind,
      reason,
      definition_sha256: hash(this.definition),
    })
  }

  private assertNotDisposed(): void {
    if (this.state === 'disposed') throw new Error('typed_blocker:component_disposed')
  }
}

const PERMIT_KEYS = [
  'schema',
  'transaction_id',
  'plan_sha256',
  'target_component_id',
  'before_snapshot_sha256',
  'candidate_definition_sha256',
  'prediction_rehearsal_receipt_sha256',
  'replay_receipt_sha256',
  'rollback_contract_sha256',
  'external_effect_boundary_sha256',
  'expires_at',
  'permit_sha256',
] as const

const DECISION_KEYS = [
  'schema',
  'status',
  'expectation_sha256',
  'permit_sha256',
  'verifier_identity_sha256',
  'verifier_source_sha256',
  'execution_authorized',
  'decision_sha256',
] as const

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function strictTimestamp(value: string, label: string): number {
  if (!UTC.test(value)) throw new Error(`typed_blocker:${label}_invalid`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().replace('.000Z', 'Z') !== value) {
    throw new Error(`typed_blocker:${label}_invalid`)
  }
  return parsed
}

function sealTransactionReceipt(
  source: Omit<ComponentActivationTransactionReceipt, 'receipt_sha256'>,
): ComponentActivationTransactionReceipt {
  const value = { ...source, receipt_sha256: '0'.repeat(64) }
  value.receipt_sha256 = hash(value)
  return value
}

function transactionReceipt(
  input: ExecuteComponentActivationTransactionInput,
  decision: ComponentActivationPermitDecision,
  before: ComponentSnapshot,
  candidateSnapshot: ComponentSnapshot | null,
  finalSnapshot: ComponentSnapshot,
  observations: ComponentHealthObservation[],
  outcome: ComponentActivationTransactionReceipt['outcome'],
  blocker: string | null,
): ComponentActivationTransactionReceipt {
  return sealTransactionReceipt({
    schema: 'mykrobial.component-activation-transaction-receipt.v1',
    transaction_id: input.transaction_id,
    plan_sha256: input.plan_sha256,
    component_id: before.definition.component_id,
    before_generation: before.generation,
    candidate_generation: candidateSnapshot?.generation ?? null,
    final_generation: finalSnapshot.generation,
    before_snapshot_sha256: hash(before),
    candidate_definition_sha256: hash(validateDefinition(input.candidate_definition)),
    candidate_snapshot_sha256: candidateSnapshot === null ? null : hash(candidateSnapshot),
    final_snapshot_sha256: hash(finalSnapshot),
    prediction_rehearsal_receipt_sha256: input.prediction_rehearsal_receipt_sha256,
    replay_receipt_sha256: input.replay_receipt_sha256,
    rollback_contract_sha256: input.rollback_contract_sha256,
    external_effect_boundary_sha256: input.external_effect_boundary_sha256,
    permit_sha256: input.permit.permit_sha256,
    permit_decision_sha256: decision.decision_sha256,
    permit_verifier_identity_sha256: decision.verifier_identity_sha256,
    permit_verifier_source_sha256: decision.verifier_source_sha256,
    planned_health_observation_count: input.health_observation_count,
    completed_health_observation_count: observations.length === 0
      ? 0
      : Math.max(...observations.map(observation => observation.sequence)) + 1,
    health_observations: structuredClone(observations),
    outcome,
    blocker,
    residual_effect_labels: finalSnapshot.state === 'failed'
      ? [...finalSnapshot.active_effect_labels]
      : [],
    environment_contamination_possible: finalSnapshot.state === 'failed'
      && finalSnapshot.active_effect_labels.length > 0,
    component_effects_executed: true,
    promotion_authorized: false,
    trace_append_authorized: false,
    deployment_authorized: false,
    non_claims: [
      'not_optimizer_execution',
      'not_evaluator_execution',
      'not_permit_issuer_or_verifier_implementation',
      'not_trace_append',
      'not_promotion',
      'not_deployment',
    ],
  })
}

export function executeComponentActivationTransaction(
  controller: ComponentLifecycleController,
  input: ExecuteComponentActivationTransactionInput,
): ComponentActivationTransactionReceipt {
  const before = controller.snapshot()
  const candidate = validateDefinition(input.candidate_definition)
  if (!ID.test(input.transaction_id)
    || !SHA.test(input.plan_sha256)
    || candidate.component_id !== before.definition.component_id
    || !SHA.test(input.prediction_rehearsal_receipt_sha256)
    || !SHA.test(input.replay_receipt_sha256)
    || !SHA.test(input.rollback_contract_sha256)
    || !SHA.test(input.external_effect_boundary_sha256)
    || !Number.isInteger(input.health_observation_count)
    || input.health_observation_count < 1
    || input.health_observation_count > 32
    || input.health_check_ids.length < 1
    || input.health_check_ids.length > 32
    || input.health_check_ids.some(id => !ID.test(id))
    || new Set(input.health_check_ids).size !== input.health_check_ids.length
    || typeof input.observe_health !== 'function'
    || typeof input.candidate_installer !== 'function'
    || typeof input.rollback_installer !== 'function') {
    throw new Error('typed_blocker:component_activation_transaction_invalid')
  }
  const observedAt = strictTimestamp(input.observed_at, 'component_activation_observed_at')
  const expiresAt = strictTimestamp(input.permit.expires_at, 'component_activation_permit_expiry')
  if (observedAt > expiresAt) throw new Error('typed_blocker:component_activation_permit_stale')
  const expectation: ComponentActivationPermitExpectation = {
    transaction_id: input.transaction_id,
    plan_sha256: input.plan_sha256,
    target_component_id: before.definition.component_id,
    before_snapshot_sha256: hash(before),
    candidate_definition_sha256: hash(candidate),
    prediction_rehearsal_receipt_sha256: input.prediction_rehearsal_receipt_sha256,
    replay_receipt_sha256: input.replay_receipt_sha256,
    rollback_contract_sha256: input.rollback_contract_sha256,
    external_effect_boundary_sha256: input.external_effect_boundary_sha256,
    expires_at: input.permit.expires_at,
  }
  const permitCandidate = { ...input.permit, permit_sha256: '0'.repeat(64) }
  if (!exactKeys(input.permit, PERMIT_KEYS)
    || input.permit.schema !== 'mykrobial.component-activation-permit.v1'
    || Object.entries(expectation).some(([key, value]) => (
      input.permit[key as keyof ComponentActivationPermit] !== value
    ))
    || input.permit.permit_sha256 !== hash(permitCandidate)
    || !SHA.test(input.permit_verifier.identity_sha256)
    || !SHA.test(input.permit_verifier.source_sha256)) {
    throw new Error('typed_blocker:component_activation_permit_invalid')
  }
  const decision = input.permit_verifier.verify(structuredClone(input.permit), structuredClone(expectation))
  const decisionCandidate = { ...decision, decision_sha256: '0'.repeat(64) }
  if (!exactKeys(decision, DECISION_KEYS)
    || decision.schema !== 'mykrobial.component-activation-permit-decision.v1'
    || decision.status !== 'admitted'
    || decision.execution_authorized !== true
    || decision.expectation_sha256 !== hash(expectation)
    || decision.permit_sha256 !== input.permit.permit_sha256
    || decision.verifier_identity_sha256 !== input.permit_verifier.identity_sha256
    || decision.verifier_source_sha256 !== input.permit_verifier.source_sha256
    || decision.decision_sha256 !== hash(decisionCandidate)) {
    throw new Error('typed_blocker:component_activation_permit_rejected')
  }

  let candidateSnapshot: ComponentSnapshot | null = null
  try {
    candidateSnapshot = controller.replace(candidate, input.candidate_installer)
  } catch {
    const finalSnapshot = controller.snapshot()
    const rolledBack = finalSnapshot.state === 'active'
      && hash(finalSnapshot.definition) === hash(before.definition)
    const residual = finalSnapshot.state === 'failed'
      && finalSnapshot.active_effect_labels.length > 0
    const failedOnPrior = hash(finalSnapshot.definition) === hash(before.definition)
    return transactionReceipt(
      input,
      decision,
      before,
      null,
      finalSnapshot,
      [],
      rolledBack ? 'rolled_back' : 'rollback_failed',
      rolledBack
        ? 'typed_blocker:component_candidate_activation_failed'
        : residual && failedOnPrior
        ? 'typed_blocker:component_prior_quiesce_cleanup_incomplete'
        : residual
        ? 'typed_blocker:component_candidate_activation_cleanup_incomplete'
        : 'typed_blocker:component_candidate_activation_and_rollback_failed',
    )
  }

  const observations: ComponentHealthObservation[] = []
  let healthPassed = true
  for (let sequence = 0; sequence < input.health_observation_count; sequence += 1) {
    const snapshot = controller.snapshot()
    let result: Readonly<Record<string, boolean>>
    try {
      result = input.observe_health(sequence, snapshot)
    } catch {
      healthPassed = false
      break
    }
    if (typeof result !== 'object'
      || result === null
      || Array.isArray(result)
      || !exactKeys(result, input.health_check_ids)
      || Object.values(result).some(value => typeof value !== 'boolean')) {
      healthPassed = false
      break
    }
    for (const checkId of input.health_check_ids) {
      const passed = result[checkId]
      observations.push({
        sequence,
        check_id: checkId,
        passed,
        snapshot_sha256: hash(snapshot),
      })
      if (!passed) healthPassed = false
    }
    if (!healthPassed) break
  }
  if (healthPassed) {
    const finalSnapshot = controller.snapshot()
    return transactionReceipt(
      input,
      decision,
      before,
      candidateSnapshot,
      finalSnapshot,
      observations,
      'committed',
      null,
    )
  }
  try {
    const finalSnapshot = controller.rollbackTo(before.definition, input.rollback_installer)
    return transactionReceipt(
      input,
      decision,
      before,
      candidateSnapshot,
      finalSnapshot,
      observations,
      'rolled_back',
      'typed_blocker:component_health_horizon_failed',
    )
  } catch {
    const finalSnapshot = controller.snapshot()
    const cleanupIncomplete = finalSnapshot.state === 'failed'
      && finalSnapshot.active_effect_labels.length > 0
    return transactionReceipt(
      input,
      decision,
      before,
      candidateSnapshot,
      finalSnapshot,
      observations,
      'rollback_failed',
      cleanupIncomplete
        ? 'typed_blocker:component_health_horizon_cleanup_incomplete'
        : 'typed_blocker:component_health_horizon_and_rollback_failed',
    )
  }
}
