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

export interface ComponentResidualCleanupReceipt {
  schema: 'mykrobial.component-residual-cleanup-receipt.v1'
  remediation_id: string
  component_id: string
  before_snapshot_sha256: string
  after_snapshot_sha256: string
  authority_receipt_sha256: string
  attempted_effect_labels: string[]
  residual_effect_labels: string[]
  outcome: 'cleared' | 'incomplete'
  blocker: string | null
  component_effects_executed: true
  authority_verified: false
  trace_append_authorized: false
  deployment_authorized: false
  non_claims: [
    'not_authority_verification',
    'not_trace_append',
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

export type ComponentGuardianEventKind =
  | 'baseline_registered'
  | 'mutation_proposed'
  | 'snapshot_captured'
  | 'activation_committed'
  | 'activation_rolled_back'
  | 'activation_contaminated'
  | 'restart_observed'

export interface ComponentGuardianConfig {
  guardian_id: string
  component_id: string
  task_capsule_id: string
  loadout_id: string
  baseline_snapshot_sha256: string
  baseline_definition_sha256: string
  baseline_trajectory_event_sha256: string
  baseline_trace_v23_intent_sha256: string
  created_at: string
  max_events: number
  max_candidate_attempts: number
}

export interface AppendComponentGuardianEventInput {
  event_id: string
  kind: Exclude<ComponentGuardianEventKind, 'baseline_registered'>
  occurred_at: string
  component_snapshot_sha256: string
  candidate_definition_sha256: string | null
  mutation_proposal_sha256: string | null
  activation_receipt_sha256: string | null
  trajectory_event_sha256: string
  trace_v23_intent_sha256: string
  evidence_sha256: string
}

export interface ComponentGuardianEvent {
  schema: 'mykrobial.component-guardian-event.v1'
  guardian_id: string
  event_id: string
  sequence: number
  previous_event_sha256: string
  occurred_at: string
  component_id: string
  task_capsule_id: string
  loadout_id: string
  kind: ComponentGuardianEventKind
  component_snapshot_sha256: string
  candidate_definition_sha256: string | null
  mutation_proposal_sha256: string | null
  activation_receipt_sha256: string | null
  trajectory_event_sha256: string
  trace_v23_intent_sha256: string
  evidence_sha256: string
  history_rewrite_authorized: false
  component_application_authorized: false
  trace_append_authorized: false
  deployment_authorized: false
  non_claims: [
    'not_optimizer_execution',
    'not_component_application',
    'not_history_rewrite',
    'not_trace_append',
    'not_deployment',
  ]
  event_sha256: string
}

export interface ComponentGuardianSnapshot {
  schema: 'mykrobial.component-guardian-snapshot.v1'
  guardian_id: string
  component_id: string
  task_capsule_id: string
  loadout_id: string
  baseline_definition_sha256: string
  created_at: string
  max_events: number
  max_candidate_attempts: number
  head_event_sha256: string
  known_snapshot_sha256s: string[]
  candidate_attempts: Array<{ candidate_definition_sha256: string; attempt_count: number }>
  proposal_bindings: Array<{
    candidate_definition_sha256: string
    mutation_proposal_sha256: string
    attempt_count: number
  }>
  events: ComponentGuardianEvent[]
  snapshot_sha256: string
}

export type ComponentGuardianCommandOperation =
  | 'rewind_component'
  | 'rebuild_and_restart_component'

export interface PrepareComponentGuardianCommandInput {
  operation: ComponentGuardianCommandOperation
  target_snapshot_sha256: string
  reconfiguration_plan_sha256: string
  external_state_rollback_receipt_sha256: string | null
  requested_at: string
}

export interface ComponentGuardianCommand {
  schema: 'mykrobial.component-guardian-command.v1'
  command_id: string
  operation: ComponentGuardianCommandOperation
  guardian_id: string
  component_id: string
  task_capsule_id: string
  loadout_id: string
  history_event_count: number
  history_head_event_sha256: string
  target_snapshot_sha256: string
  reconfiguration_plan_sha256: string
  external_state_rollback_receipt_sha256: string | null
  external_state_rollback_verified: false
  required_authority_profile_id: 'profile:component-reconfiguration:v1'
  state: 'prepared_unexecuted'
  blockers: string[]
  apply_authorized: false
  restart_authorized: false
  history_rewrite_authorized: false
  trace_append_authorized: false
  deployment_authorized: false
  requested_at: string
  non_claims: [
    'not_component_rewind',
    'not_component_restart',
    'not_external_state_rollback',
    'not_authority_verification',
    'not_trace_append',
    'not_deployment',
  ]
  command_sha256: string
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
    this.assertReadyForMutation()
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
    this.assertReadyForMutation()
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
    this.assertReadyForMutation()
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

  remediateResidualEffects(
    remediationId: string,
    authorityReceiptSha256: string,
  ): ComponentResidualCleanupReceipt {
    this.assertNotDisposed()
    if (!ID.test(remediationId) || !SHA.test(authorityReceiptSha256)) {
      throw new Error('typed_blocker:component_remediation_identity_invalid')
    }
    if (this.state !== 'failed') {
      throw new Error('typed_blocker:component_remediation_not_required')
    }
    const before = this.snapshot()
    const attempted = this.effects.map(effect => effect.label)
    const failedEffects: Array<{ label: string; dispose: () => void }> = []
    for (const effect of [...this.effects].reverse()) {
      try {
        effect.dispose()
      } catch {
        failedEffects.push(effect)
      }
    }
    this.effects = failedEffects.reverse()
    const cleared = this.effects.length === 0
    this.state = cleared ? 'inactive' : 'failed'
    this.record(
      cleared ? 'inactive' : 'failed',
      cleared ? 'residual_cleanup_completed' : 'residual_cleanup_incomplete',
    )
    const after = this.snapshot()
    const body = {
      schema: 'mykrobial.component-residual-cleanup-receipt.v1' as const,
      remediation_id: remediationId,
      component_id: this.definition.component_id,
      before_snapshot_sha256: hash(before),
      after_snapshot_sha256: hash(after),
      authority_receipt_sha256: authorityReceiptSha256,
      attempted_effect_labels: attempted,
      residual_effect_labels: [...after.active_effect_labels],
      outcome: cleared ? 'cleared' as const : 'incomplete' as const,
      blocker: cleared ? null : 'typed_blocker:component_residual_cleanup_incomplete',
      component_effects_executed: true as const,
      authority_verified: false as const,
      trace_append_authorized: false as const,
      deployment_authorized: false as const,
      non_claims: [
        'not_authority_verification',
        'not_trace_append',
        'not_deployment',
      ] as ComponentResidualCleanupReceipt['non_claims'],
    }
    return {
      ...body,
      receipt_sha256: hash({ ...body, receipt_sha256: '0'.repeat(64) }),
    }
  }

  restart(): ComponentSnapshot {
    this.assertNotDisposed()
    this.assertReadyForMutation()
    if (this.installer === null) throw new Error('typed_blocker:component_installer_unavailable')
    if (this.state === 'active') this.deactivate('restart_requested')
    this.generation += 1
    return this.reconcile([...this.available], this.installer)
  }

  dispose(): ComponentSnapshot {
    if (this.state === 'disposed') return this.snapshot()
    this.assertReadyForMutation()
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

  private assertReadyForMutation(): void {
    if (this.state === 'failed') {
      throw new Error('typed_blocker:component_failed_requires_remediation')
    }
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
  if (before.state === 'failed') {
    throw new Error('typed_blocker:component_failed_requires_remediation')
  }
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

const GUARDIAN_CONFIG_KEYS = [
  'guardian_id',
  'component_id',
  'task_capsule_id',
  'loadout_id',
  'baseline_snapshot_sha256',
  'baseline_definition_sha256',
  'baseline_trajectory_event_sha256',
  'baseline_trace_v23_intent_sha256',
  'created_at',
  'max_events',
  'max_candidate_attempts',
] as const

const GUARDIAN_APPEND_KEYS = [
  'event_id',
  'kind',
  'occurred_at',
  'component_snapshot_sha256',
  'candidate_definition_sha256',
  'mutation_proposal_sha256',
  'activation_receipt_sha256',
  'trajectory_event_sha256',
  'trace_v23_intent_sha256',
  'evidence_sha256',
] as const

const GUARDIAN_EVENT_KEYS = [
  'schema',
  'guardian_id',
  'event_id',
  'sequence',
  'previous_event_sha256',
  'occurred_at',
  'component_id',
  'task_capsule_id',
  'loadout_id',
  'kind',
  'component_snapshot_sha256',
  'candidate_definition_sha256',
  'mutation_proposal_sha256',
  'activation_receipt_sha256',
  'trajectory_event_sha256',
  'trace_v23_intent_sha256',
  'evidence_sha256',
  'history_rewrite_authorized',
  'component_application_authorized',
  'trace_append_authorized',
  'deployment_authorized',
  'non_claims',
  'event_sha256',
] as const

const GUARDIAN_SNAPSHOT_KEYS = [
  'schema',
  'guardian_id',
  'component_id',
  'task_capsule_id',
  'loadout_id',
  'baseline_definition_sha256',
  'created_at',
  'max_events',
  'max_candidate_attempts',
  'head_event_sha256',
  'known_snapshot_sha256s',
  'candidate_attempts',
  'proposal_bindings',
  'events',
  'snapshot_sha256',
] as const

const GUARDIAN_COMMAND_INPUT_KEYS = [
  'operation',
  'target_snapshot_sha256',
  'reconfiguration_plan_sha256',
  'external_state_rollback_receipt_sha256',
  'requested_at',
] as const

const GUARDIAN_COMMAND_KEYS = [
  'schema',
  'command_id',
  'operation',
  'guardian_id',
  'component_id',
  'task_capsule_id',
  'loadout_id',
  'history_event_count',
  'history_head_event_sha256',
  'target_snapshot_sha256',
  'reconfiguration_plan_sha256',
  'external_state_rollback_receipt_sha256',
  'external_state_rollback_verified',
  'required_authority_profile_id',
  'state',
  'blockers',
  'apply_authorized',
  'restart_authorized',
  'history_rewrite_authorized',
  'trace_append_authorized',
  'deployment_authorized',
  'requested_at',
  'non_claims',
  'command_sha256',
] as const

const GUARDIAN_NON_CLAIMS: ComponentGuardianEvent['non_claims'] = [
  'not_optimizer_execution',
  'not_component_application',
  'not_history_rewrite',
  'not_trace_append',
  'not_deployment',
]

const GUARDIAN_COMMAND_NON_CLAIMS: ComponentGuardianCommand['non_claims'] = [
  'not_component_rewind',
  'not_component_restart',
  'not_external_state_rollback',
  'not_authority_verification',
  'not_trace_append',
  'not_deployment',
]

const GUARDIAN_EVENT_KINDS = new Set<ComponentGuardianEventKind>([
  'baseline_registered',
  'mutation_proposed',
  'snapshot_captured',
  'activation_committed',
  'activation_rolled_back',
  'activation_contaminated',
  'restart_observed',
])

function guardianRecord(value: unknown, keys: readonly string[], blocker: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  const prototype = Object.getPrototypeOf(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.values(descriptors).some(item => item.get !== undefined || item.set !== undefined || !item.enumerable)
    || !exactKeys(value, keys)) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  return value as Record<string, unknown>
}

function guardianArray(value: unknown, maximumLength: number, blocker: string): unknown[] {
  if (!Array.isArray(value)
    || !Number.isSafeInteger(value.length)
    || value.length > maximumLength) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  const expectedKeys = new Set<string>([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ])
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== expectedKeys.size
    || ownKeys.some(key => typeof key !== 'string' || !expectedKeys.has(key))) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true) {
      throw new Error(`typed_blocker:${blocker}`)
    }
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (lengthDescriptor === undefined
    || lengthDescriptor.get !== undefined
    || lengthDescriptor.set !== undefined
    || lengthDescriptor.enumerable !== false) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  return value
}

function guardianIdentifier(value: unknown, blocker: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function guardianDigest(value: unknown, blocker: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function guardianNullableDigest(value: unknown, blocker: string): string | null {
  return value === null ? null : guardianDigest(value, blocker)
}

function guardianBoundedInteger(value: unknown, minimum: number, maximum: number, blocker: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  return value as number
}

function sealGuardianEvent(
  source: Omit<ComponentGuardianEvent, 'event_sha256'>,
): ComponentGuardianEvent {
  const value: ComponentGuardianEvent = { ...source, event_sha256: '0'.repeat(64) }
  value.event_sha256 = hash(value)
  return value
}

function sealGuardianSnapshot(
  source: Omit<ComponentGuardianSnapshot, 'snapshot_sha256'>,
): ComponentGuardianSnapshot {
  const value: ComponentGuardianSnapshot = { ...source, snapshot_sha256: '0'.repeat(64) }
  value.snapshot_sha256 = hash(value)
  return value
}

function sealGuardianCommand(
  source: Omit<ComponentGuardianCommand, 'command_sha256'>,
): ComponentGuardianCommand {
  const value: ComponentGuardianCommand = { ...source, command_sha256: '0'.repeat(64) }
  value.command_sha256 = hash(value)
  return value
}

function guardianCommandBlockers(rollbackReceipt: string | null): string[] {
  const blockers = [
    'typed_blocker:component_guardian_authority_unverified',
    'typed_blocker:component_guardian_execution_unadmitted',
    'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted',
  ]
  if (rollbackReceipt === null) blockers.push('typed_blocker:external_state_rollback_receipt_missing')
  return blockers.sort()
}

/**
 * Keeps a component's evolution history outside the component state that activation or rewind can replace.
 * The guardian records content-addressed facts and prepares commands; it never applies a mutation or rewrites history.
 */
export class ComponentEvolutionGuardian {
  private readonly config: ComponentGuardianConfig
  private readonly events: ComponentGuardianEvent[] = []
  private readonly eventIds = new Set<string>()
  private readonly knownSnapshots = new Set<string>()
  private readonly candidateAttempts = new Map<string, number>()
  private readonly proposalBindings = new Map<string, number>()
  private lastTimestamp: number

  /**
   * Creates an append-only guardian with one deterministic baseline record.
   * @param source - Frozen component, task, loadout, history, and bound settings.
   */
  constructor(source: ComponentGuardianConfig) {
    const value = guardianRecord(source, GUARDIAN_CONFIG_KEYS, 'component_guardian_config_invalid')
    const config: ComponentGuardianConfig = {
      guardian_id: guardianIdentifier(value.guardian_id, 'component_guardian_identity_invalid'),
      component_id: guardianIdentifier(value.component_id, 'component_guardian_identity_invalid'),
      task_capsule_id: guardianIdentifier(value.task_capsule_id, 'component_guardian_identity_invalid'),
      loadout_id: guardianIdentifier(value.loadout_id, 'component_guardian_identity_invalid'),
      baseline_snapshot_sha256: guardianDigest(value.baseline_snapshot_sha256, 'component_guardian_baseline_invalid'),
      baseline_definition_sha256: guardianDigest(value.baseline_definition_sha256, 'component_guardian_baseline_invalid'),
      baseline_trajectory_event_sha256: guardianDigest(value.baseline_trajectory_event_sha256, 'component_guardian_baseline_invalid'),
      baseline_trace_v23_intent_sha256: guardianDigest(value.baseline_trace_v23_intent_sha256, 'component_guardian_baseline_invalid'),
      created_at: typeof value.created_at === 'string' ? value.created_at : '',
      max_events: guardianBoundedInteger(value.max_events, 2, 4096, 'component_guardian_event_budget_invalid'),
      max_candidate_attempts: guardianBoundedInteger(value.max_candidate_attempts, 1, 32, 'component_guardian_attempt_budget_invalid'),
    }
    this.lastTimestamp = strictTimestamp(config.created_at, 'component_guardian_created_at')
    this.config = structuredClone(config)
    this.knownSnapshots.add(config.baseline_snapshot_sha256)
    const immutableBaseline = {
      guardian_id: config.guardian_id,
      component_id: config.component_id,
      task_capsule_id: config.task_capsule_id,
      loadout_id: config.loadout_id,
      baseline_snapshot_sha256: config.baseline_snapshot_sha256,
      baseline_definition_sha256: config.baseline_definition_sha256,
      created_at: config.created_at,
    }
    const baseline = sealGuardianEvent({
      schema: 'mykrobial.component-guardian-event.v1',
      guardian_id: config.guardian_id,
      event_id: `guardian-baseline-${hash(immutableBaseline).slice(0, 24)}`,
      sequence: 0,
      previous_event_sha256: '0'.repeat(64),
      occurred_at: config.created_at,
      component_id: config.component_id,
      task_capsule_id: config.task_capsule_id,
      loadout_id: config.loadout_id,
      kind: 'baseline_registered',
      component_snapshot_sha256: config.baseline_snapshot_sha256,
      candidate_definition_sha256: null,
      mutation_proposal_sha256: null,
      activation_receipt_sha256: null,
      trajectory_event_sha256: config.baseline_trajectory_event_sha256,
      trace_v23_intent_sha256: config.baseline_trace_v23_intent_sha256,
      evidence_sha256: config.baseline_definition_sha256,
      history_rewrite_authorized: false,
      component_application_authorized: false,
      trace_append_authorized: false,
      deployment_authorized: false,
      non_claims: [...GUARDIAN_NON_CLAIMS],
    })
    this.events.push(baseline)
    this.eventIds.add(baseline.event_id)
  }

  /**
   * Reconstructs a guardian by replaying and revalidating every stored event.
   * @param source - Closed, content-addressed guardian snapshot.
   * @returns A guardian whose derived state matches the stored snapshot byte-for-byte.
   */
  static rehydrate(source: ComponentGuardianSnapshot): ComponentEvolutionGuardian {
    const value = guardianRecord(source, GUARDIAN_SNAPSHOT_KEYS, 'component_guardian_snapshot_invalid')
    const events = guardianArray(
      value.events,
      4096,
      'component_guardian_events_invalid',
    )
    const knownSnapshots = guardianArray(
      value.known_snapshot_sha256s,
      4096,
      'component_guardian_known_snapshots_invalid',
    )
    const candidateAttempts = guardianArray(
      value.candidate_attempts,
      4096,
      'component_guardian_candidate_attempts_invalid',
    )
    const proposalBindings = guardianArray(
      value.proposal_bindings,
      4096,
      'component_guardian_proposal_bindings_invalid',
    )
    if (value.schema !== 'mykrobial.component-guardian-snapshot.v1'
      || events.length === 0
      || knownSnapshots.length === 0) {
      throw new Error('typed_blocker:component_guardian_snapshot_invalid')
    }
    for (const snapshot of knownSnapshots) {
      guardianDigest(snapshot, 'component_guardian_known_snapshots_invalid')
    }
    for (const attemptValue of candidateAttempts) {
      const attempt = guardianRecord(
        attemptValue,
        ['candidate_definition_sha256', 'attempt_count'],
        'component_guardian_candidate_attempts_invalid',
      )
      guardianDigest(
        attempt.candidate_definition_sha256,
        'component_guardian_candidate_attempts_invalid',
      )
      guardianBoundedInteger(
        attempt.attempt_count,
        1,
        32,
        'component_guardian_candidate_attempts_invalid',
      )
    }
    for (const bindingValue of proposalBindings) {
      const binding = guardianRecord(
        bindingValue,
        ['candidate_definition_sha256', 'mutation_proposal_sha256', 'attempt_count'],
        'component_guardian_proposal_bindings_invalid',
      )
      guardianDigest(
        binding.candidate_definition_sha256,
        'component_guardian_proposal_bindings_invalid',
      )
      guardianDigest(
        binding.mutation_proposal_sha256,
        'component_guardian_proposal_bindings_invalid',
      )
      guardianBoundedInteger(
        binding.attempt_count,
        1,
        32,
        'component_guardian_proposal_bindings_invalid',
      )
    }
    const baseline = guardianRecord(
      events[0],
      GUARDIAN_EVENT_KEYS,
      'component_guardian_event_invalid',
    ) as unknown as ComponentGuardianEvent
    guardianArray(baseline.non_claims, 5, 'component_guardian_event_non_claims_invalid')
    const guardian = new ComponentEvolutionGuardian({
      guardian_id: guardianIdentifier(value.guardian_id, 'component_guardian_identity_invalid'),
      component_id: guardianIdentifier(value.component_id, 'component_guardian_identity_invalid'),
      task_capsule_id: guardianIdentifier(value.task_capsule_id, 'component_guardian_identity_invalid'),
      loadout_id: guardianIdentifier(value.loadout_id, 'component_guardian_identity_invalid'),
      baseline_snapshot_sha256: guardianDigest(baseline.component_snapshot_sha256, 'component_guardian_baseline_invalid'),
      baseline_definition_sha256: guardianDigest(value.baseline_definition_sha256, 'component_guardian_baseline_invalid'),
      baseline_trajectory_event_sha256: guardianDigest(baseline.trajectory_event_sha256, 'component_guardian_baseline_invalid'),
      baseline_trace_v23_intent_sha256: guardianDigest(baseline.trace_v23_intent_sha256, 'component_guardian_baseline_invalid'),
      created_at: typeof value.created_at === 'string' ? value.created_at : '',
      max_events: guardianBoundedInteger(value.max_events, 2, 4096, 'component_guardian_event_budget_invalid'),
      max_candidate_attempts: guardianBoundedInteger(value.max_candidate_attempts, 1, 32, 'component_guardian_attempt_budget_invalid'),
    })
    for (const eventValue of events.slice(1)) {
      const event = guardianRecord(
        eventValue,
        GUARDIAN_EVENT_KEYS,
        'component_guardian_event_invalid',
      ) as unknown as ComponentGuardianEvent
      guardianArray(event.non_claims, 5, 'component_guardian_event_non_claims_invalid')
      if (!GUARDIAN_EVENT_KINDS.has(event.kind) || event.kind === 'baseline_registered') {
        throw new Error('typed_blocker:component_guardian_event_kind_invalid')
      }
      guardian.append({
        event_id: event.event_id,
        kind: event.kind,
        occurred_at: event.occurred_at,
        component_snapshot_sha256: event.component_snapshot_sha256,
        candidate_definition_sha256: event.candidate_definition_sha256,
        mutation_proposal_sha256: event.mutation_proposal_sha256,
        activation_receipt_sha256: event.activation_receipt_sha256,
        trajectory_event_sha256: event.trajectory_event_sha256,
        trace_v23_intent_sha256: event.trace_v23_intent_sha256,
        evidence_sha256: event.evidence_sha256,
      })
    }
    const rebuilt = guardian.snapshot()
    if (hash(rebuilt) !== hash(source)) {
      throw new Error('typed_blocker:component_guardian_snapshot_mismatch')
    }
    return guardian
  }

  /**
   * Appends one component-evolution fact after validating its causal order and bounded candidate lineage.
   * @param source - Content-addressed event references; the method assigns sequence and previous-event hash.
   * @returns The sealed event appended to immutable guardian history.
   */
  append(source: AppendComponentGuardianEventInput): ComponentGuardianEvent {
    const value = guardianRecord(source, GUARDIAN_APPEND_KEYS, 'component_guardian_append_input_invalid')
    if (this.events.length >= this.config.max_events) {
      throw new Error('typed_blocker:component_guardian_event_budget_exhausted')
    }
    const eventId = guardianIdentifier(value.event_id, 'component_guardian_event_identity_invalid')
    if (this.eventIds.has(eventId)) throw new Error('typed_blocker:component_guardian_event_replayed')
    const kind = value.kind
    if (typeof kind !== 'string'
      || !GUARDIAN_EVENT_KINDS.has(kind as ComponentGuardianEventKind)
      || kind === 'baseline_registered') {
      throw new Error('typed_blocker:component_guardian_event_kind_invalid')
    }
    const occurredAt = typeof value.occurred_at === 'string' ? value.occurred_at : ''
    const timestamp = strictTimestamp(occurredAt, 'component_guardian_event_time')
    if (timestamp < this.lastTimestamp) throw new Error('typed_blocker:component_guardian_event_time_regressed')
    const componentSnapshot = guardianDigest(value.component_snapshot_sha256, 'component_guardian_event_digest_invalid')
    const candidate = guardianNullableDigest(value.candidate_definition_sha256, 'component_guardian_event_digest_invalid')
    const proposal = guardianNullableDigest(value.mutation_proposal_sha256, 'component_guardian_event_digest_invalid')
    const activation = guardianNullableDigest(value.activation_receipt_sha256, 'component_guardian_event_digest_invalid')
    const trajectory = guardianDigest(value.trajectory_event_sha256, 'component_guardian_event_digest_invalid')
    const traceIntent = guardianDigest(value.trace_v23_intent_sha256, 'component_guardian_event_digest_invalid')
    const evidence = guardianDigest(value.evidence_sha256, 'component_guardian_event_digest_invalid')

    if (kind === 'mutation_proposed') {
      if (candidate === null || proposal === null || activation !== null
        || !this.knownSnapshots.has(componentSnapshot)) {
        throw new Error('typed_blocker:component_guardian_mutation_proposal_invalid')
      }
      const attemptCount = (this.candidateAttempts.get(candidate) ?? 0) + 1
      if (attemptCount > this.config.max_candidate_attempts) {
        throw new Error('typed_blocker:component_guardian_candidate_attempt_budget_exhausted')
      }
      this.candidateAttempts.set(candidate, attemptCount)
      const proposalBinding = `${candidate}:${proposal}`
      this.proposalBindings.set(
        proposalBinding,
        (this.proposalBindings.get(proposalBinding) ?? 0) + 1,
      )
    } else if (kind === 'snapshot_captured') {
      if (candidate !== null || proposal !== null || activation !== null) {
        throw new Error('typed_blocker:component_guardian_snapshot_event_invalid')
      }
    } else if (kind === 'restart_observed') {
      if (candidate !== null || proposal !== null || activation === null) {
        throw new Error('typed_blocker:component_guardian_restart_event_invalid')
      }
    } else if (candidate === null || proposal === null || activation === null
      || !this.proposalBindings.has(`${candidate}:${proposal}`)) {
      throw new Error('typed_blocker:component_guardian_activation_event_invalid')
    }

    const previous = this.events[this.events.length - 1]!
    const event = sealGuardianEvent({
      schema: 'mykrobial.component-guardian-event.v1',
      guardian_id: this.config.guardian_id,
      event_id: eventId,
      sequence: this.events.length,
      previous_event_sha256: previous.event_sha256,
      occurred_at: occurredAt,
      component_id: this.config.component_id,
      task_capsule_id: this.config.task_capsule_id,
      loadout_id: this.config.loadout_id,
      kind: kind as AppendComponentGuardianEventInput['kind'],
      component_snapshot_sha256: componentSnapshot,
      candidate_definition_sha256: candidate,
      mutation_proposal_sha256: proposal,
      activation_receipt_sha256: activation,
      trajectory_event_sha256: trajectory,
      trace_v23_intent_sha256: traceIntent,
      evidence_sha256: evidence,
      history_rewrite_authorized: false,
      component_application_authorized: false,
      trace_append_authorized: false,
      deployment_authorized: false,
      non_claims: [...GUARDIAN_NON_CLAIMS],
    })
    this.events.push(event)
    this.eventIds.add(eventId)
    this.lastTimestamp = timestamp
    if (kind !== 'mutation_proposed') this.knownSnapshots.add(componentSnapshot)
    return structuredClone(event)
  }

  /**
   * Returns the complete append-only history and its derived lineage indexes.
   * @returns A sealed snapshot suitable for deterministic storage and replay.
   */
  snapshot(): ComponentGuardianSnapshot {
    const candidateAttempts = [...this.candidateAttempts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([candidate_definition_sha256, attempt_count]) => ({
        candidate_definition_sha256,
        attempt_count,
      }))
    const proposalBindings = [...this.proposalBindings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([binding, attempt_count]) => {
        const [candidate_definition_sha256, mutation_proposal_sha256] = binding.split(':')
        return {
          candidate_definition_sha256: candidate_definition_sha256!,
          mutation_proposal_sha256: mutation_proposal_sha256!,
          attempt_count,
        }
      })
    return sealGuardianSnapshot({
      schema: 'mykrobial.component-guardian-snapshot.v1',
      guardian_id: this.config.guardian_id,
      component_id: this.config.component_id,
      task_capsule_id: this.config.task_capsule_id,
      loadout_id: this.config.loadout_id,
      baseline_definition_sha256: this.config.baseline_definition_sha256,
      created_at: this.config.created_at,
      max_events: this.config.max_events,
      max_candidate_attempts: this.config.max_candidate_attempts,
      head_event_sha256: this.events[this.events.length - 1]!.event_sha256,
      known_snapshot_sha256s: [...this.knownSnapshots].sort(),
      candidate_attempts: candidateAttempts,
      proposal_bindings: proposalBindings,
      events: structuredClone(this.events),
    })
  }

  /**
   * Prepares a rewind or fixed rebuild-and-restart request without changing component state or guardian history.
   * @param source - Target snapshot, admitted-plan reference, external rollback evidence, and request time.
   * @returns A closed command that remains blocked on independent authority and execution.
   */
  prepareCommand(source: PrepareComponentGuardianCommandInput): ComponentGuardianCommand {
    const value = guardianRecord(source, GUARDIAN_COMMAND_INPUT_KEYS, 'component_guardian_command_input_invalid')
    if (value.operation !== 'rewind_component' && value.operation !== 'rebuild_and_restart_component') {
      throw new Error('typed_blocker:component_guardian_command_operation_invalid')
    }
    const operation = value.operation as ComponentGuardianCommandOperation
    const targetSnapshot = guardianDigest(value.target_snapshot_sha256, 'component_guardian_command_digest_invalid')
    if (!this.knownSnapshots.has(targetSnapshot)) {
      throw new Error('typed_blocker:component_guardian_target_snapshot_unknown')
    }
    const current = this.events[this.events.length - 1]!
    if (operation === 'rebuild_and_restart_component'
      && targetSnapshot !== current.component_snapshot_sha256) {
      throw new Error('typed_blocker:component_guardian_restart_target_not_current')
    }
    const requestedAt = typeof value.requested_at === 'string' ? value.requested_at : ''
    if (strictTimestamp(requestedAt, 'component_guardian_command_time') < this.lastTimestamp) {
      throw new Error('typed_blocker:component_guardian_command_time_regressed')
    }
    const rollbackReceipt = guardianNullableDigest(
      value.external_state_rollback_receipt_sha256,
      'component_guardian_command_digest_invalid',
    )
    const immutable = {
      operation,
      guardian_id: this.config.guardian_id,
      component_id: this.config.component_id,
      task_capsule_id: this.config.task_capsule_id,
      loadout_id: this.config.loadout_id,
      history_event_count: this.events.length,
      history_head_event_sha256: current.event_sha256,
      target_snapshot_sha256: targetSnapshot,
      reconfiguration_plan_sha256: guardianDigest(
        value.reconfiguration_plan_sha256,
        'component_guardian_command_digest_invalid',
      ),
      external_state_rollback_receipt_sha256: rollbackReceipt,
      requested_at: requestedAt,
    }
    const body: Omit<ComponentGuardianCommand, 'command_sha256' | 'command_id'> = {
      schema: 'mykrobial.component-guardian-command.v1',
      ...immutable,
      external_state_rollback_verified: false,
      required_authority_profile_id: 'profile:component-reconfiguration:v1',
      state: 'prepared_unexecuted',
      blockers: guardianCommandBlockers(rollbackReceipt),
      apply_authorized: false,
      restart_authorized: false,
      history_rewrite_authorized: false,
      trace_append_authorized: false,
      deployment_authorized: false,
      non_claims: [...GUARDIAN_COMMAND_NON_CLAIMS],
    }
    return sealGuardianCommand({
      ...body,
      command_id: `component-guardian-${hash(body).slice(0, 24)}`,
    })
  }
}

/**
 * Revalidates a serialized guardian command without granting authority.
 * @param source - Closed command returned by a component guardian.
 * @returns A defensive copy when the command's fields and self-hash are exact.
 */
export function validateComponentGuardianCommand(
  source: ComponentGuardianCommand,
): ComponentGuardianCommand {
  const value = guardianRecord(
    source,
    GUARDIAN_COMMAND_KEYS,
    'component_guardian_command_invalid',
  ) as unknown as ComponentGuardianCommand
  guardianArray(value.blockers, 4, 'component_guardian_command_blockers_invalid')
  guardianArray(value.non_claims, 6, 'component_guardian_command_non_claims_invalid')
  const candidate = { ...value, command_sha256: '0'.repeat(64) }
  const {
    command_id: _commandId,
    command_sha256: _commandSha256,
    ...commandIdentity
  } = value
  const rollbackReceipt = value.external_state_rollback_receipt_sha256
  const expectedCommandId = `component-guardian-${hash(commandIdentity).slice(0, 24)}`
  if (value.schema !== 'mykrobial.component-guardian-command.v1'
    || typeof value.command_id !== 'string'
    || value.command_id !== expectedCommandId
    || (value.operation !== 'rewind_component' && value.operation !== 'rebuild_and_restart_component')
    || typeof value.guardian_id !== 'string' || !ID.test(value.guardian_id)
    || typeof value.component_id !== 'string' || !ID.test(value.component_id)
    || typeof value.task_capsule_id !== 'string' || !ID.test(value.task_capsule_id)
    || typeof value.loadout_id !== 'string' || !ID.test(value.loadout_id)
    || !Number.isSafeInteger(value.history_event_count)
    || value.history_event_count < 1
    || value.history_event_count > 4096
    || typeof value.history_head_event_sha256 !== 'string' || !SHA.test(value.history_head_event_sha256)
    || typeof value.target_snapshot_sha256 !== 'string' || !SHA.test(value.target_snapshot_sha256)
    || typeof value.reconfiguration_plan_sha256 !== 'string' || !SHA.test(value.reconfiguration_plan_sha256)
    || (rollbackReceipt !== null
      && (typeof rollbackReceipt !== 'string' || !SHA.test(rollbackReceipt)))
    || value.external_state_rollback_verified !== false
    || value.required_authority_profile_id !== 'profile:component-reconfiguration:v1'
    || value.state !== 'prepared_unexecuted'
    || !Array.isArray(value.blockers)
    || value.blockers.some(blocker => typeof blocker !== 'string' || !blocker.startsWith('typed_blocker:'))
    || value.blockers.join('\u0000') !== guardianCommandBlockers(rollbackReceipt).join('\u0000')
    || value.apply_authorized !== false
    || value.restart_authorized !== false
    || value.history_rewrite_authorized !== false
    || value.trace_append_authorized !== false
    || value.deployment_authorized !== false
    || typeof value.requested_at !== 'string'
    || strictTimestamp(value.requested_at, 'component_guardian_command_time') < 0
    || !Array.isArray(value.non_claims)
    || value.non_claims.some(item => typeof item !== 'string')
    || value.non_claims.join('\u0000') !== GUARDIAN_COMMAND_NON_CLAIMS.join('\u0000')
    || typeof value.command_sha256 !== 'string'
    || value.command_sha256 !== hash(candidate)) {
    throw new Error('typed_blocker:component_guardian_command_invalid')
  }
  return structuredClone(value)
}
