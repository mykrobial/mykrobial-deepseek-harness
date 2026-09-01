/** Pure, closed OmniGent read model for component-scoped evolution. */
import { createHash } from 'node:crypto'
import {
  validateComponentExperimentCapsule,
  validateComponentReconfigurationPlan,
  validateExternalComponentDecision,
} from '../../component-rsi-seam/src/index.ts'
import type {
  ComponentExperimentCapsule,
  ComponentReconfigurationPlan,
  ExternalComponentDecision,
} from '../../component-rsi-seam/src/types.ts'

export type EvolutionSurfaceId =
  | 'prompt' | 'skill_card' | 'ontology_edge_or_function' | 'router'
  | 'workflow' | 'memory' | 'tool' | 'model_route' | 'model_adapter'
  | 'model_weights' | 'harness' | 'guardrail' | 'ui_projection' | 'loadout'

export type EvolutionPlane =
  | 'online_areal_actual_work'
  | 'local_idle_compute'
  | 'frontier_builder_critic'
  | 'future_joint_model_harness'

export type EvolutionProofLevel =
  | 'designed' | 'source_built' | 'source_verified'
  | 'runtime_verified' | 'deployed_verified'

export type ExperimentPhase =
  | 'proposal_prepared' | 'capsule_prepared' | 'evaluation_requested'
  | 'external_decision_received' | 'swap_planned' | 'rollback_planned'
  | 'replay_planned' | 'mismatch_observed' | 'no_change_selected'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA = /^[0-9a-f]{64}$/
const UTC = /^(\d{4})-(\d{2})-(\d{2})T((?:[01]\d|2[0-3])):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?Z$/
const BLOCKER = /^typed_blocker:[a-z0-9_:-]+$/
const SURFACES: readonly EvolutionSurfaceId[] = [
  'prompt', 'skill_card', 'ontology_edge_or_function', 'router', 'workflow',
  'memory', 'tool', 'model_route', 'model_adapter', 'model_weights', 'harness',
  'guardrail', 'ui_projection', 'loadout',
]
const PLANES: readonly EvolutionPlane[] = [
  'online_areal_actual_work', 'local_idle_compute', 'frontier_builder_critic',
  'future_joint_model_harness',
]
const PHASES: readonly ExperimentPhase[] = [
  'proposal_prepared', 'capsule_prepared', 'evaluation_requested',
  'external_decision_received', 'swap_planned', 'rollback_planned',
  'replay_planned', 'mismatch_observed', 'no_change_selected',
]
const PROOF_LEVELS: readonly EvolutionProofLevel[] = [
  'designed', 'source_built', 'source_verified', 'runtime_verified',
  'deployed_verified',
]
const LIFECYCLE_STATES = [
  'registered', 'pending_dependencies', 'active', 'unloading', 'inactive',
  'disposed', 'failed',
] as const

function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('typed_blocker:component_view_nonfinite_number')
    return value
  }
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child === undefined) throw new Error('typed_blocker:component_view_undefined_value')
      output[key] = canonical(child)
    }
    return output
  }
  throw new Error('typed_blocker:component_view_value_invalid')
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex')
}

function exact(value: unknown, keys: readonly string[], blocker: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`typed_blocker:${blocker}`)
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length
    || actual.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`typed_blocker:${blocker}`)
}

function identifier(value: unknown, blocker = 'component_view_identity_invalid'): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function digest(value: unknown, blocker = 'component_view_digest_invalid'): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function optionalDigest(value: unknown, blocker: string): string | null {
  return value === null ? null : digest(value, blocker)
}

function safeInteger(value: unknown, blocker: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`typed_blocker:${blocker}`)
  return value as number
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function timestamp(value: unknown, blocker: string): string {
  const match = typeof value === 'string' ? UTC.exec(value) : null
  if (match === null) throw new Error(`typed_blocker:${blocker}`)
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  return value as string
}

function timestampOrdinal(value: string): bigint {
  const match = UTC.exec(value)
  if (match === null) throw new Error('typed_blocker:component_view_timestamp_invalid')
  // The accepted language is fixed-width UTC civil time. Packing those fields
  // preserves its total chronological order without Date.UTC's legacy rule
  // that silently remaps numeric years 00-99 into 1900-1999.
  const microseconds = (match[7] ?? '').padEnd(6, '0')
  return BigInt(
    `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${match[6]}${microseconds}`,
  )
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], blocker: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`typed_blocker:${blocker}`)
  return value as T
}

function identifiers(value: unknown, blocker: string, maximum: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  const result = value.map(item => identifier(item, blocker))
  if (new Set(result).size !== result.length) throw new Error(`typed_blocker:${blocker}`)
  return [...result].sort()
}

function nonClaims(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32
    || value.some(item => typeof item !== 'string' || item.length === 0 || item.length > 128)
    || new Set(value).size !== value.length) {
    throw new Error('typed_blocker:component_view_non_claims_invalid')
  }
  return [...value].sort()
}

export interface ComponentGenerationViewInput {
  component_id: string
  logical_identity: string
  surface_id: EvolutionSurfaceId
  generation: number
  lifecycle_state: typeof LIFECYCLE_STATES[number]
  source_sha256: string
  configuration_sha256: string
  dependency_ids: string[]
  branch_id: string
  parent_component_id: string | null
  transaction_time: string
  valid_from: string | null
  valid_until: string | null
  experiment_id: string | null
  active: boolean
  rollback_available: boolean
}

export interface ExperimentArmViewInput {
  arm_id: string
  role: 'BASE' | 'TRUE' | 'SHAM'
  control_strategy: 'unchanged_baseline' | 'candidate_delta' | 'placebo_delta'
  loadout_manifest_sha256: string
  component_set_sha256: string
  applied_delta_sha256: string
  execution_state: 'planned' | 'running' | 'completed' | 'blocked'
  result_receipt_sha256: string | null
}

export interface ComponentOperationResult {
  schema: 'mykrobial.harness.component-operation-result.v1'
  result_id: string
  operation: 'swap' | 'rollback' | 'replay'
  plan_id: string
  plan_sha256: string
  capsule_id: string
  capsule_sha256: string
  decision_id: string
  decision_external_input_sha256: string
  pre_loadout_manifest_sha256: string
  post_loadout_manifest_sha256: string
  observed_components: ComponentGenerationViewInput[]
  activation_changed: boolean
  receipt_class: 'application' | 'rollback' | 'replay'
  verification_receipt_sha256: string
  operation_receipt_sha256: string
  observed_at: string
  basis_sha256: string
  issuer_authenticity_verified: false
  non_claims: string[]
  result_sha256: string
}

export interface BuildComponentOperationResultInput {
  capsule: ComponentExperimentCapsule
  decision: ExternalComponentDecision
  plan: ComponentReconfigurationPlan
  post_loadout_manifest_sha256: string
  observed_components: ComponentGenerationViewInput[]
  verification_receipt_sha256: string
  operation_receipt_sha256: string
  observed_at: string
}

export interface ComponentExperimentViewInput {
  experiment_id: string
  capsule_id: string
  capsule_sha256: string
  plane: EvolutionPlane
  target_component_ids: string[]
  target_surface_ids: EvolutionSurfaceId[]
  target_set_sha256: string
  capsule_artifact: ComponentExperimentCapsule
  arms: [ExperimentArmViewInput, ExperimentArmViewInput, ExperimentArmViewInput]
  decision: {
    state: 'none' | 'untrusted' | 'verified' | 'blocked'
    decision_id: string | null
    capsule_id: string | null
    external_input_sha256: string | null
    capsule_sha256: string | null
    disposition: 'accept_candidate' | 'reject_candidate' | 'revise_candidate' | 'no_change' | 'rollback' | null
    authority_receipt_sha256: string | null
    training_gate_receipt_sha256: string | null
    artifact: ExternalComponentDecision | null
  }
  plan: {
    state: 'none' | 'prepared_unexecuted' | 'verified_unapplied' | 'applied' | 'rolled_back' | 'blocked'
    operation: 'swap' | 'rollback' | 'replay' | null
    plan_id: string | null
    capsule_id: string | null
    decision_id: string | null
    plan_sha256: string | null
    post_loadout_manifest_sha256: string | null
    capsule_sha256: string | null
    decision_external_input_sha256: string | null
    verification_receipt_sha256: string | null
    applied_receipt_sha256: string | null
    replay_receipt_sha256: string | null
    rollback_receipt_sha256: string | null
    blocker_resolutions: Array<{ blocker: string; receipt_sha256: string }>
    operation_result: ComponentOperationResult | null
    artifact: ComponentReconfigurationPlan | null
  }
  proof_level: EvolutionProofLevel
}

export interface OptimizerPortViewInput {
  strategy_id: string
  plane: EvolutionPlane
  strategy_class: 'inner_loop' | 'external_optimizer' | 'areal_online' | 'local_idle' | 'frontier_builder_critic' | 'future_joint'
  state: 'declared' | 'available' | 'blocked'
  receipt_sha256: string | null
  blocker: string | null
  proposal_only: true
  training_authorized: false
  apply_authorized: false
}

export interface ComponentTimelineRowInput {
  sequence: number
  transaction_time: string
  valid_from: string | null
  valid_until: string | null
  phase: ExperimentPhase
  source_event_sha256: string
  component_ids: string[]
  experiment_id: string | null
  causality_state: 'not_asserted' | 'asserted_unverified' | 'verified'
  receipt_sha256: string | null
}

export interface OmniGentComponentEvolutionViewInput {
  generated_at: string
  task_capsule_id: string
  run_id: string
  harness_generation: 'current_production' | 'next_deepseek_cordis'
  active_loadout: { loadout_id: string; manifest_sha256: string }
  component_manifest_sha256: string
  mutation_surface_registry_sha256: string
  components: ComponentGenerationViewInput[]
  experiments: ComponentExperimentViewInput[]
  optimizer_ports: OptimizerPortViewInput[]
  timeline: ComponentTimelineRowInput[]
  trace: {
    state: 'intent_only' | 'queued' | 'append_verified' | 'blocked'
    intent_count: number
    chain_head_sha256: string | null
    append_receipt_sha256: string | null
    blocker: string | null
  }
  replay: { state: 'available' | 'verified' | 'blocked'; receipt_sha256: string | null }
  rollback: { state: 'declared' | 'rehearsed' | 'verified' | 'blocked'; receipt_sha256: string | null }
  proof_level: EvolutionProofLevel
  deployment_receipt_sha256: string | null
  non_claims: string[]
}

export type OmniGentComponentEvolutionView = OmniGentComponentEvolutionViewInput & {
  schema: 'mykrobial.omnigent.component-evolution-read-model.v1'
  view_sha256: string
}

function componentRow(value: unknown): ComponentGenerationViewInput {
  exact(value, [
    'component_id', 'logical_identity', 'surface_id', 'generation', 'lifecycle_state',
    'source_sha256', 'configuration_sha256', 'dependency_ids', 'branch_id',
    'parent_component_id', 'transaction_time', 'valid_from', 'valid_until',
    'experiment_id', 'active', 'rollback_available',
  ], 'component_view_component_closure_invalid')
  const row = structuredClone(value) as unknown as ComponentGenerationViewInput
  row.component_id = identifier(row.component_id)
  row.logical_identity = identifier(row.logical_identity)
  row.surface_id = oneOf(row.surface_id, SURFACES, 'component_view_surface_invalid')
  row.generation = safeInteger(row.generation, 'component_view_generation_invalid')
  row.lifecycle_state = oneOf(row.lifecycle_state, LIFECYCLE_STATES, 'component_view_lifecycle_state_invalid')
  row.source_sha256 = digest(row.source_sha256)
  row.configuration_sha256 = digest(row.configuration_sha256)
  row.dependency_ids = identifiers(row.dependency_ids, 'component_view_dependency_invalid', 128, true)
  row.branch_id = identifier(row.branch_id)
  row.parent_component_id = row.parent_component_id === null ? null : identifier(row.parent_component_id)
  row.transaction_time = timestamp(row.transaction_time, 'component_view_timestamp_invalid')
  row.valid_from = row.valid_from === null ? null : timestamp(row.valid_from, 'component_view_valid_time_invalid')
  row.valid_until = row.valid_until === null ? null : timestamp(row.valid_until, 'component_view_valid_time_invalid')
  row.experiment_id = row.experiment_id === null ? null : identifier(row.experiment_id)
  if (typeof row.active !== 'boolean' || typeof row.rollback_available !== 'boolean'
    || row.parent_component_id === row.component_id
    || (row.active && (row.lifecycle_state !== 'active' || row.valid_until !== null))
    || (row.valid_from !== null && row.valid_until !== null
      && timestampOrdinal(row.valid_until) < timestampOrdinal(row.valid_from))) {
    throw new Error('typed_blocker:component_view_component_state_invalid')
  }
  return row
}

const OPERATION_RESULT_NON_CLAIMS = [
  'not_receipt_issuer_authentication',
  'not_component_application_authority',
  'not_trace_append',
  'not_deployment_authority',
].sort()

function operationResultBasis(value: ComponentOperationResult): unknown {
  return {
    operation: value.operation,
    plan_id: value.plan_id,
    plan_sha256: value.plan_sha256,
    capsule_id: value.capsule_id,
    capsule_sha256: value.capsule_sha256,
    decision_id: value.decision_id,
    decision_external_input_sha256: value.decision_external_input_sha256,
    pre_loadout_manifest_sha256: value.pre_loadout_manifest_sha256,
    post_loadout_manifest_sha256: value.post_loadout_manifest_sha256,
    observed_components: value.observed_components,
    activation_changed: value.activation_changed,
    receipt_class: value.receipt_class,
    observed_at: value.observed_at,
  }
}

/** Revalidate an immutable operation-result readback against its accepted artifact chain. */
export function validateComponentOperationResult(
  value: ComponentOperationResult,
  capsuleInput: ComponentExperimentCapsule,
  decisionInput: ExternalComponentDecision,
  planInput: ComponentReconfigurationPlan,
): ComponentOperationResult {
  exact(value, [
    'schema', 'result_id', 'operation', 'plan_id', 'plan_sha256', 'capsule_id',
    'capsule_sha256', 'decision_id', 'decision_external_input_sha256',
    'pre_loadout_manifest_sha256', 'post_loadout_manifest_sha256',
    'observed_components', 'activation_changed', 'receipt_class',
    'verification_receipt_sha256', 'operation_receipt_sha256', 'observed_at',
    'basis_sha256', 'issuer_authenticity_verified', 'non_claims', 'result_sha256',
  ], 'component_operation_result_closure_invalid')
  const capsule = validateComponentExperimentCapsule(capsuleInput)
  const decision = validateExternalComponentDecision(decisionInput, capsule)
  const plan = validateComponentReconfigurationPlan(planInput, capsule, decision)
  const row = structuredClone(value)
  row.result_id = identifier(row.result_id, 'component_operation_result_identity_invalid')
  row.operation = oneOf(row.operation, ['swap', 'rollback', 'replay'] as const, 'component_operation_result_operation_invalid')
  row.plan_id = identifier(row.plan_id, 'component_operation_result_plan_invalid')
  row.plan_sha256 = digest(row.plan_sha256, 'component_operation_result_plan_invalid')
  row.capsule_id = identifier(row.capsule_id, 'component_operation_result_capsule_invalid')
  row.capsule_sha256 = digest(row.capsule_sha256, 'component_operation_result_capsule_invalid')
  row.decision_id = identifier(row.decision_id, 'component_operation_result_decision_invalid')
  row.decision_external_input_sha256 = digest(
    row.decision_external_input_sha256, 'component_operation_result_decision_invalid',
  )
  row.pre_loadout_manifest_sha256 = digest(
    row.pre_loadout_manifest_sha256, 'component_operation_result_loadout_invalid',
  )
  row.post_loadout_manifest_sha256 = digest(
    row.post_loadout_manifest_sha256, 'component_operation_result_loadout_invalid',
  )
  if (!Array.isArray(row.observed_components) || row.observed_components.length === 0
    || row.observed_components.length > 32 || typeof row.activation_changed !== 'boolean') {
    throw new Error('typed_blocker:component_operation_result_components_invalid')
  }
  row.observed_components = row.observed_components.map(componentRow).sort(
    (left, right) => left.component_id.localeCompare(right.component_id),
  )
  if (new Set(row.observed_components.map(component => component.component_id)).size
    !== row.observed_components.length) {
    throw new Error('typed_blocker:component_operation_result_components_invalid')
  }
  row.receipt_class = oneOf(
    row.receipt_class, ['application', 'rollback', 'replay'] as const,
    'component_operation_result_receipt_class_invalid',
  )
  row.verification_receipt_sha256 = digest(
    row.verification_receipt_sha256, 'component_operation_result_receipt_invalid',
  )
  row.operation_receipt_sha256 = digest(
    row.operation_receipt_sha256, 'component_operation_result_receipt_invalid',
  )
  row.observed_at = timestamp(row.observed_at, 'component_operation_result_timestamp_invalid')
  row.basis_sha256 = digest(row.basis_sha256, 'component_operation_result_basis_invalid')
  row.result_sha256 = digest(row.result_sha256, 'component_operation_result_digest_invalid')
  row.non_claims = nonClaims(row.non_claims)
  const targetRows = capsule.target_component_ids.map(id =>
    row.observed_components.find(component => component.component_id === id))
  if (targetRows.some(component => component === undefined)) {
    throw new Error('typed_blocker:component_operation_result_target_readback_missing')
  }
  if (row.operation === 'swap') {
    for (const target of targetRows as ComponentGenerationViewInput[]) {
      if (!target.active || target.lifecycle_state !== 'active' || target.valid_until !== null) {
        throw new Error('typed_blocker:component_operation_result_swap_postcondition_invalid')
      }
      if (target.parent_component_id !== null) {
        const parent = row.observed_components.find(
          component => component.component_id === target.parent_component_id,
        )
        if (parent === undefined || parent.active
          || !['inactive', 'disposed'].includes(parent.lifecycle_state)
          || parent.logical_identity !== target.logical_identity
          || parent.surface_id !== target.surface_id || parent.generation >= target.generation
          || parent.valid_until === null
          || timestampOrdinal(parent.valid_until) > timestampOrdinal(row.observed_at)) {
          throw new Error('typed_blocker:component_operation_result_swap_postcondition_invalid')
        }
      }
    }
  }
  if (row.operation === 'rollback') {
    for (const candidate of targetRows as ComponentGenerationViewInput[]) {
      const parent = candidate.parent_component_id === null ? undefined
        : row.observed_components.find(component => component.component_id === candidate.parent_component_id)
      if (candidate.active || !['inactive', 'disposed'].includes(candidate.lifecycle_state)
        || parent === undefined || !parent.active || parent.lifecycle_state !== 'active'
        || parent.valid_until !== null || parent.logical_identity !== candidate.logical_identity
        || parent.surface_id !== candidate.surface_id || parent.generation >= candidate.generation) {
        throw new Error('typed_blocker:component_operation_result_rollback_postcondition_invalid')
      }
    }
  }
  const expectedReceiptClass = row.operation === 'swap' ? 'application' : row.operation
  const expectedBasis = sha(operationResultBasis(row))
  const { result_sha256: _resultSha256, ...resultBody } = row
  const expectedResultSha256 = sha(resultBody)
  if (row.schema !== 'mykrobial.harness.component-operation-result.v1'
    || row.operation !== plan.operation || row.plan_id !== plan.plan_id
    || row.plan_sha256 !== plan.plan_sha256 || row.capsule_id !== capsule.capsule_id
    || row.capsule_sha256 !== capsule.capsule_sha256
    || row.decision_id !== decision.decision_id
    || row.decision_external_input_sha256 !== decision.external_input_sha256
    || row.pre_loadout_manifest_sha256 !== plan.current_loadout_manifest_sha256
    || row.receipt_class !== expectedReceiptClass
    || row.activation_changed !== (row.operation !== 'replay')
    || (row.operation === 'swap'
      ? row.post_loadout_manifest_sha256 === row.pre_loadout_manifest_sha256
      : row.post_loadout_manifest_sha256 !== row.pre_loadout_manifest_sha256)
    || timestampOrdinal(row.observed_at) < timestampOrdinal(plan.requested_at)
    || row.basis_sha256 !== expectedBasis
    || row.result_id !== `component-result-${expectedBasis.slice(0, 24)}`
    || row.issuer_authenticity_verified !== false
    || row.non_claims.join('\u0000') !== OPERATION_RESULT_NON_CLAIMS.join('\u0000')
    || row.result_sha256 !== expectedResultSha256) {
    throw new Error('typed_blocker:component_operation_result_invalid')
  }
  return row
}

/** Build a content-addressed, issuer-unverified component operation readback. */
export function buildComponentOperationResult(
  input: BuildComponentOperationResultInput,
): ComponentOperationResult {
  const capsule = validateComponentExperimentCapsule(input.capsule)
  const decision = validateExternalComponentDecision(input.decision, capsule)
  const plan = validateComponentReconfigurationPlan(input.plan, capsule, decision)
  const core = {
    schema: 'mykrobial.harness.component-operation-result.v1' as const,
    result_id: '',
    operation: plan.operation,
    plan_id: plan.plan_id,
    plan_sha256: plan.plan_sha256,
    capsule_id: capsule.capsule_id,
    capsule_sha256: capsule.capsule_sha256,
    decision_id: decision.decision_id,
    decision_external_input_sha256: decision.external_input_sha256,
    pre_loadout_manifest_sha256: plan.current_loadout_manifest_sha256,
    post_loadout_manifest_sha256: digest(
      input.post_loadout_manifest_sha256, 'component_operation_result_loadout_invalid',
    ),
    observed_components: structuredClone(input.observed_components),
    activation_changed: plan.operation !== 'replay',
    receipt_class: (plan.operation === 'swap' ? 'application' : plan.operation) as ComponentOperationResult['receipt_class'],
    verification_receipt_sha256: digest(
      input.verification_receipt_sha256, 'component_operation_result_receipt_invalid',
    ),
    operation_receipt_sha256: digest(
      input.operation_receipt_sha256, 'component_operation_result_receipt_invalid',
    ),
    observed_at: timestamp(input.observed_at, 'component_operation_result_timestamp_invalid'),
    basis_sha256: '',
    issuer_authenticity_verified: false as const,
    non_claims: [...OPERATION_RESULT_NON_CLAIMS],
  }
  const normalizedComponents = core.observed_components.map(componentRow).sort(
    (left, right) => left.component_id.localeCompare(right.component_id),
  )
  const basisInput = { ...core, observed_components: normalizedComponents } as ComponentOperationResult
  const basisSha256 = sha(operationResultBasis(basisInput))
  const body = {
    ...core,
    result_id: `component-result-${basisSha256.slice(0, 24)}`,
    observed_components: normalizedComponents,
    basis_sha256: basisSha256,
  }
  return validateComponentOperationResult(
    { ...body, result_sha256: sha(body) }, capsule, decision, plan,
  )
}

function experimentArm(value: unknown): ExperimentArmViewInput {
  exact(value, [
    'arm_id', 'role', 'control_strategy', 'loadout_manifest_sha256', 'component_set_sha256',
    'applied_delta_sha256', 'execution_state', 'result_receipt_sha256',
  ], 'component_view_arm_closure_invalid')
  const row = structuredClone(value) as unknown as ExperimentArmViewInput
  row.arm_id = identifier(row.arm_id, 'component_view_arm_invalid')
  row.role = oneOf(row.role, ['BASE', 'TRUE', 'SHAM'] as const, 'component_view_arm_invalid')
  row.control_strategy = oneOf(row.control_strategy, [
    'unchanged_baseline', 'candidate_delta', 'placebo_delta',
  ] as const, 'component_view_arm_control_invalid')
  row.loadout_manifest_sha256 = digest(row.loadout_manifest_sha256)
  row.component_set_sha256 = digest(row.component_set_sha256)
  row.applied_delta_sha256 = digest(row.applied_delta_sha256)
  row.execution_state = oneOf(row.execution_state, ['planned', 'running', 'completed', 'blocked'] as const, 'component_view_arm_state_invalid')
  row.result_receipt_sha256 = optionalDigest(row.result_receipt_sha256, 'component_view_arm_receipt_invalid')
  if (row.execution_state === 'completed' && row.result_receipt_sha256 === null) {
    throw new Error('typed_blocker:component_view_arm_receipt_missing')
  }
  if (row.execution_state !== 'completed' && row.result_receipt_sha256 !== null) {
    throw new Error('typed_blocker:component_view_arm_state_invalid')
  }
  return row
}

function blockerResolutions(
  value: unknown,
): Array<{ blocker: string; receipt_sha256: string }> {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('typed_blocker:component_view_blocker_resolutions_invalid')
  }
  const rows = value.map(item => {
    exact(item, ['blocker', 'receipt_sha256'], 'component_view_blocker_resolution_closure_invalid')
    const row = structuredClone(item) as { blocker: string; receipt_sha256: string }
    if (typeof row.blocker !== 'string' || !BLOCKER.test(row.blocker)) {
      throw new Error('typed_blocker:component_view_blocker_resolutions_invalid')
    }
    row.receipt_sha256 = digest(row.receipt_sha256, 'component_view_blocker_resolution_receipt_invalid')
    return row
  }).sort((left, right) => left.blocker.localeCompare(right.blocker))
  if (new Set(rows.map(row => row.blocker)).size !== rows.length) {
    throw new Error('typed_blocker:component_view_blocker_resolutions_invalid')
  }
  return rows
}

function experimentRow(value: unknown): ComponentExperimentViewInput {
  exact(value, [
    'experiment_id', 'capsule_id', 'capsule_sha256', 'plane',
    'target_component_ids', 'target_surface_ids', 'target_set_sha256',
    'capsule_artifact', 'arms', 'decision', 'plan',
    'proof_level',
  ], 'component_view_experiment_closure_invalid')
  const row = structuredClone(value) as unknown as ComponentExperimentViewInput
  row.experiment_id = identifier(row.experiment_id)
  row.capsule_id = identifier(row.capsule_id)
  row.capsule_sha256 = digest(row.capsule_sha256)
  row.plane = oneOf(row.plane, PLANES, 'component_view_plane_invalid')
  row.target_component_ids = identifiers(row.target_component_ids, 'component_view_target_invalid', 16)
  if (!Array.isArray(row.target_surface_ids) || row.target_surface_ids.length === 0 || row.target_surface_ids.length > 16) {
    throw new Error('typed_blocker:component_view_target_invalid')
  }
  row.target_surface_ids = row.target_surface_ids.map(surface => oneOf(surface, SURFACES, 'component_view_surface_invalid')).sort()
  if (new Set(row.target_surface_ids).size !== row.target_surface_ids.length) throw new Error('typed_blocker:component_view_target_invalid')
  row.target_set_sha256 = digest(row.target_set_sha256, 'component_view_target_set_invalid')
  row.capsule_artifact = validateComponentExperimentCapsule(row.capsule_artifact)
  if (row.target_surface_ids.includes('model_weights') && row.plane !== 'future_joint_model_harness') {
    throw new Error('typed_blocker:component_view_model_weights_plane_invalid')
  }
  if (!Array.isArray(row.arms) || row.arms.length !== 3) throw new Error('typed_blocker:component_view_arms_invalid')
  row.arms = row.arms.map(experimentArm) as [ExperimentArmViewInput, ExperimentArmViewInput, ExperimentArmViewInput]
  if (row.arms.map(arm => arm.role).join(',') !== 'BASE,TRUE,SHAM'
    || row.arms[0].control_strategy !== 'unchanged_baseline'
    || row.arms[1].control_strategy !== 'candidate_delta'
    || row.arms[2].control_strategy !== 'placebo_delta'
    || row.arms[1].applied_delta_sha256 !== row.target_set_sha256
    || new Set(row.arms.map(arm => arm.component_set_sha256)).size !== 3
    || new Set(row.arms.map(arm => arm.applied_delta_sha256)).size !== 3
    || new Set(row.arms.map(arm => arm.loadout_manifest_sha256)).size !== 1) {
    throw new Error('typed_blocker:component_view_arms_invalid')
  }
  const capsule = row.capsule_artifact
  if (capsule.experiment_id !== row.experiment_id
    || capsule.capsule_id !== row.capsule_id
    || capsule.capsule_sha256 !== row.capsule_sha256
    || capsule.plane !== row.plane
    || capsule.target_component_ids.join('\u0000') !== row.target_component_ids.join('\u0000')
    || capsule.target_surface_ids.join('\u0000') !== row.target_surface_ids.join('\u0000')
    || capsule.target_set_sha256 !== row.target_set_sha256
    || capsule.arms.length !== row.arms.length
    || capsule.arms.some((arm, index) => {
      const projected = row.arms[index]
      return projected === undefined || arm.arm_id !== projected.arm_id
        || arm.role !== projected.role || arm.control_strategy !== projected.control_strategy
        || arm.loadout_manifest_sha256 !== projected.loadout_manifest_sha256
        || arm.component_set_sha256 !== projected.component_set_sha256
        || arm.applied_delta_sha256 !== projected.applied_delta_sha256
    })) {
    throw new Error('typed_blocker:component_view_capsule_artifact_mismatch')
  }
  exact(row.decision, [
    'state', 'decision_id', 'capsule_id', 'external_input_sha256', 'capsule_sha256', 'disposition',
    'authority_receipt_sha256', 'training_gate_receipt_sha256', 'artifact',
  ], 'component_view_decision_closure_invalid')
  row.decision.state = oneOf(row.decision.state, ['none', 'untrusted', 'verified', 'blocked'] as const, 'component_view_decision_state_invalid')
  row.decision.decision_id = row.decision.decision_id === null ? null : identifier(row.decision.decision_id)
  row.decision.capsule_id = row.decision.capsule_id === null ? null : identifier(row.decision.capsule_id)
  row.decision.external_input_sha256 = optionalDigest(
    row.decision.external_input_sha256, 'component_view_decision_digest_invalid',
  )
  row.decision.capsule_sha256 = optionalDigest(row.decision.capsule_sha256, 'component_view_decision_capsule_invalid')
  row.decision.authority_receipt_sha256 = optionalDigest(row.decision.authority_receipt_sha256, 'component_view_authority_receipt_invalid')
  row.decision.training_gate_receipt_sha256 = optionalDigest(
    row.decision.training_gate_receipt_sha256, 'component_view_training_receipt_invalid',
  )
  if (row.decision.disposition !== null) {
    row.decision.disposition = oneOf(row.decision.disposition, [
      'accept_candidate', 'reject_candidate', 'revise_candidate', 'no_change', 'rollback',
    ] as const, 'component_view_decision_disposition_invalid')
  }
  const decisionCore = [
    row.decision.decision_id, row.decision.capsule_id, row.decision.external_input_sha256,
    row.decision.capsule_sha256, row.decision.disposition,
  ]
  if ((row.decision.state === 'none' && [
    ...decisionCore, row.decision.authority_receipt_sha256,
    row.decision.training_gate_receipt_sha256,
  ].some(item => item !== null))
    || (row.decision.state !== 'none' && decisionCore.some(item => item === null))
    || (row.decision.state !== 'none' && (row.decision.capsule_id !== row.capsule_id
      || row.decision.capsule_sha256 !== row.capsule_sha256))
    || (row.decision.state === 'verified' && row.decision.authority_receipt_sha256 === null)
    || (row.decision.state !== 'verified' && (row.decision.authority_receipt_sha256 !== null
      || row.decision.training_gate_receipt_sha256 !== null))) {
    throw new Error('typed_blocker:component_view_decision_state_invalid')
  }
  if (row.decision.state === 'none') {
    if (row.decision.artifact !== null) {
      throw new Error('typed_blocker:component_view_decision_state_invalid')
    }
  } else {
    if (row.decision.artifact === null) {
      throw new Error('typed_blocker:component_view_decision_state_invalid')
    }
    row.decision.artifact = validateExternalComponentDecision(row.decision.artifact, capsule)
    if (row.decision.artifact.decision_id !== row.decision.decision_id
      || row.decision.artifact.capsule_id !== row.decision.capsule_id
      || row.decision.artifact.capsule_sha256 !== row.decision.capsule_sha256
      || row.decision.artifact.external_input_sha256 !== row.decision.external_input_sha256
      || row.decision.artifact.disposition !== row.decision.disposition) {
      throw new Error('typed_blocker:component_view_decision_artifact_mismatch')
    }
    const trainingBlocker = row.decision.artifact.blockers.includes(
      'typed_blocker:model_weights_training_gate_unverified',
    )
    if (row.decision.state === 'verified'
      && trainingBlocker !== (row.decision.training_gate_receipt_sha256 !== null)) {
      throw new Error('typed_blocker:component_view_decision_state_invalid')
    }
  }
  exact(row.plan, [
    'state', 'operation', 'plan_id', 'capsule_id', 'decision_id', 'plan_sha256',
    'post_loadout_manifest_sha256', 'capsule_sha256', 'decision_external_input_sha256',
    'verification_receipt_sha256', 'applied_receipt_sha256',
    'replay_receipt_sha256', 'rollback_receipt_sha256', 'blocker_resolutions',
    'operation_result', 'artifact',
  ], 'component_view_plan_closure_invalid')
  row.plan.state = oneOf(row.plan.state, [
    'none', 'prepared_unexecuted', 'verified_unapplied', 'applied', 'rolled_back', 'blocked',
  ] as const, 'component_view_plan_state_invalid')
  row.plan.operation = row.plan.operation === null ? null : oneOf(
    row.plan.operation, ['swap', 'rollback', 'replay'] as const, 'component_view_plan_operation_invalid',
  )
  row.plan.plan_id = row.plan.plan_id === null ? null : identifier(row.plan.plan_id)
  row.plan.capsule_id = row.plan.capsule_id === null ? null : identifier(row.plan.capsule_id)
  row.plan.decision_id = row.plan.decision_id === null ? null : identifier(row.plan.decision_id)
  row.plan.plan_sha256 = optionalDigest(row.plan.plan_sha256, 'component_view_plan_digest_invalid')
  row.plan.post_loadout_manifest_sha256 = optionalDigest(
    row.plan.post_loadout_manifest_sha256, 'component_view_plan_loadout_invalid',
  )
  row.plan.capsule_sha256 = optionalDigest(row.plan.capsule_sha256, 'component_view_plan_capsule_invalid')
  row.plan.decision_external_input_sha256 = optionalDigest(
    row.plan.decision_external_input_sha256, 'component_view_plan_decision_invalid',
  )
  row.plan.verification_receipt_sha256 = optionalDigest(row.plan.verification_receipt_sha256, 'component_view_plan_receipt_invalid')
  row.plan.applied_receipt_sha256 = optionalDigest(row.plan.applied_receipt_sha256, 'component_view_plan_receipt_invalid')
  row.plan.replay_receipt_sha256 = optionalDigest(row.plan.replay_receipt_sha256, 'component_view_plan_receipt_invalid')
  row.plan.rollback_receipt_sha256 = optionalDigest(row.plan.rollback_receipt_sha256, 'component_view_plan_receipt_invalid')
  row.plan.blocker_resolutions = blockerResolutions(row.plan.blocker_resolutions)
  const planCore = [
    row.plan.operation, row.plan.plan_id, row.plan.capsule_id, row.plan.decision_id,
    row.plan.plan_sha256, row.plan.capsule_sha256,
    row.plan.decision_external_input_sha256,
  ]
  if ((row.plan.state === 'none' && [
    ...planCore, row.plan.verification_receipt_sha256, row.plan.applied_receipt_sha256, row.plan.replay_receipt_sha256,
    row.plan.rollback_receipt_sha256, row.plan.post_loadout_manifest_sha256,
    row.plan.operation_result, ...row.plan.blocker_resolutions,
  ].some(item => item !== null))
    || (row.plan.state !== 'none' && planCore.some(item => item === null))
    || (row.plan.state !== 'none' && (row.decision.state === 'none'
      || row.plan.capsule_id !== row.capsule_id
      || row.plan.capsule_sha256 !== row.capsule_sha256
      || row.plan.decision_id !== row.decision.decision_id
      || row.plan.decision_external_input_sha256 !== row.decision.external_input_sha256))
    || (['verified_unapplied', 'applied', 'rolled_back'].includes(row.plan.state)
      !== (row.plan.verification_receipt_sha256 !== null))
    || (row.plan.state === 'applied' && row.plan.applied_receipt_sha256 === null)
    || (row.plan.state === 'rolled_back'
      && (row.plan.applied_receipt_sha256 === null || row.plan.rollback_receipt_sha256 === null))
    || (['applied', 'rolled_back'].includes(row.plan.state)
      !== (row.plan.post_loadout_manifest_sha256 !== null))
    || (['applied', 'rolled_back'].includes(row.plan.state)
      !== (row.plan.operation_result !== null))
    || (!['applied', 'rolled_back'].includes(row.plan.state) && row.plan.applied_receipt_sha256 !== null)
    || (row.plan.state !== 'rolled_back' && row.plan.rollback_receipt_sha256 !== null)
    || (!['verified_unapplied', 'applied', 'rolled_back'].includes(row.plan.state)
      && row.plan.blocker_resolutions.length !== 0)) {
    throw new Error('typed_blocker:component_view_plan_state_invalid')
  }
  if (row.plan.state === 'none') {
    if (row.plan.artifact !== null) {
      throw new Error('typed_blocker:component_view_plan_state_invalid')
    }
  } else {
    if (row.plan.artifact === null) {
      throw new Error('typed_blocker:component_view_plan_state_invalid')
    }
    if (row.decision.artifact === null) {
      throw new Error('typed_blocker:component_view_plan_state_invalid')
    }
    row.plan.artifact = validateComponentReconfigurationPlan(
      row.plan.artifact, capsule, row.decision.artifact,
    )
    if (row.plan.artifact.operation !== row.plan.operation
      || row.plan.artifact.plan_id !== row.plan.plan_id
      || row.plan.artifact.plan_sha256 !== row.plan.plan_sha256
      || row.plan.artifact.capsule_id !== row.plan.capsule_id
      || row.plan.artifact.capsule_sha256 !== row.plan.capsule_sha256
      || row.plan.artifact.decision_id !== row.plan.decision_id
      || row.plan.artifact.decision_external_input_sha256 !== row.plan.decision_external_input_sha256
      || row.plan.artifact.target_component_ids.join('\u0000') !== row.target_component_ids.join('\u0000')
      || row.plan.artifact.target_surface_ids.join('\u0000') !== row.target_surface_ids.join('\u0000')) {
      throw new Error('typed_blocker:component_view_plan_artifact_mismatch')
    }
    if (row.plan.operation_result !== null) {
      row.plan.operation_result = validateComponentOperationResult(
        row.plan.operation_result, capsule, row.decision.artifact, row.plan.artifact,
      )
      const operationReceipt = row.plan.operation === 'swap'
        ? row.plan.applied_receipt_sha256
        : row.plan.operation === 'rollback'
          ? row.plan.rollback_receipt_sha256
          : row.plan.replay_receipt_sha256
      if (row.plan.post_loadout_manifest_sha256
          !== row.plan.operation_result.post_loadout_manifest_sha256
        || row.plan.verification_receipt_sha256
          !== row.plan.operation_result.verification_receipt_sha256
        || operationReceipt !== row.plan.operation_result.operation_receipt_sha256) {
        throw new Error('typed_blocker:component_view_operation_result_receipt_mismatch')
      }
    }
    if (['verified_unapplied', 'applied', 'rolled_back'].includes(row.plan.state)) {
      const structurallyUnresolved = row.plan.artifact.blockers.filter(blocker => ![
        'typed_blocker:external_decision_authority_unverified',
        'typed_blocker:model_weights_training_gate_unverified',
      ].includes(blocker))
      const expectedResolutions = row.plan.artifact.blockers
        .filter(blocker => !structurallyUnresolved.includes(blocker))
        .map(blocker => ({
          blocker,
          receipt_sha256: blocker === 'typed_blocker:external_decision_authority_unverified'
            ? row.decision.authority_receipt_sha256
            : row.decision.training_gate_receipt_sha256,
        }))
      if (structurallyUnresolved.length !== 0
        || expectedResolutions.some(item => item.receipt_sha256 === null)
        || JSON.stringify(row.plan.blocker_resolutions) !== JSON.stringify(expectedResolutions)) {
        throw new Error('typed_blocker:component_view_plan_execution_admission_invalid')
      }
      if ((row.plan.operation === 'swap' && row.decision.disposition !== 'accept_candidate')
        || (row.plan.operation === 'rollback' && row.decision.disposition !== 'rollback')
        || (row.plan.operation === 'replay' && (row.plan.artifact.replay_receipt_sha256 === null
          || row.plan.replay_receipt_sha256 !== row.plan.artifact.replay_receipt_sha256))
        || (row.plan.operation === 'rollback' && (row.plan.artifact.rollback_receipt_sha256 === null
          || row.plan.rollback_receipt_sha256 !== row.plan.artifact.rollback_receipt_sha256))
        || (['applied', 'rolled_back'].includes(row.plan.state)
          && ((row.plan.operation === 'rollback') !== (row.plan.state === 'rolled_back')))) {
        throw new Error('typed_blocker:component_view_plan_execution_admission_invalid')
      }
    }
  }
  row.proof_level = oneOf(row.proof_level, PROOF_LEVELS, 'component_view_proof_level_invalid')
  if (['runtime_verified', 'deployed_verified'].includes(row.proof_level)
    && (!['applied', 'rolled_back'].includes(row.plan.state)
      || row.decision.state !== 'verified'
      || row.arms.some(arm => arm.execution_state !== 'completed'
        || arm.result_receipt_sha256 === null))) {
    throw new Error('typed_blocker:component_view_experiment_proof_incomplete')
  }
  if (!['runtime_verified', 'deployed_verified'].includes(row.proof_level)
    && ['applied', 'rolled_back'].includes(row.plan.state)) {
    throw new Error('typed_blocker:component_view_experiment_proof_overstated')
  }
  return row
}

function optimizerPort(value: unknown): OptimizerPortViewInput {
  exact(value, [
    'strategy_id', 'plane', 'strategy_class', 'state', 'receipt_sha256',
    'blocker', 'proposal_only', 'training_authorized', 'apply_authorized',
  ], 'component_view_optimizer_closure_invalid')
  const row = structuredClone(value) as unknown as OptimizerPortViewInput
  row.strategy_id = identifier(row.strategy_id)
  row.plane = oneOf(row.plane, PLANES, 'component_view_plane_invalid')
  row.strategy_class = oneOf(row.strategy_class, [
    'inner_loop', 'external_optimizer', 'areal_online', 'local_idle',
    'frontier_builder_critic', 'future_joint',
  ] as const, 'component_view_optimizer_strategy_invalid')
  row.state = oneOf(row.state, ['declared', 'available', 'blocked'] as const, 'component_view_optimizer_state_invalid')
  row.receipt_sha256 = optionalDigest(row.receipt_sha256, 'component_view_optimizer_receipt_invalid')
  if (row.blocker !== null && (typeof row.blocker !== 'string' || !BLOCKER.test(row.blocker))) {
    throw new Error('typed_blocker:component_view_optimizer_blocker_invalid')
  }
  if ((row.state === 'blocked') !== (row.blocker !== null)
    || (row.state === 'available') !== (row.receipt_sha256 !== null)
    || row.proposal_only !== true || row.training_authorized !== false
    || row.apply_authorized !== false) {
    throw new Error('typed_blocker:component_view_optimizer_state_invalid')
  }
  return row
}

function timelineRow(value: unknown): ComponentTimelineRowInput {
  exact(value, [
    'sequence', 'transaction_time', 'valid_from', 'valid_until', 'phase',
    'source_event_sha256', 'component_ids', 'experiment_id', 'causality_state',
    'receipt_sha256',
  ], 'component_view_timeline_closure_invalid')
  const row = structuredClone(value) as unknown as ComponentTimelineRowInput
  row.sequence = safeInteger(row.sequence, 'component_view_timeline_sequence_invalid')
  row.transaction_time = timestamp(row.transaction_time, 'component_view_timestamp_invalid')
  row.valid_from = row.valid_from === null ? null : timestamp(row.valid_from, 'component_view_valid_time_invalid')
  row.valid_until = row.valid_until === null ? null : timestamp(row.valid_until, 'component_view_valid_time_invalid')
  row.phase = oneOf(row.phase, PHASES, 'component_view_phase_invalid')
  row.source_event_sha256 = digest(row.source_event_sha256)
  row.component_ids = identifiers(row.component_ids, 'component_view_timeline_component_invalid', 128)
  row.experiment_id = row.experiment_id === null ? null : identifier(row.experiment_id)
  row.causality_state = oneOf(row.causality_state, [
    'not_asserted', 'asserted_unverified', 'verified',
  ] as const, 'component_view_causality_invalid')
  row.receipt_sha256 = optionalDigest(row.receipt_sha256, 'component_view_timeline_receipt_invalid')
  if (row.valid_from !== null && row.valid_until !== null
    && timestampOrdinal(row.valid_until) < timestampOrdinal(row.valid_from)) {
    throw new Error('typed_blocker:component_view_valid_time_invalid')
  }
  if (row.causality_state === 'verified' && row.receipt_sha256 === null) {
    throw new Error('typed_blocker:component_view_causality_receipt_missing')
  }
  if (row.causality_state !== 'verified' && row.receipt_sha256 !== null) {
    throw new Error('typed_blocker:component_view_causality_state_invalid')
  }
  return row
}

/**
 * Build a deterministic read-only component-evolution view for OmniGent.
 * @param source - Backend facts and receipt identities only.
 * @returns A content-addressed projection with no execution authority.
 */
export function buildOmniGentComponentEvolutionView(
  source: OmniGentComponentEvolutionViewInput,
): OmniGentComponentEvolutionView {
  exact(source, [
    'generated_at', 'task_capsule_id', 'run_id', 'harness_generation',
    'active_loadout', 'component_manifest_sha256', 'mutation_surface_registry_sha256',
    'components', 'experiments', 'optimizer_ports', 'timeline', 'trace', 'replay',
    'rollback', 'proof_level', 'deployment_receipt_sha256', 'non_claims',
  ], 'component_view_root_closure_invalid')
  const input = structuredClone(source)
  input.generated_at = timestamp(input.generated_at, 'component_view_timestamp_invalid')
  input.task_capsule_id = identifier(input.task_capsule_id)
  input.run_id = identifier(input.run_id)
  input.harness_generation = oneOf(input.harness_generation, [
    'current_production', 'next_deepseek_cordis',
  ] as const, 'component_view_harness_generation_invalid')
  exact(input.active_loadout, ['loadout_id', 'manifest_sha256'], 'component_view_loadout_closure_invalid')
  input.active_loadout.loadout_id = identifier(input.active_loadout.loadout_id)
  input.active_loadout.manifest_sha256 = digest(input.active_loadout.manifest_sha256)
  input.component_manifest_sha256 = digest(input.component_manifest_sha256)
  input.mutation_surface_registry_sha256 = digest(input.mutation_surface_registry_sha256)
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.length > 512
    || !Array.isArray(input.experiments) || input.experiments.length > 128
    || !Array.isArray(input.optimizer_ports) || input.optimizer_ports.length > 64
    || !Array.isArray(input.timeline) || input.timeline.length > 4096) {
    throw new Error('typed_blocker:component_view_collection_invalid')
  }
  input.components = input.components.map(componentRow).sort((left, right) =>
    left.component_id.localeCompare(right.component_id) || left.generation - right.generation)
  const componentIds = new Set(input.components.map(row => row.component_id))
  if (componentIds.size !== input.components.length) throw new Error('typed_blocker:component_view_component_duplicate_invalid')
  const componentById = new Map(input.components.map(row => [row.component_id, row]))
  for (const row of input.components) {
    if (row.parent_component_id === null) continue
    const parent = componentById.get(row.parent_component_id)
    if (parent === undefined
      || parent.logical_identity !== row.logical_identity
      || parent.surface_id !== row.surface_id
      || parent.generation >= row.generation
      || timestampOrdinal(parent.transaction_time) > timestampOrdinal(row.transaction_time)) {
      throw new Error('typed_blocker:component_view_parent_identity_invalid')
    }
  }
  const activeLogical = input.components.filter(row => row.active).map(row => row.logical_identity)
  if (new Set(activeLogical).size !== activeLogical.length) throw new Error('typed_blocker:component_view_active_identity_collision')
  input.experiments = input.experiments.map(experimentRow).sort((left, right) => left.experiment_id.localeCompare(right.experiment_id))
  const experimentIds = new Set(input.experiments.map(row => row.experiment_id))
  if (experimentIds.size !== input.experiments.length
    || input.experiments.some(row => row.target_component_ids.some(id => !componentIds.has(id)))
    || input.components.some(row => row.experiment_id !== null && !experimentIds.has(row.experiment_id))) {
    throw new Error('typed_blocker:component_view_experiment_identity_invalid')
  }
  for (const experiment of input.experiments) {
    const taskLoadout = experiment.capsule_artifact.task_binding
    if (taskLoadout.task_capsule_id !== input.task_capsule_id
      || taskLoadout.loadout_id !== input.active_loadout.loadout_id
      || experiment.capsule_artifact.source_binding.mutation_surface_registry_sha256
        !== input.mutation_surface_registry_sha256) {
      throw new Error('typed_blocker:component_view_capsule_run_binding_invalid')
    }
    if (['applied', 'rolled_back'].includes(experiment.plan.state)) {
      if (experiment.plan.post_loadout_manifest_sha256 !== input.active_loadout.manifest_sha256
        || (experiment.plan.operation === 'swap'
          && experiment.plan.post_loadout_manifest_sha256 === taskLoadout.loadout_manifest_sha256)
        || (experiment.plan.operation !== 'swap'
          && experiment.plan.post_loadout_manifest_sha256 !== taskLoadout.loadout_manifest_sha256)) {
        throw new Error('typed_blocker:component_view_active_loadout_binding_invalid')
      }
      const result = experiment.plan.operation_result
      if (result === null || timestampOrdinal(result.observed_at) > timestampOrdinal(input.generated_at)
        || result.observed_components.some(observed => {
          const projected = componentById.get(observed.component_id)
          return projected === undefined
            || JSON.stringify(canonical(projected)) !== JSON.stringify(canonical(observed))
        })) {
        throw new Error('typed_blocker:component_view_post_operation_readback_invalid')
      }
    } else if (taskLoadout.loadout_manifest_sha256 !== input.active_loadout.manifest_sha256) {
      throw new Error('typed_blocker:component_view_active_loadout_binding_invalid')
    }
    const targetSurfaces = [...new Set(experiment.target_component_ids.map(
      id => componentById.get(id)!.surface_id,
    ))].sort()
    if (targetSurfaces.join('\u0000') !== experiment.target_surface_ids.join('\u0000')) {
      throw new Error('typed_blocker:component_view_experiment_target_mismatch')
    }
  }
  input.optimizer_ports = input.optimizer_ports.map(optimizerPort).sort((left, right) => left.strategy_id.localeCompare(right.strategy_id))
  if (new Set(input.optimizer_ports.map(row => row.strategy_id)).size !== input.optimizer_ports.length) {
    throw new Error('typed_blocker:component_view_optimizer_duplicate_invalid')
  }
  input.timeline = input.timeline.map(timelineRow)
  for (let index = 0; index < input.timeline.length; index += 1) {
    const row = input.timeline[index]!
    if ((index > 0 && (row.sequence <= input.timeline[index - 1]!.sequence
      || timestampOrdinal(row.transaction_time)
        < timestampOrdinal(input.timeline[index - 1]!.transaction_time)))
      || row.component_ids.some(id => !componentIds.has(id))
      || (row.experiment_id !== null && !experimentIds.has(row.experiment_id))) {
      throw new Error('typed_blocker:component_view_timeline_identity_or_order_invalid')
    }
  }
  exact(input.trace, [
    'state', 'intent_count', 'chain_head_sha256', 'append_receipt_sha256', 'blocker',
  ], 'component_view_trace_closure_invalid')
  input.trace.state = oneOf(input.trace.state, ['intent_only', 'queued', 'append_verified', 'blocked'] as const, 'component_view_trace_state_invalid')
  input.trace.intent_count = safeInteger(input.trace.intent_count, 'component_view_trace_count_invalid')
  input.trace.chain_head_sha256 = optionalDigest(input.trace.chain_head_sha256, 'component_view_trace_digest_invalid')
  input.trace.append_receipt_sha256 = optionalDigest(input.trace.append_receipt_sha256, 'component_view_trace_digest_invalid')
  if (input.trace.blocker !== null && (typeof input.trace.blocker !== 'string' || !BLOCKER.test(input.trace.blocker))) {
    throw new Error('typed_blocker:component_view_trace_blocker_invalid')
  }
  if ((input.trace.state === 'blocked') !== (input.trace.blocker !== null)
    || (input.trace.state === 'append_verified'
      && (input.trace.chain_head_sha256 === null || input.trace.append_receipt_sha256 === null))
    || (input.trace.state !== 'append_verified' && input.trace.append_receipt_sha256 !== null)) {
    throw new Error('typed_blocker:component_view_trace_state_invalid')
  }
  exact(input.replay, ['state', 'receipt_sha256'], 'component_view_replay_closure_invalid')
  input.replay.state = oneOf(input.replay.state, ['available', 'verified', 'blocked'] as const, 'component_view_replay_state_invalid')
  input.replay.receipt_sha256 = optionalDigest(input.replay.receipt_sha256, 'component_view_replay_digest_invalid')
  if ((input.replay.state === 'verified') !== (input.replay.receipt_sha256 !== null)) {
    throw new Error('typed_blocker:component_view_replay_state_invalid')
  }
  exact(input.rollback, ['state', 'receipt_sha256'], 'component_view_rollback_closure_invalid')
  input.rollback.state = oneOf(input.rollback.state, ['declared', 'rehearsed', 'verified', 'blocked'] as const, 'component_view_rollback_state_invalid')
  input.rollback.receipt_sha256 = optionalDigest(input.rollback.receipt_sha256, 'component_view_rollback_digest_invalid')
  if ((['rehearsed', 'verified'].includes(input.rollback.state)) !== (input.rollback.receipt_sha256 !== null)) {
    throw new Error('typed_blocker:component_view_rollback_state_invalid')
  }
  for (const experiment of input.experiments) {
    if (!['verified_unapplied', 'applied', 'rolled_back'].includes(experiment.plan.state)) continue
    if (experiment.plan.operation === 'replay'
      && (input.replay.state !== 'verified'
        || experiment.plan.replay_receipt_sha256 !== input.replay.receipt_sha256)) {
      throw new Error('typed_blocker:component_view_replay_admission_invalid')
    }
    if (experiment.plan.operation === 'rollback'
      && (input.rollback.state !== 'verified'
        || experiment.plan.rollback_receipt_sha256 !== input.rollback.receipt_sha256)) {
      throw new Error('typed_blocker:component_view_rollback_admission_invalid')
    }
  }
  input.proof_level = oneOf(input.proof_level, PROOF_LEVELS, 'component_view_proof_level_invalid')
  input.deployment_receipt_sha256 = optionalDigest(input.deployment_receipt_sha256, 'component_view_deployment_digest_invalid')
  const runtimeFloor = input.trace.state === 'append_verified'
    && input.replay.state === 'verified'
    && input.rollback.state === 'verified'
    && input.experiments.some(row => ['applied', 'rolled_back'].includes(row.plan.state)
      && ['runtime_verified', 'deployed_verified'].includes(row.proof_level))
  if (['runtime_verified', 'deployed_verified'].includes(input.proof_level) && !runtimeFloor) {
    throw new Error('typed_blocker:component_view_runtime_proof_incomplete')
  }
  if (input.proof_level === 'deployed_verified' && input.deployment_receipt_sha256 === null) {
    throw new Error('typed_blocker:component_view_deployment_proof_incomplete')
  }
  if (input.proof_level === 'deployed_verified'
    && !input.experiments.some(row => row.proof_level === 'deployed_verified'
      && ['applied', 'rolled_back'].includes(row.plan.state))) {
    throw new Error('typed_blocker:component_view_deployment_proof_incomplete')
  }
  if (input.proof_level !== 'deployed_verified' && input.deployment_receipt_sha256 !== null) {
    throw new Error('typed_blocker:component_view_deployment_proof_overstated')
  }
  input.non_claims = nonClaims(input.non_claims)
  const body = {
    ...input,
    schema: 'mykrobial.omnigent.component-evolution-read-model.v1' as const,
  }
  return { ...body, view_sha256: sha(body) }
}

/**
 * Revalidate a public component-evolution projection at every consumer boundary.
 * @param value - Untrusted serialized read-model value.
 * @returns The exact canonical projection when every semantic join still holds.
 */
export function validateOmniGentComponentEvolutionView(
  value: unknown,
): OmniGentComponentEvolutionView {
  exact(value, [
    'generated_at', 'task_capsule_id', 'run_id', 'harness_generation',
    'active_loadout', 'component_manifest_sha256', 'mutation_surface_registry_sha256',
    'components', 'experiments', 'optimizer_ports', 'timeline', 'trace', 'replay',
    'rollback', 'proof_level', 'deployment_receipt_sha256', 'non_claims',
    'schema', 'view_sha256',
  ], 'component_view_public_closure_invalid')
  const candidate = structuredClone(value) as unknown as OmniGentComponentEvolutionView
  if (candidate.schema !== 'mykrobial.omnigent.component-evolution-read-model.v1') {
    throw new Error('typed_blocker:component_view_schema_invalid')
  }
  digest(candidate.view_sha256, 'component_view_digest_invalid')
  const { schema: _schema, view_sha256: _viewSha256, ...input } = candidate
  const rebuilt = buildOmniGentComponentEvolutionView(
    input as OmniGentComponentEvolutionViewInput,
  )
  if (rebuilt.view_sha256 !== candidate.view_sha256
    || JSON.stringify(canonical(rebuilt)) !== JSON.stringify(canonical(candidate))) {
    throw new Error('typed_blocker:component_view_public_revalidation_failed')
  }
  return rebuilt
}
