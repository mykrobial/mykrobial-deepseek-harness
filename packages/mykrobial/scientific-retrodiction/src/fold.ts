import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { canonicalJson, eventBody, timelineSha256, verifyEventChain } from './canonical.ts'
import type {
  ScientificBehaviorProjection,
  ScientificEventEnvelope,
  ScientificProjectionState,
  ScientificRunState,
  ScientificStart,
} from './types.ts'
import { assertScientificRunState } from './validation.ts'

export function createRunState(start: ScientificStart): ScientificRunState {
  return {
    schema: 'mykrobial.scientific-run.v1',
    run_id: start.run_id,
    task_ref: start.task_ref,
    harness_generation: start.harness_generation,
    loadout_id: start.loadout_id,
    initial_observation_sha256: start.initial_observation_sha256,
    current_observation_sha256: start.initial_observation_sha256,
    max_real_actions: start.max_real_actions,
    real_actions_used: 0,
    reset_count: 0,
    escalation_policy: structuredClone(start.escalation_policy),
    timeline: [],
    hypotheses: {},
    plans: {},
  }
}

export function startFromState(state: ScientificRunState): ScientificStart {
  return {
    schema: 'mykrobial.scientific-run-start.v1',
    run_id: state.run_id,
    task_ref: state.task_ref,
    harness_generation: state.harness_generation,
    loadout_id: state.loadout_id,
    initial_observation_sha256: state.initial_observation_sha256,
    max_real_actions: state.max_real_actions,
    escalation_policy: structuredClone(state.escalation_policy),
  }
}

export function replayScientificEvents(
  start: ScientificStart,
  events: readonly ScientificEventEnvelope[],
): ScientificRunState {
  if (!verifyEventChain(events)) throw new Error('scientific event chain is invalid')
  let replayed = createRunState(start)
  for (const event of events) {
    if (event.run_id !== start.run_id
      || event.harness_generation !== start.harness_generation
      || event.loadout_id !== start.loadout_id) {
      throw new Error('scientific event identity differs from run start')
    }
    replayed = reduceScientificEvent(replayed, event)
  }
  return replayed
}

export function escalationState(state: ScientificRunState): 'observe_and_retrodict' | 'build_verified_simulator' | 'novelty_escape' {
  if (state.real_actions_used >= state.escalation_policy.novelty_after_actions) return 'novelty_escape'
  if (state.real_actions_used >= state.escalation_policy.simulator_after_actions
    || state.reset_count >= state.escalation_policy.simulator_after_resets) return 'build_verified_simulator'
  return 'observe_and_retrodict'
}

function nextState(state: ScientificRunState): ScientificRunState {
  return structuredClone(state)
}

export function reduceScientificEvent(
  state: ScientificRunState,
  event: ScientificEventEnvelope,
): ScientificRunState {
  const next = nextState(state)
  switch (event.kind) {
    case 'probe_recorded':
    case 'discriminating_probe_recorded': {
      next.timeline.push(structuredClone(event.transition))
      next.current_observation_sha256 = event.transition.observed_observation_sha256
      next.real_actions_used += 1
      return next
    }
    case 'reset_recorded': {
      next.timeline.push(structuredClone(event.transition))
      next.current_observation_sha256 = event.transition.observed_observation_sha256
      next.real_actions_used += 1
      next.reset_count = event.transition.reset_count
      for (const planId of event.transition.invalidated_plan_ids) {
        const plan = next.plans[planId]
        if (plan !== undefined) plan.state = 'invalidated_reset'
      }
      return next
    }
    case 'hypothesis_proposed':
      next.hypotheses[event.hypothesis.hypothesis_id] = structuredClone(event.hypothesis)
      return next
    case 'hypothesis_certified': {
      const hypothesis = next.hypotheses[event.hypothesis_id]
      if (hypothesis === undefined) throw new Error(`unknown hypothesis ${event.hypothesis_id}`)
      hypothesis.state = 'certified_complete_history'
      hypothesis.certified_transition_count = event.transition_count
      hypothesis.certified_timeline_sha256 = event.timeline_sha256
      return next
    }
    case 'actions_committed':
      next.plans[event.plan.plan_id] = structuredClone(event.plan)
      return next
    case 'prediction_matched':
    case 'plan_completed':
    case 'prediction_mismatch': {
      const transition = event.transition
      const plan = next.plans[transition.plan_id]
      if (plan === undefined) throw new Error(`unknown plan ${transition.plan_id}`)
      next.timeline.push(structuredClone(transition))
      next.current_observation_sha256 = transition.observed_observation_sha256
      next.real_actions_used += 1
      plan.next_action_index = transition.action_index + 1
      plan.state = event.kind === 'prediction_mismatch'
        ? 'invalidated_prediction_mismatch'
        : event.kind === 'plan_completed'
          ? 'completed'
          : 'active'
      return next
    }
  }
}

export const initialScientificProjectionState = (): ScientificProjectionState => ({
  current: null,
  events: [],
  failure: null,
})

function acceptEnvelope(state: ScientificProjectionState, envelope: ScientificEventEnvelope): ScientificProjectionState {
  if (state.current === null) throw new Error('scientific event precedes run start')
  if (envelope.run_id !== state.current.run_id
    || envelope.harness_generation !== state.current.harness_generation
    || envelope.loadout_id !== state.current.loadout_id) {
    throw new Error('scientific event identity differs from run start')
  }
  const candidateEvents = [...state.events, structuredClone(envelope)]
  if (!verifyEventChain(candidateEvents)) throw new Error('scientific event chain is invalid')
  return {
    current: reduceScientificEvent(state.current, envelope),
    events: candidateEvents,
    failure: null,
  }
}

export function applyScientificProjection(
  state: ScientificProjectionState,
  event: SessionEvent,
): ScientificProjectionState {
  if (state.failure !== null) return state
  if (event.type !== 'mykrobial/scientific/start' && event.type !== 'mykrobial/scientific/event') return state
  try {
    if (event.type === 'mykrobial/scientific/start') {
      if (state.current !== null || state.events.length !== 0) throw new Error('scientific run already started')
      return { current: createRunState(event.data), events: [], failure: null }
    }
    return acceptEnvelope(state, event.data)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...state, failure: `scientific replay failed at session event ${event.seq}: ${message}` }
  }
}

export function behaviorProjection(
  state: ScientificRunState,
  events: readonly ScientificEventEnvelope[],
): ScientificBehaviorProjection {
  const {
    schema: _stateSchema,
    run_id: _runId,
    harness_generation: _generation,
    ...cloned
  } = structuredClone(state)
  const projectedEvents = events.map(source => {
    const {
      schema: _eventSchema,
      run_id: _eventRunId,
      harness_generation: _eventGeneration,
      event_sequence: _sequence,
      previous_event_sha256: _previous,
      event_sha256: _eventHash,
      ...projected
    } = structuredClone(source)
    return projected
  })
  return {
    schema: 'mykrobial.scientific-behavior-projection.v1',
    state: cloned,
    events: projectedEvents,
  }
}

export function projectionIsConsistent(state: ScientificProjectionState): boolean {
  if (state.failure !== null) return false
  if (state.current === null) return state.events.length === 0
  try {
    assertScientificRunState(state.current)
    const replayed = replayScientificEvents(startFromState(state.current), state.events)
    assertScientificRunState(replayed)
    const last = state.events.at(-1)
    return canonicalJson(replayed) === canonicalJson(state.current)
      && timelineSha256(state.current).length === 64
      && (last === undefined || eventBody(last).event_sequence === last.event_sequence)
  } catch {
    return false
  }
}
