/** Deterministic, bounded simulator certification and search. */
import {
  fail,
  requireSha256,
  timelineSha256,
} from './canonical.ts'
import type { ScientificRunState } from './types.ts'

export interface ScientificSimulator {
  /** Content identity of the exact simulator implementation/configuration. */
  mechanism_sha256: string
  /** Stable, side-effect-free action enumeration for one opaque state digest. */
  availableActions(observationSha256: string): readonly string[]
  /** Stable, side-effect-free state transition over opaque digests. */
  step(observationSha256: string, actionSha256: string): string
  /** Stable, side-effect-free goal predicate over one opaque state digest. */
  isGoal(observationSha256: string): boolean
}

export interface SimulatorSearchBudget {
  max_nodes: number
  max_depth: number
}

export interface SimulatorSearchResult {
  schema: 'mykrobial.scientific-simulator-search.v1'
  hypothesis_id: string
  mechanism_sha256: string
  certified_timeline_sha256: string
  outcome: 'found' | 'exhausted' | 'node_budget_exhausted'
  action_sha256: string[]
  terminal_observation_sha256: string | null
  expanded_nodes: number
  visited_states: number
  max_depth_reached: number
  live_actions_spent: 0
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`typed_blocker:scientific_simulator_${field}_invalid`)
  }
  return value
}

function checkedStep(simulator: ScientificSimulator, before: string, action: string): string {
  try {
    return requireSha256(
      simulator.step(before, action),
      'typed_blocker:scientific_simulator_transition_invalid',
    )
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('typed_blocker:')) throw error
    fail('typed_blocker:scientific_simulator_transition_failed')
  }
}

function checkedGoal(simulator: ScientificSimulator, observation: string): boolean {
  try {
    const value = simulator.isGoal(observation)
    if (typeof value !== 'boolean') fail('typed_blocker:scientific_simulator_goal_invalid')
    return value
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('typed_blocker:')) throw error
    fail('typed_blocker:scientific_simulator_goal_failed')
  }
}

function checkedActions(simulator: ScientificSimulator, observation: string): string[] {
  try {
    const source = simulator.availableActions(observation)
    if (!Array.isArray(source) || source.length > 100_000) {
      fail('typed_blocker:scientific_simulator_actions_invalid')
    }
    const actions = source.map(action => requireSha256(
      action,
      'typed_blocker:scientific_simulator_actions_invalid',
    ))
    if (new Set(actions).size !== actions.length) {
      fail('typed_blocker:scientific_simulator_actions_invalid')
    }
    return actions.sort()
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('typed_blocker:')) throw error
    fail('typed_blocker:scientific_simulator_actions_failed')
  }
}

/**
 * Prove one simulator reproduces every recorded transition exactly. This is a
 * local behavioral certificate, not code provenance, containment, or execution
 * admission.
 */
export function certifySimulator(
  state: ScientificRunState,
  hypothesisId: string,
  simulator: ScientificSimulator,
): string {
  const hypothesis = state.hypotheses[hypothesisId]
  if (hypothesis === undefined
    || hypothesis.state !== 'certified_complete_history'
    || hypothesis.mechanism_kind !== 'executable_simulator') {
    fail('typed_blocker:scientific_simulator_hypothesis_not_certified')
  }
  const mechanism = requireSha256(
    simulator.mechanism_sha256,
    'typed_blocker:scientific_simulator_identity_invalid',
  )
  if (mechanism !== hypothesis.mechanism_sha256) {
    fail('typed_blocker:scientific_simulator_identity_mismatch')
  }
  const timeline = timelineSha256(state)
  if (hypothesis.certified_transition_count !== state.timeline.length
    || hypothesis.certified_timeline_sha256 !== timeline) {
    fail('typed_blocker:scientific_certificate_stale')
  }
  let observation = state.initial_observation_sha256
  for (const transition of state.timeline) {
    if (transition.before_observation_sha256 !== observation) {
      fail('typed_blocker:scientific_timeline_discontinuous')
    }
    const predicted = checkedStep(simulator, observation, transition.action_sha256)
    if (predicted !== transition.observed_observation_sha256) {
      fail('typed_blocker:scientific_simulator_retrodiction_mismatch')
    }
    observation = predicted
  }
  if (observation !== state.current_observation_sha256) {
    fail('typed_blocker:scientific_timeline_discontinuous')
  }
  return timeline
}

/**
 * Stable breadth-first search from the latest recorded state. Action digests
 * are lexically ordered, states are visited once, and both depth and node work
 * are hard bounded. The function spends zero live actions.
 */
export function searchCertifiedSimulator(
  state: ScientificRunState,
  hypothesisId: string,
  simulator: ScientificSimulator,
  budget: SimulatorSearchBudget,
): SimulatorSearchResult {
  const maxNodes = positiveBound(budget.max_nodes, 'node_budget', 1_000_000)
  const maxDepth = positiveBound(budget.max_depth, 'depth_budget', 100_000)
  const certifiedTimeline = certifySimulator(state, hypothesisId, simulator)
  const start = state.current_observation_sha256
  const queue: Array<{ observation: string; actions: string[]; depth: number }> = [
    { observation: start, actions: [], depth: 0 },
  ]
  const visited = new Set<string>([start])
  let cursor = 0
  let expanded = 0
  let maxDepthReached = 0

  while (cursor < queue.length) {
    if (expanded >= maxNodes) {
      return {
        schema: 'mykrobial.scientific-simulator-search.v1',
        hypothesis_id: hypothesisId,
        mechanism_sha256: simulator.mechanism_sha256,
        certified_timeline_sha256: certifiedTimeline,
        outcome: 'node_budget_exhausted',
        action_sha256: [],
        terminal_observation_sha256: null,
        expanded_nodes: expanded,
        visited_states: visited.size,
        max_depth_reached: maxDepthReached,
        live_actions_spent: 0,
      }
    }
    const node = queue[cursor++]
    maxDepthReached = Math.max(maxDepthReached, node.depth)
    if (checkedGoal(simulator, node.observation)) {
      return {
        schema: 'mykrobial.scientific-simulator-search.v1',
        hypothesis_id: hypothesisId,
        mechanism_sha256: simulator.mechanism_sha256,
        certified_timeline_sha256: certifiedTimeline,
        outcome: 'found',
        action_sha256: node.actions,
        terminal_observation_sha256: node.observation,
        expanded_nodes: expanded,
        visited_states: visited.size,
        max_depth_reached: maxDepthReached,
        live_actions_spent: 0,
      }
    }
    if (node.depth >= maxDepth) continue
    expanded += 1
    for (const action of checkedActions(simulator, node.observation)) {
      const observation = checkedStep(simulator, node.observation, action)
      if (visited.has(observation)) continue
      visited.add(observation)
      queue.push({ observation, actions: [...node.actions, action], depth: node.depth + 1 })
    }
  }

  return {
    schema: 'mykrobial.scientific-simulator-search.v1',
    hypothesis_id: hypothesisId,
    mechanism_sha256: simulator.mechanism_sha256,
    certified_timeline_sha256: certifiedTimeline,
    outcome: 'exhausted',
    action_sha256: [],
    terminal_observation_sha256: null,
    expanded_nodes: expanded,
    visited_states: visited.size,
    max_depth_reached: maxDepthReached,
    live_actions_spent: 0,
  }
}
