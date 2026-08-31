/** Strict runtime validation for replayed and checkpointed scientific state. */
import {
  fail,
  requireIdentifier,
  requireSha256,
  requireText,
} from './canonical.ts'
import type {
  PlannedActionTransition,
  ScientificPlan,
  ScientificRunState,
  ScientificTransition,
} from './types.ts'

function object(value: unknown, blocker: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(blocker)
  return value as Record<string, unknown>
}

function exactKeys(value: unknown, expected: readonly string[], blocker: string): Record<string, unknown> {
  const record = object(value, blocker)
  const actual = Object.keys(record).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(blocker)
  return record
}

function integer(value: unknown, blocker: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(blocker)
  return value as number
}

function stringArray(value: unknown, blocker: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(blocker)
  const items = value as string[]
  if (new Set(items).size !== items.length) fail(blocker)
  return items
}

function assertTransition(transition: ScientificTransition, index: number, before: string): void {
  const common = ['transition_index', 'kind', 'before_observation_sha256', 'action_sha256', 'observed_observation_sha256']
  const extra = transition.kind === 'probe'
    ? ['purpose']
    : transition.kind === 'discriminating_probe'
      ? ['predictions', 'supported_hypothesis_ids', 'falsified_hypothesis_ids']
      : transition.kind === 'reset'
        ? ['reset_count', 'invalidated_plan_ids']
        : transition.kind === 'planned_action'
          ? ['plan_id', 'action_index', 'expected_observation_sha256', 'matched_prediction']
          : fail('typed_blocker:scientific_transition_kind_invalid')
  exactKeys(transition, [...common, ...extra], 'typed_blocker:scientific_transition_shape_invalid')
  if (transition.transition_index !== index || transition.before_observation_sha256 !== before) {
    fail('typed_blocker:scientific_timeline_discontinuous')
  }
  requireSha256(transition.action_sha256, 'typed_blocker:scientific_action_digest_invalid')
  requireSha256(transition.observed_observation_sha256, 'typed_blocker:scientific_observation_digest_invalid')
  if (transition.kind === 'probe') {
    if (requireText(transition.purpose, 'typed_blocker:scientific_probe_purpose_invalid', 1024) !== transition.purpose) {
      fail('typed_blocker:scientific_probe_purpose_invalid')
    }
  } else if (transition.kind === 'discriminating_probe') {
    const predictions = object(transition.predictions, 'typed_blocker:scientific_probe_predictions_invalid')
    const ids = Object.keys(predictions)
    if (ids.length < 2 || ids.length > 1024) fail('typed_blocker:scientific_probe_predictions_invalid')
    for (const [id, predicted] of Object.entries(predictions)) {
      requireIdentifier(id, 'typed_blocker:scientific_probe_predictions_invalid')
      requireSha256(predicted, 'typed_blocker:scientific_probe_predictions_invalid')
    }
    if (new Set(Object.values(predictions)).size < 2) fail('typed_blocker:scientific_probe_not_discriminating')
    const supported = stringArray(transition.supported_hypothesis_ids, 'typed_blocker:scientific_probe_predictions_invalid')
    const falsified = stringArray(transition.falsified_hypothesis_ids, 'typed_blocker:scientific_probe_predictions_invalid')
    if ([...supported, ...falsified].sort().join('\0') !== ids.sort().join('\0')
      || supported.some(id => predictions[id] !== transition.observed_observation_sha256)
      || falsified.some(id => predictions[id] === transition.observed_observation_sha256)) {
      fail('typed_blocker:scientific_probe_predictions_invalid')
    }
  } else if (transition.kind === 'reset') {
    integer(transition.reset_count, 'typed_blocker:scientific_reset_count_invalid', 1)
    for (const id of stringArray(transition.invalidated_plan_ids, 'typed_blocker:scientific_reset_plan_ids_invalid')) {
      requireIdentifier(id, 'typed_blocker:scientific_reset_plan_ids_invalid')
    }
  } else {
    requireIdentifier(transition.plan_id, 'typed_blocker:scientific_plan_identity_invalid')
    integer(transition.action_index, 'typed_blocker:scientific_plan_action_order_invalid')
    requireSha256(transition.expected_observation_sha256, 'typed_blocker:scientific_observation_digest_invalid')
    if (typeof transition.matched_prediction !== 'boolean'
      || transition.matched_prediction !== (
        transition.expected_observation_sha256 === transition.observed_observation_sha256
      )) fail('typed_blocker:scientific_prediction_match_invalid')
  }
}

function assertPlan(plan: ScientificPlan, id: string, state: ScientificRunState): void {
  exactKeys(plan, ['plan_id', 'hypothesis_id', 'state', 'next_action_index', 'actions'], 'typed_blocker:scientific_plan_shape_invalid')
  if (plan.plan_id !== id || requireIdentifier(id, 'typed_blocker:scientific_plan_identity_invalid') !== id) {
    fail('typed_blocker:scientific_plan_identity_invalid')
  }
  requireIdentifier(plan.hypothesis_id, 'typed_blocker:scientific_hypothesis_identity_invalid')
  if (state.hypotheses[plan.hypothesis_id] === undefined) fail('typed_blocker:scientific_hypothesis_unknown')
  if (!['active', 'completed', 'invalidated_prediction_mismatch', 'invalidated_reset'].includes(plan.state)) {
    fail('typed_blocker:scientific_plan_state_invalid')
  }
  if (!Array.isArray(plan.actions) || plan.actions.length === 0) fail('typed_blocker:scientific_plan_invalid')
  const next = integer(plan.next_action_index, 'typed_blocker:scientific_plan_action_order_invalid')
  if (next > plan.actions.length || (plan.state === 'active' && next >= plan.actions.length)
    || (plan.state === 'completed' && next !== plan.actions.length)) {
    fail('typed_blocker:scientific_plan_action_order_invalid')
  }
  for (const action of plan.actions) {
    exactKeys(action, ['action_sha256', 'expected_observation_sha256'], 'typed_blocker:scientific_plan_shape_invalid')
    requireSha256(action.action_sha256, 'typed_blocker:scientific_action_digest_invalid')
    requireSha256(action.expected_observation_sha256, 'typed_blocker:scientific_observation_digest_invalid')
  }
}

export function assertScientificRunState(value: unknown): asserts value is ScientificRunState {
  const state = exactKeys(value, [
    'schema',
    'run_id',
    'task_ref',
    'harness_generation',
    'loadout_id',
    'initial_observation_sha256',
    'current_observation_sha256',
    'max_real_actions',
    'real_actions_used',
    'reset_count',
    'escalation_policy',
    'timeline',
    'hypotheses',
    'plans',
  ], 'typed_blocker:scientific_run_state_invalid') as unknown as ScientificRunState
  if (state.schema !== 'mykrobial.scientific-run.v1'
    || (state.harness_generation !== 'current_production' && state.harness_generation !== 'next_deepseek_cordis')
    || state.loadout_id !== 'scientific-retrodiction-v1') fail('typed_blocker:scientific_run_state_invalid')
  requireIdentifier(state.run_id, 'typed_blocker:scientific_run_identity_invalid')
  requireIdentifier(state.task_ref, 'typed_blocker:scientific_task_ref_invalid')
  requireSha256(state.initial_observation_sha256, 'typed_blocker:scientific_observation_digest_invalid')
  requireSha256(state.current_observation_sha256, 'typed_blocker:scientific_observation_digest_invalid')
  const maximum = integer(state.max_real_actions, 'typed_blocker:scientific_action_budget_invalid', 1)
  const used = integer(state.real_actions_used, 'typed_blocker:scientific_action_budget_invalid')
  if (used > maximum || !Array.isArray(state.timeline) || used !== state.timeline.length) {
    fail('typed_blocker:scientific_action_budget_invalid')
  }
  const policy = exactKeys(state.escalation_policy, [
    'simulator_after_actions',
    'novelty_after_actions',
    'simulator_after_resets',
  ], 'typed_blocker:scientific_escalation_policy_invalid')
  const simulator = integer(policy.simulator_after_actions, 'typed_blocker:scientific_escalation_policy_invalid', 1)
  const novelty = integer(policy.novelty_after_actions, 'typed_blocker:scientific_escalation_policy_invalid', 1)
  integer(policy.simulator_after_resets, 'typed_blocker:scientific_escalation_policy_invalid', 1)
  if (novelty <= simulator) fail('typed_blocker:scientific_escalation_policy_invalid')

  let observation = state.initial_observation_sha256
  let resets = 0
  const planned: PlannedActionTransition[] = []
  for (const [index, transition] of state.timeline.entries()) {
    assertTransition(transition, index, observation)
    observation = transition.observed_observation_sha256
    if (transition.kind === 'reset') {
      resets += 1
      if (transition.reset_count !== resets) fail('typed_blocker:scientific_reset_count_invalid')
    } else if (transition.kind === 'planned_action') planned.push(transition)
  }
  if (observation !== state.current_observation_sha256
    || integer(state.reset_count, 'typed_blocker:scientific_reset_count_invalid') !== resets) {
    fail('typed_blocker:scientific_timeline_discontinuous')
  }

  const hypotheses = object(state.hypotheses, 'typed_blocker:scientific_hypotheses_invalid')
  for (const [id, raw] of Object.entries(hypotheses)) {
    const hypothesis = exactKeys(raw, [
      'hypothesis_id',
      'state_schema_sha256',
      'mechanism_sha256',
      'goal_predicate_sha256',
      'mechanism_kind',
      'state',
      'certified_transition_count',
      'certified_timeline_sha256',
    ], 'typed_blocker:scientific_hypothesis_shape_invalid')
    if (hypothesis.hypothesis_id !== id) fail('typed_blocker:scientific_hypothesis_identity_invalid')
    requireIdentifier(id, 'typed_blocker:scientific_hypothesis_identity_invalid')
    requireSha256(hypothesis.state_schema_sha256, 'typed_blocker:scientific_state_schema_digest_invalid')
    requireSha256(hypothesis.mechanism_sha256, 'typed_blocker:scientific_mechanism_digest_invalid')
    requireSha256(hypothesis.goal_predicate_sha256, 'typed_blocker:scientific_goal_digest_invalid')
    if (hypothesis.mechanism_kind !== 'textual_hypothesis' && hypothesis.mechanism_kind !== 'executable_simulator') {
      fail('typed_blocker:scientific_mechanism_kind_invalid')
    }
    const count = integer(hypothesis.certified_transition_count, 'typed_blocker:scientific_certificate_invalid')
    if (hypothesis.state === 'proposed') {
      if (count !== 0 || hypothesis.certified_timeline_sha256 !== null) fail('typed_blocker:scientific_certificate_invalid')
    } else if (hypothesis.state === 'certified_complete_history') {
      if (count > state.timeline.length) fail('typed_blocker:scientific_certificate_invalid')
      requireSha256(hypothesis.certified_timeline_sha256, 'typed_blocker:scientific_certificate_invalid')
    } else fail('typed_blocker:scientific_hypothesis_state_invalid')
  }

  const plans = object(state.plans, 'typed_blocker:scientific_plans_invalid')
  for (const [id, raw] of Object.entries(plans)) assertPlan(raw as unknown as ScientificPlan, id, state)
  for (const transition of planned) {
    const plan = state.plans[transition.plan_id]
    const action = plan?.actions[transition.action_index]
    if (action === undefined
      || action.action_sha256 !== transition.action_sha256
      || action.expected_observation_sha256 !== transition.expected_observation_sha256) {
      fail('typed_blocker:scientific_plan_transition_mismatch')
    }
  }
}

export function scientificRunStateIsValid(value: unknown): value is ScientificRunState {
  try {
    assertScientificRunState(value)
    return true
  } catch {
    return false
  }
}
