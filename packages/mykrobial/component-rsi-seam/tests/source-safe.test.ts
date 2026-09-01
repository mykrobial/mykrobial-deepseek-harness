import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  EVOLUTION_PLANES,
  MUTATION_SURFACE_IDS,
  acceptExternalComponentDecision,
  buildMutationSurfaceRegistry,
  canonicalSha256,
  prepareComponentExperimentCapsule,
  prepareComponentMutationProposal,
  prepareComponentReconfigurationPlan,
  projectComponentExperimentLifecycle,
  type ComponentExperimentCapsule,
  type ComponentMutationProposal,
  type ExternalComponentDecisionInput,
  type PrepareComponentPlanInput,
  type PrepareExperimentCapsuleInput,
  type PrepareMutationProposalInput,
  type ProjectExperimentLifecycleInput,
} from '../src/index.ts'

interface Fixture {
  schema: string
  proposal_input: PrepareMutationProposalInput
  expected_target_set_sha256: string
  capsule_fields?: Omit<PrepareExperimentCapsuleInput, 'proposal'>
  decision_input: ExternalComponentDecisionInput
  plan_fields?: Omit<PrepareComponentPlanInput, 'capsule' | 'decision'>
  projection_fields?: Omit<ProjectExperimentLifecycleInput, 'capsule'>
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

const single = json<Fixture>('./fixtures/single-prompt-experiment.v1.json')
const joint = json<Fixture>('./fixtures/joint-model-weights-experiment.v1.json')

function singleProposal(): ComponentMutationProposal {
  return prepareComponentMutationProposal(copy(single.proposal_input))
}

function singleCapsule(): ComponentExperimentCapsule {
  assert.ok(single.capsule_fields)
  return prepareComponentExperimentCapsule({
    ...copy(single.capsule_fields),
    proposal: singleProposal(),
  })
}

function jointCapsule(proposal = prepareComponentMutationProposal(copy(joint.proposal_input))): ComponentExperimentCapsule {
  assert.ok(single.capsule_fields)
  const fields = copy(single.capsule_fields)
  fields.capsule_id = 'capsule-joint-v1'
  fields.experiment_id = 'experiment-joint-v1'
  fields.task_binding.task_capsule_id = proposal.task_capsule_id
  fields.task_binding.loadout_id = proposal.loadout_id
  fields.arms[1]!.applied_delta_sha256 = proposal.target_set_sha256
  return prepareComponentExperimentCapsule({ ...fields, proposal })
}

test('registry covers every independently mutable runtime surface exactly once', () => {
  const registry = buildMutationSurfaceRegistry()
  assert.deepEqual(registry.surfaces.map(row => row.surface_id), MUTATION_SURFACE_IDS)
  assert.equal(new Set(registry.surfaces.map(row => row.surface_id)).size, 14)
  assert.equal(registry.surfaces.every(row => row.independently_versioned
    && row.independently_swappable && row.per_task_experiment_allowed
    && row.runtime_application_authority_required && row.trace_projection_required), true)
})

test('model weights are restricted to future_joint_model_harness and require a training gate', () => {
  const row = buildMutationSurfaceRegistry().surfaces.find(item => item.surface_id === 'model_weights')
  assert.deepEqual(row?.allowed_planes, ['future_joint_model_harness'])
  assert.equal(row?.training_gate_required, true)
  assert.deepEqual(EVOLUTION_PLANES, ['online_areal_actual_work', 'local_idle_compute', 'frontier_builder_critic', 'future_joint_model_harness'])
})

test('checked-in mutation registry is byte-independent and content-identical to runtime registry', () => {
  const file = json<ReturnType<typeof buildMutationSurfaceRegistry>>('../../../../contracts/mykrobial/component-mutation-surface-registry.v1.json')
  assert.deepEqual(file, buildMutationSurfaceRegistry())
  const { registry_sha256: _registrySha256, ...body } = file
  assert.equal(file.registry_sha256, canonicalSha256(body))
})

test('single-component proposal is deterministic and remains proposal-only', () => {
  const left = singleProposal()
  const right = singleProposal()
  assert.deepEqual(left, right)
  assert.equal(left.delta_mode, 'single_component')
  assert.equal(left.target_set_sha256, single.expected_target_set_sha256)
  assert.equal(left.apply_authorized, false)
  assert.equal(left.training_authorized, false)
  assert.equal(left.promotion_authorized, false)
})

test('declared joint proposal canonicalizes target order and binds both components', () => {
  const proposal = prepareComponentMutationProposal(copy(joint.proposal_input))
  assert.equal(proposal.delta_mode, 'declared_joint')
  assert.deepEqual(proposal.targets.map(target => target.component_id), ['harness-core-v2', 'model-weights-v2'])
  assert.equal(proposal.target_set_sha256, joint.expected_target_set_sha256)
})

test('model-weight proposal rejects every plane except future_joint_model_harness', () => {
  for (const invalidPlane of ['online_areal_actual_work', 'local_idle_compute', 'frontier_builder_critic'] as const) {
    const input = copy(joint.proposal_input)
    input.plane = invalidPlane
    assert.throws(
      () => prepareComponentMutationProposal(input),
      /typed_blocker:model_weights_future_joint_plane_required/,
    )
  }
})

test('single and joint deltas require exact declaration cardinality', () => {
  const singleInput = copy(single.proposal_input)
  singleInput.joint_delta_declaration_sha256 = '1'.repeat(64)
  assert.throws(
    () => prepareComponentMutationProposal(singleInput),
    /typed_blocker:component_joint_delta_declaration_invalid/,
  )
  const jointInput = copy(joint.proposal_input)
  jointInput.joint_delta_declaration_sha256 = null
  assert.throws(
    () => prepareComponentMutationProposal(jointInput),
    /typed_blocker:component_joint_delta_declaration_invalid/,
  )
})

test('experiment capsule freezes distinct BASE TRUE SHAM arms and immutable bindings', () => {
  const capsule = singleCapsule()
  assert.deepEqual(capsule.arms.map(arm => arm.role), ['BASE', 'TRUE', 'SHAM'])
  assert.equal(new Set(capsule.arms.map(arm => arm.component_set_sha256)).size, 3)
  assert.equal(new Set(capsule.arms.map(arm => arm.applied_delta_sha256)).size, 3)
  assert.equal(capsule.arms[1]?.applied_delta_sha256, capsule.target_set_sha256)
  assert.equal(capsule.evaluator_binding.candidate_visible, false)
  assert.equal(capsule.evaluator_binding.frozen, true)
  assert.equal(capsule.evaluation_authorized, false)
})

test('capsule rejects duplicate controls and candidate-visible evaluators', () => {
  assert.ok(single.capsule_fields)
  const duplicate = copy(single.capsule_fields)
  duplicate.arms[2]!.component_set_sha256 = duplicate.arms[0]!.component_set_sha256
  assert.throws(
    () => prepareComponentExperimentCapsule({ ...duplicate, proposal: singleProposal() }),
    /typed_blocker:component_experiment_controls_not_distinct/,
  )
  const visible = copy(single.capsule_fields) as unknown as Record<string, unknown>
  ;(visible.evaluator_binding as Record<string, unknown>).candidate_visible = true
  assert.throws(
    () => prepareComponentExperimentCapsule({ ...visible, proposal: singleProposal() } as unknown as PrepareExperimentCapsuleInput),
    /typed_blocker:component_experiment_evaluator_binding_invalid/,
  )
})

test('capsule rejects non-finite or wholly zero experiment budgets', () => {
  assert.ok(single.capsule_fields)
  const nonFinite = copy(single.capsule_fields) as unknown as Record<string, unknown>
  ;(nonFinite.budget_binding as Record<string, unknown>).max_wall_ms = 10 ** 400
  assert.throws(
    () => prepareComponentExperimentCapsule({ ...nonFinite, proposal: singleProposal() } as unknown as PrepareExperimentCapsuleInput),
    /typed_blocker:component_experiment_budget_binding_invalid/,
  )
  const zero = copy(single.capsule_fields)
  for (const key of Object.keys(zero.budget_binding) as Array<keyof typeof zero.budget_binding>) {
    zero.budget_binding[key] = 0
  }
  assert.throws(
    () => prepareComponentExperimentCapsule({ ...zero, proposal: singleProposal() }),
    /typed_blocker:component_experiment_budget_binding_invalid/,
  )
})

test('external optimizer input remains untrusted even when it names an authority receipt', () => {
  const decision = acceptExternalComponentDecision(copy(single.decision_input), singleCapsule())
  assert.equal(decision.authority_receipt_sha256, single.decision_input.authority_receipt_sha256)
  assert.equal(decision.authority_verified, false)
  assert.equal(decision.apply_authorized, false)
  assert.equal(decision.promotion_authorized, false)
  assert.ok(decision.blockers.includes('typed_blocker:external_decision_authority_unverified'))
})

test('model-weight decision retains separate training blocker even with a named receipt', () => {
  const capsule = jointCapsule()
  const decision = acceptExternalComponentDecision(copy(joint.decision_input), capsule)
  assert.equal(decision.training_gate_receipt_sha256, joint.decision_input.training_gate_receipt_sha256)
  assert.equal(decision.training_gate_verified, false)
  assert.ok(decision.blockers.includes('typed_blocker:model_weights_training_gate_unverified'))
})

test('swap plan binds lifecycle and loadout contracts but never applies', () => {
  assert.ok(single.plan_fields)
  const capsule = singleCapsule()
  const decision = acceptExternalComponentDecision(copy(single.decision_input), capsule)
  const plan = prepareComponentReconfigurationPlan({ ...copy(single.plan_fields), capsule, decision })
  assert.equal(plan.component_lifecycle_contract, 'mykrobial.component-snapshot.v1')
  assert.equal(plan.loadout_contract, 'mykrobial.harness.loadout-manifest.v1')
  assert.equal(plan.apply_authorized, false)
  assert.equal(plan.trace_append_authorized, false)
  assert.ok(plan.steps.includes('rollback_on_identity_or_health_mismatch'))
  assert.ok(plan.blockers.includes('typed_blocker:external_decision_authority_unverified'))
})

test('rollback and replay plans fail closed without their exact receipts', () => {
  assert.ok(single.plan_fields)
  const capsule = singleCapsule()
  const rollbackInput = copy(single.decision_input)
  rollbackInput.decision_kind = 'rollback_recommendation'
  rollbackInput.disposition = 'rollback'
  const rollbackDecision = acceptExternalComponentDecision(rollbackInput, capsule)
  const rollback = prepareComponentReconfigurationPlan({
    ...copy(single.plan_fields), operation: 'rollback', capsule, decision: rollbackDecision,
  })
  assert.ok(rollback.blockers.includes('typed_blocker:rollback_receipt_missing'))
  const replay = prepareComponentReconfigurationPlan({
    ...copy(single.plan_fields), operation: 'replay', capsule, decision: rollbackDecision,
  })
  assert.ok(replay.blockers.includes('typed_blocker:replay_receipt_missing'))
})

test('all component phases map deterministically into the existing trajectory vocabulary', () => {
  assert.ok(single.projection_fields)
  const capsule = singleCapsule()
  const expected = {
    proposal_prepared: 'hypothesis',
    capsule_prepared: 'experiment',
    evaluation_requested: 'experiment',
    external_decision_received: 'model_revision',
    swap_planned: 'plan',
    rollback_planned: 'checkpoint',
    replay_planned: 'checkpoint',
    mismatch_observed: 'mismatch',
    no_change_selected: 'result',
  } as const
  for (const [phase, kind] of Object.entries(expected)) {
    const projection = projectComponentExperimentLifecycle({
      ...copy(single.projection_fields),
      phase: phase as keyof typeof expected,
      event_id: `event-${phase}`,
      capsule,
    })
    assert.equal(projection.trajectory_event.kind, kind)
    assert.equal(projection.trajectory_append_authorized, false)
    assert.equal(projection.trace_append_authorized, false)
  }
})

test('Trace intent binds the exact trajectory event and stays metadata-only', () => {
  assert.ok(single.projection_fields)
  const projection = projectComponentExperimentLifecycle({
    ...copy(single.projection_fields), capsule: singleCapsule(),
  })
  const { event_sha256: _eventSha256, ...eventBody } = projection.trajectory_event
  assert.equal(projection.trajectory_event.event_sha256, canonicalSha256(eventBody))
  assert.equal(projection.trace_v2_3_intent.source_event_sha256, projection.trajectory_event.event_sha256)
  assert.equal(projection.trace_v2_3_intent.source_event_sequence, projection.trajectory_event.sequence)
  assert.equal(projection.trace_v2_3_intent.content_mode, 'metadata_only')
  assert.equal(projection.trace_v2_3_intent.status, 'candidate_report_only')
  assert.match(projection.trace_v2_3_intent.blocker, /^typed_blocker:/)
})

test('strict UTC calendar validation rejects normalized impossible dates', () => {
  const input = copy(single.proposal_input)
  input.created_at = '2026-02-31T00:00:00Z'
  assert.throws(
    () => prepareComponentMutationProposal(input),
    /typed_blocker:component_mutation_timestamp_invalid/,
  )
  input.created_at = '2024-02-29T00:00:00.123456Z'
  assert.doesNotThrow(() => prepareComponentMutationProposal(input))
})

test('constructors reject extra root and nested properties', () => {
  const root = { ...copy(single.proposal_input), extra: true }
  assert.throws(
    () => prepareComponentMutationProposal(root as unknown as PrepareMutationProposalInput),
    /typed_blocker:component_mutation_proposal_input_invalid/,
  )
  const nested = copy(single.proposal_input) as unknown as Record<string, unknown>
  const source = nested.source as Record<string, unknown>
  source.extra = true
  assert.throws(
    () => prepareComponentMutationProposal(nested as unknown as PrepareMutationProposalInput),
    /typed_blocker:component_rsi_source_identity_invalid/,
  )
})

test('public JSON schemas are strict JSON and close every owned object', () => {
  const central = json<{ $defs: Record<string, Record<string, unknown>> }>('../../../../contracts/mykrobial/component-rsi-seam.v1.schema.json')
  const closed = [
    'sourceIdentity', 'mutationSurfacePolicy', 'mutationSurfaceRegistry', 'mutationTarget',
    'mutationProposal', 'taskBinding', 'evaluatorBinding', 'budgetBinding', 'sourceBinding',
    'experimentArm', 'experimentCapsule', 'externalDecision', 'reconfigurationPlan',
    'traceIntent', 'experimentProjection',
  ]
  for (const key of closed) assert.equal(central.$defs[key]?.additionalProperties, false, key)

  const wrappers = [
    'component-mutation-surface-registry.v1.schema.json',
    'component-mutation-proposal.v1.schema.json',
    'component-experiment-capsule.v1.schema.json',
    'external-component-decision.v1.schema.json',
    'component-reconfiguration-plan.v1.schema.json',
    'component-experiment-projection.v1.schema.json',
  ]
  for (const file of wrappers) {
    const wrapper = json<{ $ref: string }>(`../../../../contracts/mykrobial/${file}`)
    assert.match(wrapper.$ref, /^\.\/component-rsi-seam\.v1\.schema\.json#\/\$defs\//)
  }
})

test('runtime source contains no Exo implementation dependency', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(`${index}\n${types}`, /\bexo\b/i)
})
