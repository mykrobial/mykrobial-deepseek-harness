/** Pure source-only seam for per-component experiment, swap, replay, and rollback planning. */
import { createHash } from 'node:crypto'
import type {
  ArtifactRef,
  ComponentExperimentArm,
  ComponentExperimentCapsule,
  ComponentExperimentPhase,
  ComponentExperimentProjection,
  ComponentMutationProposal,
  ComponentPlanOperation,
  ComponentReconfigurationPlan,
  EvolutionPlane,
  ExperimentBudgetBinding,
  ExperimentEvaluatorBinding,
  ExperimentSourceBinding,
  ExperimentTaskBinding,
  ExternalComponentDecision,
  ExternalComponentDecisionInput,
  MutationSurfaceId,
  MutationSurfacePolicy,
  MutationSurfaceRegistry,
  MutationTarget,
  PrepareComponentPlanInput,
  PrepareExperimentCapsuleInput,
  PrepareMutationProposalInput,
  ProjectedTrajectoryEvent,
  ProjectExperimentLifecycleInput,
  SourceIdentity,
} from './types.ts'

export type * from './types.ts'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA256 = /^[0-9a-f]{64}$/
const GIT_ID = /^[0-9a-f]{40}$/
const TIMESTAMP = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,6}))?Z$/

/** Canonical mutation-surface identifiers in stable display order. */
export const MUTATION_SURFACE_IDS: readonly MutationSurfaceId[] = [
  'prompt',
  'skill_card',
  'ontology_edge_or_function',
  'router',
  'workflow',
  'memory',
  'tool',
  'model_route',
  'model_adapter',
  'model_weights',
  'harness',
  'guardrail',
  'ui_projection',
  'loadout',
]

/** Canonical evolution-plane identifiers; the planes are implemented elsewhere. */
export const EVOLUTION_PLANES: readonly EvolutionPlane[] = [
  'online_areal_actual_work',
  'local_idle_compute',
  'frontier_builder_critic',
  'future_joint_model_harness',
]

const SURFACES = new Set<string>(MUTATION_SURFACE_IDS)
const PLANES = new Set<string>(EVOLUTION_PLANES)

function record(value: unknown, keys: readonly string[], blocker: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`typed_blocker:${blocker}`)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.values(descriptors).some(item => item.get !== undefined || item.set !== undefined || !item.enumerable)) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  return value as Record<string, unknown>
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('typed_blocker:canonical_number_invalid')
    return value
  }
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child === undefined) throw new Error('typed_blocker:canonical_undefined_invalid')
      output[key] = canonical(child)
    }
    return output
  }
  throw new Error('typed_blocker:canonical_value_invalid')
}

/**
 * Compute the lowercase SHA-256 of canonical JSON data.
 * @param value - Finite JSON-compatible data to canonicalize.
 * @returns The lowercase hexadecimal digest.
 */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex')
}

function identifier(value: unknown, blocker: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function digest(value: unknown, blocker: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function optionalDigest(value: unknown, blocker: string): string | null {
  return value === null ? null : digest(value, blocker)
}

function timestamp(value: unknown, blocker: string): string {
  if (typeof value !== 'string') throw new Error(`typed_blocker:${blocker}`)
  const match = TIMESTAMP.exec(value)
  if (match === null) throw new Error(`typed_blocker:${blocker}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day > (days[month - 1] ?? 0)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function safeInteger(value: unknown, blocker: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`typed_blocker:${blocker}`)
  return value as number
}

function stringList(values: unknown, blocker: string): string[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
    throw new Error(`typed_blocker:${blocker}`)
  }
  return [...values] as string[]
}

function unique<T extends string>(values: readonly T[], blocker: string): T[] {
  if (new Set(values).size !== values.length) throw new Error(`typed_blocker:${blocker}`)
  return [...values]
}

function sourceIdentity(value: unknown): SourceIdentity {
  const item = record(value, ['repository', 'commit', 'tree', 'dirty_state', 'configuration_sha256'], 'component_rsi_source_identity_invalid')
  if (typeof item.repository !== 'string' || item.repository.length === 0 || item.repository.length > 512
    || typeof item.commit !== 'string' || !GIT_ID.test(item.commit)
    || typeof item.tree !== 'string' || !GIT_ID.test(item.tree)
    || !['clean', 'dirty_bound', 'unknown'].includes(String(item.dirty_state))) {
    throw new Error('typed_blocker:component_rsi_source_identity_invalid')
  }
  digest(item.configuration_sha256, 'component_rsi_source_identity_invalid')
  return structuredClone(item) as unknown as SourceIdentity
}

function surface(value: unknown): MutationSurfaceId {
  if (typeof value !== 'string' || !SURFACES.has(value)) {
    throw new Error('typed_blocker:component_mutation_surface_invalid')
  }
  return value as MutationSurfaceId
}

function plane(value: unknown): EvolutionPlane {
  if (typeof value !== 'string' || !PLANES.has(value)) {
    throw new Error('typed_blocker:component_evolution_plane_invalid')
  }
  return value as EvolutionPlane
}

function target(value: unknown): MutationTarget {
  const item = record(value, [
    'component_id', 'surface_id', 'base_component_identity_sha256',
    'candidate_component_identity_sha256', 'delta_sha256',
  ], 'component_mutation_target_invalid')
  return {
    component_id: identifier(item.component_id, 'component_mutation_target_invalid'),
    surface_id: surface(item.surface_id),
    base_component_identity_sha256: digest(item.base_component_identity_sha256, 'component_mutation_target_invalid'),
    candidate_component_identity_sha256: digest(item.candidate_component_identity_sha256, 'component_mutation_target_invalid'),
    delta_sha256: digest(item.delta_sha256, 'component_mutation_target_invalid'),
  }
}

function allowedPlanes(surfaceId: MutationSurfaceId): EvolutionPlane[] {
  return surfaceId === 'model_weights' ? ['future_joint_model_harness'] : [...EVOLUTION_PLANES]
}

function surfaceRows(): MutationSurfacePolicy[] {
  return MUTATION_SURFACE_IDS.map(surfaceId => ({
    surface_id: surfaceId,
    independently_versioned: true,
    independently_swappable: true,
    per_task_experiment_allowed: true,
    allowed_planes: allowedPlanes(surfaceId),
    training_gate_required: surfaceId === 'model_weights',
    runtime_application_authority_required: true,
    trace_projection_required: true,
  }))
}

/**
 * Return the content-addressed canonical mutation-surface registry.
 * @returns A fresh registry copy with its body digest.
 */
export function buildMutationSurfaceRegistry(): MutationSurfaceRegistry {
  const body = {
    schema: 'mykrobial.harness.component-mutation-surface-registry.v1' as const,
    registry_id: 'next-deepseek-cordis-component-surfaces-v1' as const,
    surfaces: surfaceRows(),
  }
  return { ...body, registry_sha256: canonicalSha256(body) }
}

function validateProposal(value: ComponentMutationProposal): ComponentMutationProposal {
  record(value, [
    'schema', 'proposal_id', 'plane', 'task_capsule_id', 'loadout_id', 'source',
    'context_pack_sha256', 'optimizer_input_sha256', 'targets', 'joint_delta_declaration_sha256',
    'created_at', 'harness_generation', 'delta_mode', 'target_set_sha256',
    'mutation_surface_registry_sha256', 'status', 'apply_authorized', 'training_authorized',
    'promotion_authorized', 'non_claims', 'proposal_sha256',
  ], 'component_mutation_proposal_closed_object_invalid')
  identifier(value.proposal_id, 'component_mutation_proposal_identity_invalid')
  const selectedPlane = plane(value.plane)
  identifier(value.task_capsule_id, 'component_mutation_task_identity_invalid')
  identifier(value.loadout_id, 'component_mutation_loadout_identity_invalid')
  sourceIdentity(value.source)
  digest(value.context_pack_sha256, 'component_mutation_context_pack_invalid')
  digest(value.optimizer_input_sha256, 'component_mutation_optimizer_input_invalid')
  if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > 16) {
    throw new Error('typed_blocker:component_mutation_targets_invalid')
  }
  const checkedTargets = value.targets.map(target)
  unique(checkedTargets.map(entry => `${entry.component_id}:${entry.surface_id}`), 'component_mutation_targets_duplicate')
  const sortedTargets = [...checkedTargets].sort((left, right) => left.component_id.localeCompare(right.component_id)
    || left.surface_id.localeCompare(right.surface_id))
  if (canonicalSha256(checkedTargets) !== canonicalSha256(sortedTargets)) {
    throw new Error('typed_blocker:component_mutation_target_order_invalid')
  }
  for (const entry of checkedTargets) {
    if (!allowedPlanes(entry.surface_id).includes(selectedPlane)) {
      throw new Error('typed_blocker:model_weights_future_joint_plane_required')
    }
  }
  const joint = optionalDigest(value.joint_delta_declaration_sha256, 'component_joint_delta_declaration_invalid')
  if ((checkedTargets.length === 1 && (value.delta_mode !== 'single_component' || joint !== null))
    || (checkedTargets.length > 1 && (value.delta_mode !== 'declared_joint' || joint === null))
    || value.target_set_sha256 !== canonicalSha256(checkedTargets)) {
    throw new Error('typed_blocker:component_joint_delta_declaration_invalid')
  }
  timestamp(value.created_at, 'component_mutation_timestamp_invalid')
  if (value.mutation_surface_registry_sha256 !== buildMutationSurfaceRegistry().registry_sha256) {
    throw new Error('typed_blocker:component_mutation_surface_registry_mismatch')
  }
  stringList(value.non_claims, 'component_mutation_non_claims_invalid')
  const expected = canonicalSha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'proposal_sha256')))
  if (value.schema !== 'mykrobial.harness.component-mutation-proposal.v1'
    || value.harness_generation !== 'next_deepseek_cordis'
    || value.status !== 'proposal_only_untrusted'
    || value.apply_authorized !== false || value.training_authorized !== false
    || value.promotion_authorized !== false || value.proposal_sha256 !== expected) {
    throw new Error('typed_blocker:component_mutation_proposal_invalid')
  }
  return value
}

/**
 * Normalize a component mutation proposal while granting no operational authority.
 * @param input - Frozen task, loadout, source, context, plane, and target facts.
 * @returns A content-addressed proposal-only artifact.
 */
export function prepareComponentMutationProposal(input: PrepareMutationProposalInput): ComponentMutationProposal {
  const item = record(input, [
    'proposal_id', 'plane', 'task_capsule_id', 'loadout_id', 'source', 'context_pack_sha256',
    'optimizer_input_sha256', 'targets', 'joint_delta_declaration_sha256', 'created_at',
  ], 'component_mutation_proposal_input_invalid')
  const selectedPlane = plane(item.plane)
  if (!Array.isArray(item.targets) || item.targets.length === 0 || item.targets.length > 16) {
    throw new Error('typed_blocker:component_mutation_targets_invalid')
  }
  const targets = item.targets.map(target).sort((left, right) => left.component_id.localeCompare(right.component_id)
    || left.surface_id.localeCompare(right.surface_id))
  unique(targets.map(entry => `${entry.component_id}:${entry.surface_id}`), 'component_mutation_targets_duplicate')
  for (const entry of targets) {
    if (!allowedPlanes(entry.surface_id).includes(selectedPlane)) {
      throw new Error('typed_blocker:model_weights_future_joint_plane_required')
    }
  }
  const joint = optionalDigest(item.joint_delta_declaration_sha256, 'component_joint_delta_declaration_invalid')
  if ((targets.length === 1 && joint !== null) || (targets.length > 1 && joint === null)) {
    throw new Error('typed_blocker:component_joint_delta_declaration_invalid')
  }
  const body = {
    schema: 'mykrobial.harness.component-mutation-proposal.v1' as const,
    proposal_id: identifier(item.proposal_id, 'component_mutation_proposal_identity_invalid'),
    plane: selectedPlane,
    task_capsule_id: identifier(item.task_capsule_id, 'component_mutation_task_identity_invalid'),
    loadout_id: identifier(item.loadout_id, 'component_mutation_loadout_identity_invalid'),
    source: sourceIdentity(item.source),
    context_pack_sha256: digest(item.context_pack_sha256, 'component_mutation_context_pack_invalid'),
    optimizer_input_sha256: digest(item.optimizer_input_sha256, 'component_mutation_optimizer_input_invalid'),
    targets,
    joint_delta_declaration_sha256: joint,
    created_at: timestamp(item.created_at, 'component_mutation_timestamp_invalid'),
    harness_generation: 'next_deepseek_cordis' as const,
    delta_mode: targets.length === 1 ? 'single_component' as const : 'declared_joint' as const,
    target_set_sha256: canonicalSha256(targets),
    mutation_surface_registry_sha256: buildMutationSurfaceRegistry().registry_sha256,
    status: 'proposal_only_untrusted' as const,
    apply_authorized: false as const,
    training_authorized: false as const,
    promotion_authorized: false as const,
    non_claims: [
      'not_optimizer_execution',
      'not_evaluation',
      'not_training',
      'not_component_application',
      'not_promotion',
      'not_trace_append',
      'not_deployment',
    ],
  }
  return validateProposal({ ...body, proposal_sha256: canonicalSha256(body) })
}

function taskBinding(value: unknown): ExperimentTaskBinding {
  const item = record(value, [
    'task_capsule_id', 'task_capsule_sha256', 'task_population_sha256', 'loadout_id',
    'loadout_manifest_sha256', 'seed', 'task_order_sha256',
  ], 'component_experiment_task_binding_invalid')
  return {
    task_capsule_id: identifier(item.task_capsule_id, 'component_experiment_task_binding_invalid'),
    task_capsule_sha256: digest(item.task_capsule_sha256, 'component_experiment_task_binding_invalid'),
    task_population_sha256: digest(item.task_population_sha256, 'component_experiment_task_binding_invalid'),
    loadout_id: identifier(item.loadout_id, 'component_experiment_task_binding_invalid'),
    loadout_manifest_sha256: digest(item.loadout_manifest_sha256, 'component_experiment_task_binding_invalid'),
    seed: safeInteger(item.seed, 'component_experiment_task_binding_invalid'),
    task_order_sha256: digest(item.task_order_sha256, 'component_experiment_task_binding_invalid'),
  }
}

function evaluatorBinding(value: unknown): ExperimentEvaluatorBinding {
  const item = record(value, [
    'evaluator_id', 'evaluator_sha256', 'evaluator_source_sha256', 'candidate_visible', 'frozen',
  ], 'component_experiment_evaluator_binding_invalid')
  if (item.candidate_visible !== false || item.frozen !== true) {
    throw new Error('typed_blocker:component_experiment_evaluator_binding_invalid')
  }
  return {
    evaluator_id: identifier(item.evaluator_id, 'component_experiment_evaluator_binding_invalid'),
    evaluator_sha256: digest(item.evaluator_sha256, 'component_experiment_evaluator_binding_invalid'),
    evaluator_source_sha256: digest(item.evaluator_source_sha256, 'component_experiment_evaluator_binding_invalid'),
    candidate_visible: false,
    frozen: true,
  }
}

function budgetBinding(value: unknown): ExperimentBudgetBinding {
  const item = record(value, [
    'max_input_tokens', 'max_output_tokens', 'max_wall_ms', 'max_monetary_microusd', 'max_actions',
  ], 'component_experiment_budget_binding_invalid')
  const output = {
    max_input_tokens: safeInteger(item.max_input_tokens, 'component_experiment_budget_binding_invalid'),
    max_output_tokens: safeInteger(item.max_output_tokens, 'component_experiment_budget_binding_invalid'),
    max_wall_ms: safeInteger(item.max_wall_ms, 'component_experiment_budget_binding_invalid'),
    max_monetary_microusd: safeInteger(item.max_monetary_microusd, 'component_experiment_budget_binding_invalid'),
    max_actions: safeInteger(item.max_actions, 'component_experiment_budget_binding_invalid'),
  }
  if (Object.values(output).every(number => number === 0)) {
    throw new Error('typed_blocker:component_experiment_budget_binding_invalid')
  }
  return output
}

function sourceBinding(value: unknown): ExperimentSourceBinding {
  const item = record(value, [
    'harness_source', 'component_lifecycle_contract_sha256', 'loadout_contract_sha256',
    'trajectory_contract_sha256', 'trace_bridge_source_sha256', 'mutation_surface_registry_sha256',
  ], 'component_experiment_source_binding_invalid')
  const registry = digest(item.mutation_surface_registry_sha256, 'component_experiment_source_binding_invalid')
  if (registry !== buildMutationSurfaceRegistry().registry_sha256) {
    throw new Error('typed_blocker:component_experiment_surface_registry_mismatch')
  }
  return {
    harness_source: sourceIdentity(item.harness_source),
    component_lifecycle_contract_sha256: digest(item.component_lifecycle_contract_sha256, 'component_experiment_source_binding_invalid'),
    loadout_contract_sha256: digest(item.loadout_contract_sha256, 'component_experiment_source_binding_invalid'),
    trajectory_contract_sha256: digest(item.trajectory_contract_sha256, 'component_experiment_source_binding_invalid'),
    trace_bridge_source_sha256: digest(item.trace_bridge_source_sha256, 'component_experiment_source_binding_invalid'),
    mutation_surface_registry_sha256: registry,
  }
}

function experimentArm(value: unknown): ComponentExperimentArm {
  const item = record(value, [
    'arm_id', 'role', 'control_strategy', 'loadout_manifest_sha256',
    'component_set_sha256', 'applied_delta_sha256',
  ], 'component_experiment_arm_invalid')
  if (!['BASE', 'TRUE', 'SHAM'].includes(String(item.role))
    || !['unchanged_baseline', 'candidate_delta', 'placebo_delta'].includes(String(item.control_strategy))) {
    throw new Error('typed_blocker:component_experiment_arm_invalid')
  }
  return {
    arm_id: identifier(item.arm_id, 'component_experiment_arm_invalid'),
    role: item.role as ComponentExperimentArm['role'],
    control_strategy: item.control_strategy as ComponentExperimentArm['control_strategy'],
    loadout_manifest_sha256: digest(item.loadout_manifest_sha256, 'component_experiment_arm_invalid'),
    component_set_sha256: digest(item.component_set_sha256, 'component_experiment_arm_invalid'),
    applied_delta_sha256: digest(item.applied_delta_sha256, 'component_experiment_arm_invalid'),
  }
}

function validateCapsule(value: ComponentExperimentCapsule): ComponentExperimentCapsule {
  record(value, [
    'schema', 'capsule_id', 'experiment_id', 'proposal_id', 'proposal_sha256', 'plane',
    'delta_mode', 'target_component_ids', 'target_surface_ids', 'target_set_sha256',
    'task_binding', 'evaluator_binding', 'budget_binding', 'source_binding', 'arms', 'created_at',
    'status', 'evaluation_authorized', 'training_authorized', 'promotion_authorized',
    'non_claims', 'capsule_sha256',
  ], 'component_experiment_capsule_closed_object_invalid')
  identifier(value.capsule_id, 'component_experiment_capsule_identity_invalid')
  identifier(value.experiment_id, 'component_experiment_identity_invalid')
  identifier(value.proposal_id, 'component_experiment_proposal_identity_invalid')
  digest(value.proposal_sha256, 'component_experiment_proposal_digest_invalid')
  plane(value.plane)
  if (!['single_component', 'declared_joint'].includes(value.delta_mode)) {
    throw new Error('typed_blocker:component_experiment_delta_mode_invalid')
  }
  if (!Array.isArray(value.target_component_ids) || value.target_component_ids.length === 0
    || value.target_component_ids.length > 16 || value.target_component_ids.some(item => !IDENTIFIER.test(item))
    || new Set(value.target_component_ids).size !== value.target_component_ids.length
    || !Array.isArray(value.target_surface_ids) || value.target_surface_ids.length === 0
    || value.target_surface_ids.length > 16 || value.target_surface_ids.some(item => !SURFACES.has(item))
    || new Set(value.target_surface_ids).size !== value.target_surface_ids.length) {
    throw new Error('typed_blocker:component_experiment_targets_invalid')
  }
  if (value.target_component_ids.join('\u0000') !== [...value.target_component_ids].sort().join('\u0000')
    || value.target_surface_ids.join('\u0000') !== [...value.target_surface_ids].sort().join('\u0000')) {
    throw new Error('typed_blocker:component_experiment_target_order_invalid')
  }
  digest(value.target_set_sha256, 'component_experiment_target_set_invalid')
  taskBinding(value.task_binding)
  evaluatorBinding(value.evaluator_binding)
  budgetBinding(value.budget_binding)
  sourceBinding(value.source_binding)
  if (!Array.isArray(value.arms) || value.arms.length !== 3) {
    throw new Error('typed_blocker:component_experiment_arms_incomplete')
  }
  const checkedArms = value.arms.map(experimentArm)
  if (checkedArms.map(arm => arm.role).join(',') !== 'BASE,TRUE,SHAM'
    || checkedArms[0]?.control_strategy !== 'unchanged_baseline'
    || checkedArms[1]?.control_strategy !== 'candidate_delta'
    || checkedArms[2]?.control_strategy !== 'placebo_delta'
    || checkedArms[1]?.applied_delta_sha256 !== value.target_set_sha256
    || new Set(checkedArms.map(arm => arm.arm_id)).size !== 3
    || new Set(checkedArms.map(arm => arm.component_set_sha256)).size !== 3
    || new Set(checkedArms.map(arm => arm.applied_delta_sha256)).size !== 3) {
    throw new Error('typed_blocker:component_experiment_controls_not_distinct')
  }
  timestamp(value.created_at, 'component_experiment_timestamp_invalid')
  stringList(value.non_claims, 'component_experiment_non_claims_invalid')
  const expected = canonicalSha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'capsule_sha256')))
  if (value.schema !== 'mykrobial.harness.component-experiment-capsule.v1'
    || value.status !== 'prepared_unexecuted' || value.evaluation_authorized !== false
    || value.training_authorized !== false || value.promotion_authorized !== false
    || value.capsule_sha256 !== expected) {
    throw new Error('typed_blocker:component_experiment_capsule_invalid')
  }
  return value
}

/**
 * Freeze a matched BASE/TRUE/SHAM capsule without running the experiment.
 * @param input - Proposal plus immutable task, source, evaluator, budget, and arm facts.
 * @returns A content-addressed prepared-but-unexecuted capsule.
 */
export function prepareComponentExperimentCapsule(input: PrepareExperimentCapsuleInput): ComponentExperimentCapsule {
  const item = record(input, [
    'capsule_id', 'experiment_id', 'proposal', 'task_binding', 'evaluator_binding',
    'budget_binding', 'source_binding', 'arms', 'created_at',
  ], 'component_experiment_capsule_input_invalid')
  const proposal = structuredClone(validateProposal(item.proposal as ComponentMutationProposal))
  const task = taskBinding(item.task_binding)
  if (task.task_capsule_id !== proposal.task_capsule_id || task.loadout_id !== proposal.loadout_id) {
    throw new Error('typed_blocker:component_experiment_task_or_loadout_mismatch')
  }
  if (!Array.isArray(item.arms) || item.arms.length !== 3) {
    throw new Error('typed_blocker:component_experiment_arms_incomplete')
  }
  const order: Record<ComponentExperimentArm['role'], number> = { BASE: 0, TRUE: 1, SHAM: 2 }
  const arms = item.arms.map(experimentArm).sort((left, right) => order[left.role] - order[right.role])
  if (arms.map(arm => arm.role).join(',') !== 'BASE,TRUE,SHAM'
    || arms[0]?.control_strategy !== 'unchanged_baseline'
    || arms[1]?.control_strategy !== 'candidate_delta'
    || arms[2]?.control_strategy !== 'placebo_delta'
    || arms[1]?.applied_delta_sha256 !== proposal.target_set_sha256
    || new Set(arms.map(arm => arm.arm_id)).size !== 3
    || new Set(arms.map(arm => arm.component_set_sha256)).size !== 3
    || new Set(arms.map(arm => arm.applied_delta_sha256)).size !== 3
    || arms.some(arm => arm.loadout_manifest_sha256 !== task.loadout_manifest_sha256)) {
    throw new Error('typed_blocker:component_experiment_controls_not_distinct')
  }
  const body = {
    schema: 'mykrobial.harness.component-experiment-capsule.v1' as const,
    capsule_id: identifier(item.capsule_id, 'component_experiment_capsule_identity_invalid'),
    experiment_id: identifier(item.experiment_id, 'component_experiment_identity_invalid'),
    proposal_id: proposal.proposal_id,
    proposal_sha256: proposal.proposal_sha256,
    plane: proposal.plane,
    delta_mode: proposal.delta_mode,
    target_component_ids: [...new Set(proposal.targets.map(entry => entry.component_id))].sort(),
    target_surface_ids: [...new Set(proposal.targets.map(entry => entry.surface_id))].sort(),
    target_set_sha256: proposal.target_set_sha256,
    task_binding: task,
    evaluator_binding: evaluatorBinding(item.evaluator_binding),
    budget_binding: budgetBinding(item.budget_binding),
    source_binding: sourceBinding(item.source_binding),
    arms,
    created_at: timestamp(item.created_at, 'component_experiment_timestamp_invalid'),
    status: 'prepared_unexecuted' as const,
    evaluation_authorized: false as const,
    training_authorized: false as const,
    promotion_authorized: false as const,
    non_claims: [
      'not_evaluator_execution',
      'not_optimizer_execution',
      'not_training',
      'not_component_application',
      'not_promotion',
      'not_trace_append',
      'not_deployment',
    ],
  }
  return validateCapsule({ ...body, capsule_sha256: canonicalSha256(body) })
}

/**
 * Normalize an externally issued optimizer or promotion decision as untrusted input.
 * @param input - Issuer-supplied recommendation and optional receipt references.
 * @param capsule - Exact capsule the recommendation addresses.
 * @returns An untrusted envelope with authority and application false.
 */
export function acceptExternalComponentDecision(
  input: ExternalComponentDecisionInput,
  capsule: ComponentExperimentCapsule,
): ExternalComponentDecision {
  const item = record(input, [
    'decision_id', 'capsule_id', 'decision_kind', 'disposition', 'issuer_id',
    'issuer_artifact_sha256', 'decision_payload_sha256', 'authority_receipt_sha256',
    'training_gate_receipt_sha256', 'issued_at',
  ], 'external_component_decision_input_invalid')
  const frozenCapsule = structuredClone(validateCapsule(capsule))
  const capsuleId = identifier(item.capsule_id, 'external_component_decision_capsule_invalid')
  if (capsuleId !== frozenCapsule.capsule_id
    || !['optimizer_recommendation', 'promotion_recommendation', 'rollback_recommendation'].includes(String(item.decision_kind))
    || !['accept_candidate', 'reject_candidate', 'revise_candidate', 'no_change', 'rollback'].includes(String(item.disposition))) {
    throw new Error('typed_blocker:external_component_decision_invalid')
  }
  const blockers = ['typed_blocker:external_decision_authority_unverified']
  if (frozenCapsule.target_surface_ids.includes('model_weights')) {
    blockers.push('typed_blocker:model_weights_training_gate_unverified')
  }
  const body = {
    schema: 'mykrobial.harness.external-component-decision.v1' as const,
    decision_id: identifier(item.decision_id, 'external_component_decision_identity_invalid'),
    capsule_id: capsuleId,
    decision_kind: item.decision_kind as ExternalComponentDecision['decision_kind'],
    disposition: item.disposition as ExternalComponentDecision['disposition'],
    issuer_id: identifier(item.issuer_id, 'external_component_decision_issuer_invalid'),
    issuer_artifact_sha256: digest(item.issuer_artifact_sha256, 'external_component_decision_issuer_invalid'),
    decision_payload_sha256: digest(item.decision_payload_sha256, 'external_component_decision_payload_invalid'),
    authority_receipt_sha256: optionalDigest(item.authority_receipt_sha256, 'external_component_decision_authority_receipt_invalid'),
    training_gate_receipt_sha256: optionalDigest(item.training_gate_receipt_sha256, 'external_component_decision_training_receipt_invalid'),
    issued_at: timestamp(item.issued_at, 'external_component_decision_timestamp_invalid'),
    trust_state: 'untrusted_external_input' as const,
    authority_verified: false as const,
    training_gate_verified: false as const,
    apply_authorized: false as const,
    promotion_authorized: false as const,
    blockers,
    non_claims: [
      'not_optimizer_execution',
      'not_independent_evaluation',
      'not_authority_verification',
      'not_training_gate_verification',
      'not_component_application',
      'not_promotion',
      'not_deployment',
    ],
  }
  return { ...body, external_input_sha256: canonicalSha256(body) }
}

function validateExternalDecision(value: ExternalComponentDecision): ExternalComponentDecision {
  record(value, [
    'schema', 'decision_id', 'capsule_id', 'decision_kind', 'disposition', 'issuer_id',
    'issuer_artifact_sha256', 'decision_payload_sha256', 'authority_receipt_sha256',
    'training_gate_receipt_sha256', 'issued_at', 'trust_state', 'authority_verified',
    'training_gate_verified', 'apply_authorized', 'promotion_authorized', 'blockers',
    'non_claims', 'external_input_sha256',
  ], 'external_component_decision_closed_object_invalid')
  identifier(value.decision_id, 'external_component_decision_identity_invalid')
  identifier(value.capsule_id, 'external_component_decision_capsule_invalid')
  identifier(value.issuer_id, 'external_component_decision_issuer_invalid')
  digest(value.issuer_artifact_sha256, 'external_component_decision_issuer_invalid')
  digest(value.decision_payload_sha256, 'external_component_decision_payload_invalid')
  optionalDigest(value.authority_receipt_sha256, 'external_component_decision_authority_receipt_invalid')
  optionalDigest(value.training_gate_receipt_sha256, 'external_component_decision_training_receipt_invalid')
  timestamp(value.issued_at, 'external_component_decision_timestamp_invalid')
  const blockers = stringList(value.blockers, 'external_component_decision_blockers_invalid')
  if (blockers.length === 0 || blockers.some(blocker => !blocker.startsWith('typed_blocker:'))
    || new Set(blockers).size !== blockers.length) {
    throw new Error('typed_blocker:external_component_decision_blockers_invalid')
  }
  stringList(value.non_claims, 'external_component_decision_non_claims_invalid')
  const expected = canonicalSha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'external_input_sha256')))
  if (value.schema !== 'mykrobial.harness.external-component-decision.v1'
    || !['optimizer_recommendation', 'promotion_recommendation', 'rollback_recommendation'].includes(value.decision_kind)
    || !['accept_candidate', 'reject_candidate', 'revise_candidate', 'no_change', 'rollback'].includes(value.disposition)
    || value.trust_state !== 'untrusted_external_input' || value.authority_verified !== false
    || value.training_gate_verified !== false || value.apply_authorized !== false
    || value.promotion_authorized !== false || value.external_input_sha256 !== expected) {
    throw new Error('typed_blocker:external_component_decision_invalid')
  }
  return value
}

function operationSteps(operation: ComponentPlanOperation): string[] {
  if (operation === 'swap') return [
    'verify_component_snapshot',
    'verify_loadout_manifest',
    'verify_external_authority',
    'deactivate_current_component_generation',
    'activate_candidate_component_generation',
    'readback_component_and_loadout_identity',
    'rollback_on_identity_or_health_mismatch',
  ]
  if (operation === 'rollback') return [
    'verify_component_snapshot',
    'verify_rollback_receipt',
    'verify_external_authority',
    'deactivate_candidate_component_generation',
    'restore_parent_component_generation',
    'readback_parent_component_and_loadout_identity',
  ]
  return [
    'verify_component_snapshot',
    'verify_replay_receipt',
    'verify_external_authority',
    'reconstruct_bound_loadout_without_activation',
    'replay_bound_event_order',
    'compare_replay_projection',
  ]
}

/**
 * Prepare a no-apply CORDIS lifecycle/loadout swap, rollback, or replay plan.
 * @param input - Exact capsule, untrusted decision, lifecycle, loadout, and receipt facts.
 * @returns A deterministic plan whose application and Trace authorities remain false.
 */
export function prepareComponentReconfigurationPlan(input: PrepareComponentPlanInput): ComponentReconfigurationPlan {
  const item = record(input, [
    'operation', 'capsule', 'decision', 'current_component_snapshot_sha256',
    'current_loadout_manifest_sha256', 'dependency_closure_sha256',
    'replay_receipt_sha256', 'rollback_receipt_sha256', 'requested_at',
  ], 'component_reconfiguration_plan_input_invalid')
  if (!['swap', 'rollback', 'replay'].includes(String(item.operation))) {
    throw new Error('typed_blocker:component_reconfiguration_operation_invalid')
  }
  const operation = item.operation as ComponentPlanOperation
  const capsule = structuredClone(validateCapsule(item.capsule as ComponentExperimentCapsule))
  const decision = structuredClone(validateExternalDecision(item.decision as ExternalComponentDecision))
  if (decision.capsule_id !== capsule.capsule_id) {
    throw new Error('typed_blocker:component_reconfiguration_decision_invalid')
  }
  const currentLoadout = digest(item.current_loadout_manifest_sha256, 'component_reconfiguration_loadout_invalid')
  if (currentLoadout !== capsule.task_binding.loadout_manifest_sha256) {
    throw new Error('typed_blocker:component_reconfiguration_loadout_mismatch')
  }
  const replayReceipt = optionalDigest(item.replay_receipt_sha256, 'component_reconfiguration_replay_receipt_invalid')
  const rollbackReceipt = optionalDigest(item.rollback_receipt_sha256, 'component_reconfiguration_rollback_receipt_invalid')
  const blockers = [...decision.blockers]
  if (operation === 'rollback' && rollbackReceipt === null) blockers.push('typed_blocker:rollback_receipt_missing')
  if (operation === 'replay' && replayReceipt === null) blockers.push('typed_blocker:replay_receipt_missing')
  if (operation === 'swap' && decision.disposition !== 'accept_candidate') {
    blockers.push('typed_blocker:decision_disposition_incompatible_with_swap')
  }
  if (operation === 'rollback' && decision.disposition !== 'rollback') {
    blockers.push('typed_blocker:decision_disposition_incompatible_with_rollback')
  }
  const body = {
    schema: 'mykrobial.harness.component-reconfiguration-plan.v1' as const,
    plan_id: `component-${operation}-${canonicalSha256({ capsule: capsule.capsule_sha256, decision: decision.external_input_sha256 }).slice(0, 24)}`,
    operation,
    capsule_id: capsule.capsule_id,
    decision_id: decision.decision_id,
    target_component_ids: [...capsule.target_component_ids],
    target_surface_ids: [...capsule.target_surface_ids],
    component_lifecycle_contract: 'mykrobial.component-snapshot.v1' as const,
    loadout_contract: 'mykrobial.harness.loadout-manifest.v1' as const,
    component_lifecycle_contract_sha256: capsule.source_binding.component_lifecycle_contract_sha256,
    loadout_contract_sha256: capsule.source_binding.loadout_contract_sha256,
    current_component_snapshot_sha256: digest(item.current_component_snapshot_sha256, 'component_reconfiguration_snapshot_invalid'),
    current_loadout_manifest_sha256: currentLoadout,
    dependency_closure_sha256: digest(item.dependency_closure_sha256, 'component_reconfiguration_dependency_closure_invalid'),
    replay_receipt_sha256: replayReceipt,
    rollback_receipt_sha256: rollbackReceipt,
    steps: operationSteps(operation),
    blockers: [...new Set(blockers)].sort(),
    requested_at: timestamp(item.requested_at, 'component_reconfiguration_timestamp_invalid'),
    state: 'prepared_unexecuted' as const,
    apply_authorized: false as const,
    trace_append_authorized: false as const,
    non_claims: [
      'not_component_activation',
      'not_component_deactivation',
      'not_replay_execution',
      'not_rollback_execution',
      'not_authority_verification',
      'not_trace_append',
      'not_deployment',
    ],
  }
  return { ...body, plan_sha256: canonicalSha256(body) }
}

function artifactRef(value: unknown): ArtifactRef {
  const item = record(value, ['ref', 'sha256', 'bytes', 'media_type', 'storage_class'], 'component_experiment_artifact_ref_invalid')
  if (typeof item.ref !== 'string' || item.ref.length === 0 || item.ref.length > 2048
    || typeof item.media_type !== 'string' || item.media_type.length === 0 || item.media_type.length > 128
    || !['public', 'restricted', 'provider_opaque', 'external'].includes(String(item.storage_class))) {
    throw new Error('typed_blocker:component_experiment_artifact_ref_invalid')
  }
  return {
    ref: item.ref,
    sha256: digest(item.sha256, 'component_experiment_artifact_ref_invalid'),
    bytes: safeInteger(item.bytes, 'component_experiment_artifact_ref_invalid'),
    media_type: item.media_type,
    storage_class: item.storage_class as ArtifactRef['storage_class'],
  }
}

const PHASE_KIND: Record<ComponentExperimentPhase, ProjectedTrajectoryEvent['kind']> = {
  proposal_prepared: 'hypothesis',
  capsule_prepared: 'experiment',
  evaluation_requested: 'experiment',
  external_decision_received: 'model_revision',
  swap_planned: 'plan',
  rollback_planned: 'checkpoint',
  replay_planned: 'checkpoint',
  mismatch_observed: 'mismatch',
  no_change_selected: 'result',
}

/**
 * Project one component-experiment phase into public trajectory and Trace v2.3 intents.
 * @param input - Frozen capsule, event position, time, branch, and payload reference.
 * @returns Paired append-unadmitted trajectory and Trace metadata.
 */
export function projectComponentExperimentLifecycle(
  input: ProjectExperimentLifecycleInput,
): ComponentExperimentProjection {
  const item = record(input, [
    'phase', 'capsule', 'event_id', 'run_id', 'trace_id', 'session_id', 'sequence',
    'previous_event_sha256', 'occurred_at', 'branch_id', 'component_generation', 'payload_ref',
  ], 'component_experiment_projection_input_invalid')
  if (typeof item.phase !== 'string' || !(item.phase in PHASE_KIND)) {
    throw new Error('typed_blocker:component_experiment_phase_invalid')
  }
  const phase = item.phase as ComponentExperimentPhase
  const capsule = structuredClone(validateCapsule(item.capsule as ComponentExperimentCapsule))
  const occurredAt = timestamp(item.occurred_at, 'component_experiment_projection_timestamp_invalid')
  const payload = artifactRef(item.payload_ref)
  const eventBody = {
    schema: 'mykrobial.harness.trajectory-event.v1' as const,
    event_id: identifier(item.event_id, 'component_experiment_event_identity_invalid'),
    run_id: identifier(item.run_id, 'component_experiment_run_identity_invalid'),
    task_capsule_id: capsule.task_binding.task_capsule_id,
    loadout_id: capsule.task_binding.loadout_id,
    harness_generation: 'next_deepseek_cordis' as const,
    sequence: safeInteger(item.sequence, 'component_experiment_event_sequence_invalid'),
    previous_event_sha256: digest(item.previous_event_sha256, 'component_experiment_previous_event_invalid'),
    kind: PHASE_KIND[phase],
    source_component_id: capsule.target_component_ids[0]!,
    occurred_at: occurredAt,
    temporal: {
      transaction_time: occurredAt,
      valid_from: null,
      valid_until: null,
      valid_time_basis: 'not_asserted' as const,
      supersedes_event_id: null,
      parent_event_id: null,
      branch_id: identifier(item.branch_id, 'component_experiment_branch_identity_invalid'),
      component_generation: safeInteger(item.component_generation, 'component_experiment_generation_invalid'),
      duration_ms: null,
      deadline_at: null,
      causality_state: 'not_asserted' as const,
    },
    payload_sha256: payload.sha256,
    payload_ref: payload,
    component_ids: [...capsule.target_component_ids],
    cost: {
      input_tokens: null,
      output_tokens: null,
      cached_tokens: null,
      monetary_usd: null,
      energy_wh: null,
      wall_ms: null,
      human_minutes: null,
      basis: 'unavailable' as const,
    },
    proof: {
      source: { state: 'candidate' as const, receipt_refs: [payload], blocker: null },
      execution: { state: 'blocked' as const, receipt_refs: [] as [], blocker: 'typed_blocker:component_experiment_execution_unadmitted' as const },
      review: { state: 'unavailable' as const, receipt_refs: [] as [], blocker: 'typed_blocker:component_experiment_review_unavailable' as const },
      deployment: { state: 'unavailable' as const, receipt_refs: [] as [], blocker: 'typed_blocker:component_experiment_deployment_unavailable' as const },
    },
  }
  const trajectoryEvent: ProjectedTrajectoryEvent = {
    ...eventBody,
    event_sha256: canonicalSha256(eventBody),
  }
  const traceIntent = {
    schema: 'mykrobial.deepseek.trace-v2.3-intent.v1' as const,
    target_schema: 'mykrobial.trace.v2.3.event.v1' as const,
    target_schema_version: '2.3.0' as const,
    trace_id: identifier(item.trace_id, 'component_experiment_trace_identity_invalid'),
    session_id: identifier(item.session_id, 'component_experiment_session_identity_invalid'),
    source_event_sha256: trajectoryEvent.event_sha256,
    source_event_sequence: trajectoryEvent.sequence,
    source_event_kind: trajectoryEvent.kind,
    scope: 'root_run' as const,
    phase: 'progress' as const,
    content_mode: 'metadata_only' as const,
    status: 'candidate_report_only' as const,
    blocker: 'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted' as const,
    non_claims: [
      'not_trace_append',
      'not_hidden_chain_of_thought_access',
      'not_provider_execution',
      'not_deployment',
    ],
  }
  const body = {
    schema: 'mykrobial.harness.component-experiment-projection.v1' as const,
    phase,
    capsule_id: capsule.capsule_id,
    trajectory_event: trajectoryEvent,
    trace_v2_3_intent: traceIntent,
    trajectory_append_authorized: false as const,
    trace_append_authorized: false as const,
    non_claims: [
      'not_trajectory_append',
      'not_trace_append',
      'not_optimizer_execution',
      'not_evaluation',
      'not_component_application',
      'not_deployment',
    ],
  }
  return { ...body, projection_sha256: canonicalSha256(body) }
}
