import {
  fail,
  requireIdentifier,
  requireSha256,
  requireText,
  timelineSha256,
} from './canonical.ts'
import { escalationState } from './fold.ts'
import type {
  CertifyHypothesisRequest,
  CommitActionsRequest,
  ProposeHypothesisRequest,
  RecordActionResultRequest,
  RecordDiscriminatingProbeRequest,
  RecordProbeRequest,
  ScientificEventPayload,
  ScientificRunState,
  Retrodiction,
} from './types.ts'

/** Shared synthetic reset identity: sha256("mykrobial.scientific.reset-action.v1"). */
export const RESET_ACTION_SHA256 = 'eb44b916e4f77a3d78a3c2ec263aebf9416deeb0b51c4278d454ca3f2f388335'

function requireBudget(state: ScientificRunState): void {
  if (state.real_actions_used >= state.max_real_actions) {
    fail('typed_blocker:scientific_action_budget_exhausted')
  }
}

export function planProbe(state: ScientificRunState, request: RecordProbeRequest): ScientificEventPayload {
  requireBudget(state)
  return {
    kind: 'probe_recorded',
    transition: {
      transition_index: state.timeline.length,
      kind: 'probe',
      before_observation_sha256: state.current_observation_sha256,
      action_sha256: requireSha256(request.action_sha256, 'typed_blocker:scientific_action_digest_invalid'),
      observed_observation_sha256: requireSha256(
        request.observed_observation_sha256,
        'typed_blocker:scientific_observation_digest_invalid',
      ),
      purpose: requireText(request.purpose, 'typed_blocker:scientific_probe_purpose_invalid', 1024),
    },
  }
}

export function planDiscriminatingProbe(
  state: ScientificRunState,
  request: RecordDiscriminatingProbeRequest,
): ScientificEventPayload {
  requireBudget(state)
  const ids = Object.keys(request.predictions)
  if (ids.length < 2 || ids.length > 1024) fail('typed_blocker:scientific_probe_predictions_invalid')
  const predictions: Record<string, string> = {}
  for (const id of ids.sort()) {
    requireIdentifier(id, 'typed_blocker:scientific_probe_predictions_invalid')
    if (state.hypotheses[id] === undefined) fail('typed_blocker:scientific_hypothesis_unknown')
    predictions[id] = requireSha256(
      request.predictions[id],
      'typed_blocker:scientific_probe_predictions_invalid',
    )
  }
  if (new Set(Object.values(predictions)).size < 2) {
    fail('typed_blocker:scientific_probe_not_discriminating')
  }
  const observed = requireSha256(
    request.observed_observation_sha256,
    'typed_blocker:scientific_observation_digest_invalid',
  )
  const supported = Object.keys(predictions).filter(id => predictions[id] === observed).sort()
  const supportedSet = new Set(supported)
  return {
    kind: 'discriminating_probe_recorded',
    transition: {
      transition_index: state.timeline.length,
      kind: 'discriminating_probe',
      before_observation_sha256: state.current_observation_sha256,
      action_sha256: requireSha256(request.action_sha256, 'typed_blocker:scientific_action_digest_invalid'),
      predictions,
      observed_observation_sha256: observed,
      supported_hypothesis_ids: supported,
      falsified_hypothesis_ids: Object.keys(predictions).filter(id => !supportedSet.has(id)).sort(),
    },
  }
}

export function planReset(state: ScientificRunState, observedObservationSha256: string): ScientificEventPayload {
  requireBudget(state)
  return {
    kind: 'reset_recorded',
    transition: {
      transition_index: state.timeline.length,
      kind: 'reset',
      before_observation_sha256: state.current_observation_sha256,
      action_sha256: RESET_ACTION_SHA256,
      observed_observation_sha256: requireSha256(
        observedObservationSha256,
        'typed_blocker:scientific_observation_digest_invalid',
      ),
      reset_count: state.reset_count + 1,
      invalidated_plan_ids: Object.values(state.plans)
        .filter(plan => plan.state === 'active')
        .map(plan => plan.plan_id),
    },
  }
}

export function planHypothesis(
  state: ScientificRunState,
  request: ProposeHypothesisRequest,
): ScientificEventPayload {
  const id = requireIdentifier(request.hypothesis_id, 'typed_blocker:scientific_hypothesis_identity_invalid')
  if (state.hypotheses[id] !== undefined) fail('typed_blocker:scientific_hypothesis_duplicate')
  const mechanismKind = request.mechanism_kind ?? 'textual_hypothesis'
  if (mechanismKind !== 'textual_hypothesis' && mechanismKind !== 'executable_simulator') {
    fail('typed_blocker:scientific_mechanism_kind_invalid')
  }
  return {
    kind: 'hypothesis_proposed',
    hypothesis: {
      hypothesis_id: id,
      state_schema_sha256: requireSha256(
        request.state_schema_sha256,
        'typed_blocker:scientific_state_schema_digest_invalid',
      ),
      mechanism_sha256: requireSha256(
        request.mechanism_sha256,
        'typed_blocker:scientific_mechanism_digest_invalid',
      ),
      goal_predicate_sha256: requireSha256(
        request.goal_predicate_sha256,
        'typed_blocker:scientific_goal_digest_invalid',
      ),
      mechanism_kind: mechanismKind,
      state: 'proposed',
      certified_transition_count: 0,
      certified_timeline_sha256: null,
    },
  }
}

export function planCertification(
  state: ScientificRunState,
  request: CertifyHypothesisRequest,
): ScientificEventPayload {
  const hypothesis = state.hypotheses[request.hypothesis_id]
  if (hypothesis === undefined) fail('typed_blocker:scientific_hypothesis_unknown')
  if (!Array.isArray(request.retrodictions)) fail('typed_blocker:scientific_retrodiction_invalid')
  if (request.retrodictions.length !== state.timeline.length) {
    fail('typed_blocker:scientific_retrodiction_incomplete')
  }
  const seen = new Set<number>()
  const normalized: Retrodiction[] = new Array(request.retrodictions.length)
  for (const row of request.retrodictions) {
    if (!Number.isSafeInteger(row.transition_index)
      || row.transition_index < 0
      || row.transition_index >= state.timeline.length
      || seen.has(row.transition_index)) fail('typed_blocker:scientific_retrodiction_invalid')
    seen.add(row.transition_index)
    const predicted = requireSha256(
      row.predicted_observation_sha256,
      'typed_blocker:scientific_retrodiction_invalid',
    )
    if (predicted !== state.timeline[row.transition_index].observed_observation_sha256) {
      fail('typed_blocker:scientific_retrodiction_mismatch')
    }
    normalized[row.transition_index] = {
      transition_index: row.transition_index,
      predicted_observation_sha256: predicted,
    }
  }
  if (seen.size !== state.timeline.length) fail('typed_blocker:scientific_retrodiction_incomplete')
  return {
    kind: 'hypothesis_certified',
    hypothesis_id: hypothesis.hypothesis_id,
    transition_count: state.timeline.length,
    timeline_sha256: timelineSha256(state),
    retrodictions: normalized,
  }
}

export function planCommitActions(
  state: ScientificRunState,
  request: CommitActionsRequest,
): ScientificEventPayload {
  const hypothesis = state.hypotheses[request.hypothesis_id]
  if (hypothesis === undefined || hypothesis.state !== 'certified_complete_history') {
    fail('typed_blocker:scientific_hypothesis_not_certified')
  }
  if (hypothesis.certified_transition_count !== state.timeline.length
    || hypothesis.certified_timeline_sha256 !== timelineSha256(state)) {
    fail('typed_blocker:scientific_certificate_stale')
  }
  if (escalationState(state) !== 'observe_and_retrodict'
    && hypothesis.mechanism_kind !== 'executable_simulator') {
    fail('typed_blocker:scientific_simulator_required')
  }
  if (!Array.isArray(request.actions) || request.actions.length === 0) {
    fail('typed_blocker:scientific_plan_invalid')
  }
  if (request.actions.length > state.max_real_actions - state.real_actions_used) {
    fail('typed_blocker:scientific_plan_exceeds_budget')
  }
  const actions = request.actions.map(action => ({
    action_sha256: requireSha256(action.action_sha256, 'typed_blocker:scientific_action_digest_invalid'),
    expected_observation_sha256: requireSha256(
      action.expected_observation_sha256,
      'typed_blocker:scientific_observation_digest_invalid',
    ),
  }))
  return {
    kind: 'actions_committed',
    plan: {
      plan_id: `plan-${Object.keys(state.plans).length + 1}`,
      hypothesis_id: hypothesis.hypothesis_id,
      state: 'active',
      next_action_index: 0,
      actions,
    },
  }
}

export function planActionResult(
  state: ScientificRunState,
  request: RecordActionResultRequest,
): ScientificEventPayload {
  requireBudget(state)
  const plan = state.plans[request.plan_id]
  if (plan === undefined || plan.state !== 'active') fail('typed_blocker:scientific_plan_not_executable')
  if (!Number.isSafeInteger(request.action_index)
    || request.action_index !== plan.next_action_index
    || request.action_index >= plan.actions.length) {
    fail('typed_blocker:scientific_plan_action_order_invalid')
  }
  const action = plan.actions[request.action_index]
  const observed = requireSha256(
    request.observed_observation_sha256,
    'typed_blocker:scientific_observation_digest_invalid',
  )
  const matched = observed === action.expected_observation_sha256
  const transition = {
    transition_index: state.timeline.length,
    kind: 'planned_action' as const,
    plan_id: plan.plan_id,
    action_index: request.action_index,
    before_observation_sha256: state.current_observation_sha256,
    action_sha256: action.action_sha256,
    expected_observation_sha256: action.expected_observation_sha256,
    observed_observation_sha256: observed,
    matched_prediction: matched,
  }
  if (!matched) {
    return {
      kind: 'prediction_mismatch',
      plan_id: plan.plan_id,
      transition,
      counterexample: {
        transition_index: transition.transition_index,
        expected_observation_sha256: action.expected_observation_sha256,
        observed_observation_sha256: observed,
      },
    }
  }
  return request.action_index + 1 === plan.actions.length
    ? { kind: 'plan_completed', transition }
    : { kind: 'prediction_matched', transition }
}
