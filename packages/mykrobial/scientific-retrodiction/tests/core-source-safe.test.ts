import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildCheckpoint,
  buildEvent,
  canonicalJson,
  checkpointBody,
  sha256Domain,
  verifyCheckpointHash,
  verifyEventChain,
} from '../src/canonical.ts'
import {
  planActionResult,
  planCertification,
  planCommitActions,
  planDiscriminatingProbe,
  planHypothesis,
  planProbe,
  planReset,
  RESET_ACTION_SHA256,
} from '../src/commands.ts'
import {
  behaviorProjection,
  createRunState,
  escalationState,
  projectionIsConsistent,
  reduceScientificEvent,
  replayScientificEvents,
  startFromState,
} from '../src/fold.ts'
import {
  certifySimulator,
  searchCertifiedSimulator,
  type ScientificSimulator,
} from '../src/simulator.ts'
import { assertScientificRunState } from '../src/validation.ts'
import type {
  HarnessGeneration,
  ScientificEventEnvelope,
  ScientificEventPayload,
  ScientificProjectionState,
  ScientificRunState,
  ScientificStart,
} from '../src/types.ts'

function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

function start(generation: HarnessGeneration = 'next_deepseek_cordis'): ScientificStart {
  return {
    schema: 'mykrobial.scientific-run-start.v1',
    run_id: 'run-source-safe',
    task_ref: 'task-source-safe',
    harness_generation: generation,
    loadout_id: 'scientific-retrodiction-v1',
    initial_observation_sha256: digest('observation-zero'),
    max_real_actions: 20,
    escalation_policy: {
      simulator_after_actions: 3,
      novelty_after_actions: 6,
      simulator_after_resets: 2,
    },
  }
}

interface MutableRun {
  state: ScientificRunState
  events: ScientificEventEnvelope[]
}

function append(run: MutableRun, payload: ScientificEventPayload): ScientificEventEnvelope {
  const event = buildEvent(run.state, run.events, payload)
  run.events.push(event)
  run.state = reduceScientificEvent(run.state, event)
  return event
}

function fresh(generation: HarnessGeneration = 'next_deepseek_cordis'): MutableRun {
  return { state: createRunState(start(generation)), events: [] }
}

function propose(run: MutableRun, id = 'hypothesis-1', kind: 'textual_hypothesis' | 'executable_simulator' = 'textual_hypothesis'): void {
  append(run, planHypothesis(run.state, {
    hypothesis_id: id,
    state_schema_sha256: digest(`${id}-state`),
    mechanism_sha256: digest(`${id}-mechanism`),
    goal_predicate_sha256: digest(`${id}-goal`),
    mechanism_kind: kind,
  }))
}

function certify(run: MutableRun, id = 'hypothesis-1'): void {
  append(run, planCertification(run.state, {
    hypothesis_id: id,
    retrodictions: run.state.timeline.map(transition => ({
      transition_index: transition.transition_index,
      predicted_observation_sha256: transition.observed_observation_sha256,
    })),
  }))
}

test('RetroDICT core certifies history, commits expected actions, and stops at first mismatch', () => {
  const run = fresh()
  append(run, planProbe(run.state, {
    action_sha256: digest('probe-action'),
    observed_observation_sha256: digest('observation-one'),
    purpose: 'identify one transition',
  }))
  propose(run)
  certify(run)
  append(run, planCommitActions(run.state, {
    hypothesis_id: 'hypothesis-1',
    actions: [
      { action_sha256: digest('action-one'), expected_observation_sha256: digest('expected-one') },
      { action_sha256: digest('action-two'), expected_observation_sha256: digest('expected-two') },
    ],
  }))
  const mismatch = append(run, planActionResult(run.state, {
    plan_id: 'plan-1',
    action_index: 0,
    observed_observation_sha256: digest('surprise'),
  }))
  assert.equal(mismatch.kind, 'prediction_mismatch')
  assert.equal(run.state.plans['plan-1']?.state, 'invalidated_prediction_mismatch')
  assert.throws(
    () => planActionResult(run.state, {
      plan_id: 'plan-1',
      action_index: 1,
      observed_observation_sha256: digest('expected-two'),
    }),
    /typed_blocker:scientific_plan_not_executable/,
  )
})

test('bounded Schema contribution is admitted only as a genuinely discriminating real probe', () => {
  const run = fresh()
  propose(run, 'hypothesis-1')
  propose(run, 'hypothesis-2')
  assert.throws(
    () => planDiscriminatingProbe(run.state, {
      action_sha256: digest('probe'),
      predictions: {
        'hypothesis-1': digest('same'),
        'hypothesis-2': digest('same'),
      },
      observed_observation_sha256: digest('same'),
    }),
    /typed_blocker:scientific_probe_not_discriminating/,
  )
  const event = append(run, planDiscriminatingProbe(run.state, {
    action_sha256: digest('probe'),
    predictions: {
      'hypothesis-1': digest('outcome-a'),
      'hypothesis-2': digest('outcome-b'),
    },
    observed_observation_sha256: digest('outcome-b'),
  }))
  assert.equal(event.kind, 'discriminating_probe_recorded')
  if (event.kind !== 'discriminating_probe_recorded') throw new Error('unexpected event')
  assert.deepEqual(event.transition.supported_hypothesis_ids, ['hypothesis-2'])
  assert.deepEqual(event.transition.falsified_hypothesis_ids, ['hypothesis-1'])
  assert.equal(run.state.real_actions_used, 1)
})

test('cheap reasoning remains default until the frozen simulator and novelty thresholds', () => {
  const run = fresh()
  for (let index = 0; index < 3; index += 1) {
    append(run, planProbe(run.state, {
      action_sha256: digest(`probe-${index}`),
      observed_observation_sha256: digest(`observation-${index}`),
      purpose: `bounded probe ${index}`,
    }))
  }
  assert.equal(escalationState(run.state), 'build_verified_simulator')
  propose(run)
  certify(run)
  assert.throws(
    () => planCommitActions(run.state, {
      hypothesis_id: 'hypothesis-1',
      actions: [{ action_sha256: digest('action'), expected_observation_sha256: digest('result') }],
    }),
    /typed_blocker:scientific_simulator_required/,
  )
  for (let index = 3; index < 6; index += 1) {
    append(run, planProbe(run.state, {
      action_sha256: digest(`probe-${index}`),
      observed_observation_sha256: digest(`observation-${index}`),
      purpose: `bounded probe ${index}`,
    }))
  }
  assert.equal(escalationState(run.state), 'novelty_escape')
})

test('checkpoint validation and replay are content-addressed and generation-neutral', () => {
  const next = fresh('next_deepseek_cordis')
  append(next, planProbe(next.state, {
    action_sha256: digest('shared-action'),
    observed_observation_sha256: digest('shared-observation'),
    purpose: 'shared transition',
  }))
  propose(next)
  certify(next)
  const checkpoint = buildCheckpoint(next.state, next.events)
  assert.equal(verifyCheckpointHash(checkpoint), true)
  assert.equal(verifyEventChain(checkpoint.events), true)
  assert.deepEqual(replayScientificEvents(startFromState(next.state), next.events), next.state)
  const projectionState: ScientificProjectionState = {
    current: next.state,
    events: next.events,
    failure: null,
  }
  assert.equal(projectionIsConsistent(projectionState), true)

  const current = fresh('current_production')
  append(current, planProbe(current.state, {
    action_sha256: digest('shared-action'),
    observed_observation_sha256: digest('shared-observation'),
    purpose: 'shared transition',
  }))
  propose(current)
  certify(current)
  assert.equal(
    canonicalJson(behaviorProjection(next.state, next.events)),
    canonicalJson(behaviorProjection(current.state, current.events)),
  )

  const tampered = structuredClone(checkpoint)
  tampered.events[0]!.previous_event_sha256 = digest('forged')
  assert.equal(verifyEventChain(tampered.events), false)
  tampered.state.task_ref = 'forged-task'
  assert.equal(verifyCheckpointHash(tampered), false)
})

test('reset action identity and behavior projection are exact across both generations', () => {
  assert.equal(
    RESET_ACTION_SHA256,
    createHash('sha256').update('mykrobial.scientific.reset-action.v1').digest('hex'),
  )
  const current = fresh('current_production')
  const next = fresh('next_deepseek_cordis')
  for (const run of [current, next]) {
    append(run, planReset(run.state, digest('shared-reset-observation')))
  }
  assert.equal(
    canonicalJson(behaviorProjection(current.state, current.events)),
    canonicalJson(behaviorProjection(next.state, next.events)),
  )
  assert.equal(current.state.timeline[0]?.action_sha256, RESET_ACTION_SHA256)
  assert.equal(next.state.timeline[0]?.action_sha256, RESET_ACTION_SHA256)
})

test('reset preserves creation order for 10+ active plans across both generations', () => {
  const runs = [fresh('current_production'), fresh('next_deepseek_cordis')]
  for (const run of runs) {
    propose(run)
    certify(run)
    for (let index = 1; index <= 12; index += 1) {
      append(run, planCommitActions(run.state, {
        hypothesis_id: 'hypothesis-1',
        actions: [{
          action_sha256: digest(`queued-action-${index}`),
          expected_observation_sha256: digest(`queued-result-${index}`),
        }],
      }))
    }
    append(run, planReset(run.state, digest('populated-reset-observation')))
  }
  const expected = Array.from({ length: 12 }, (_unused, index) => `plan-${index + 1}`)
  for (const run of runs) {
    const reset = run.state.timeline.at(-1)
    assert.equal(reset?.kind, 'reset')
    if (reset?.kind !== 'reset') throw new Error('expected reset transition')
    assert.deepEqual(reset.invalidated_plan_ids, expected)
  }
  assert.equal(
    canonicalJson(behaviorProjection(runs[0]!.state, runs[0]!.events)),
    canonicalJson(behaviorProjection(runs[1]!.state, runs[1]!.events)),
  )
})

test('a simulator must retrodict complete history before bounded zero-live-action search', () => {
  const run = fresh()
  const actionOne = digest('sim-action-one')
  const actionTwo = digest('sim-action-two')
  const observationOne = digest('sim-observation-one')
  const observationTwo = digest('sim-observation-two')
  append(run, planProbe(run.state, {
    action_sha256: actionOne,
    observed_observation_sha256: observationOne,
    purpose: 'seed simulator history',
  }))
  propose(run, 'simulator-hypothesis', 'executable_simulator')
  certify(run, 'simulator-hypothesis')
  const mechanism = run.state.hypotheses['simulator-hypothesis']!.mechanism_sha256
  const transitions = new Map<string, string>([
    [`${digest('observation-zero')}:${actionOne}`, observationOne],
    [`${observationOne}:${actionTwo}`, observationTwo],
  ])
  const simulator: ScientificSimulator = {
    mechanism_sha256: mechanism,
    availableActions: observation => observation === observationOne ? [actionTwo] : [],
    step: (observation, action) => transitions.get(`${observation}:${action}`) ?? digest('dead-end'),
    isGoal: observation => observation === observationTwo,
  }
  assert.equal(certifySimulator(run.state, 'simulator-hypothesis', simulator).length, 64)
  const result = searchCertifiedSimulator(run.state, 'simulator-hypothesis', simulator, {
    max_nodes: 10,
    max_depth: 3,
  })
  assert.equal(result.outcome, 'found')
  assert.deepEqual(result.action_sha256, [actionTwo])
  assert.equal(result.live_actions_spent, 0)
})

test('simulator mismatch and node exhaustion fail closed and stay bounded', () => {
  const run = fresh()
  const action = digest('history-action')
  append(run, planProbe(run.state, {
    action_sha256: action,
    observed_observation_sha256: digest('history-result'),
    purpose: 'history for bad simulator',
  }))
  propose(run, 'simulator-hypothesis', 'executable_simulator')
  certify(run, 'simulator-hypothesis')
  const mechanism = run.state.hypotheses['simulator-hypothesis']!.mechanism_sha256
  const bad: ScientificSimulator = {
    mechanism_sha256: mechanism,
    availableActions: () => [],
    step: () => digest('wrong-result'),
    isGoal: () => false,
  }
  assert.throws(
    () => certifySimulator(run.state, 'simulator-hypothesis', bad),
    /typed_blocker:scientific_simulator_retrodiction_mismatch/,
  )

  const observed = digest('history-result')
  const loopAction = digest('loop-action')
  const goodButUnsolved: ScientificSimulator = {
    mechanism_sha256: mechanism,
    availableActions: () => [loopAction],
    step: (before, candidate) => candidate === action ? observed : digest(`${before}:${candidate}`),
    isGoal: () => false,
  }
  const bounded = searchCertifiedSimulator(run.state, 'simulator-hypothesis', goodButUnsolved, {
    max_nodes: 2,
    max_depth: 10,
  })
  assert.equal(bounded.outcome, 'node_budget_exhausted')
  assert.equal(bounded.expanded_nodes, 2)
  assert.equal(bounded.live_actions_spent, 0)
})

test('checkpoint and projection validation reject internally inconsistent but rehashed state', () => {
  const run = fresh()
  propose(run)
  certify(run)
  append(run, planCommitActions(run.state, {
    hypothesis_id: 'hypothesis-1',
    actions: [{ action_sha256: digest('action'), expected_observation_sha256: digest('expected') }],
  }))
  append(run, planActionResult(run.state, {
    plan_id: 'plan-1',
    action_index: 0,
    observed_observation_sha256: digest('expected'),
  }))
  const checkpoint = buildCheckpoint(run.state, run.events)
  const weakened = structuredClone(checkpoint)
  weakened.non_claims = ['not_runtime_adoption']
  weakened.checkpoint_sha256 = sha256Domain(
    'mykrobial.scientific-run-checkpoint.v1\0',
    checkpointBody(weakened),
  )
  assert.equal(verifyCheckpointHash(weakened), false)

  const inconsistent = structuredClone(run.state)
  inconsistent.plans['plan-1']!.actions[0]!.action_sha256 = digest('forged-action')
  assert.throws(() => assertScientificRunState(inconsistent), /typed_blocker:scientific_plan_transition_mismatch|typed_blocker:/)
  assert.equal(projectionIsConsistent({
    current: inconsistent,
    events: run.events,
    failure: null,
  }), false)
})
