/** Public contracts for the generation-neutral scientific-retrodiction loadout. */

export type HarnessGeneration = 'current_production' | 'next_deepseek_cordis'
export type MechanismKind = 'textual_hypothesis' | 'executable_simulator'
export type EscalationState = 'observe_and_retrodict' | 'build_verified_simulator' | 'novelty_escape'
export type HypothesisState = 'proposed' | 'certified_complete_history'
export type PlanState = 'active' | 'completed' | 'invalidated_prediction_mismatch' | 'invalidated_reset'

export interface EscalationPolicy {
  simulator_after_actions: number
  novelty_after_actions: number
  simulator_after_resets: number
}

export interface ScientificStart {
  schema: 'mykrobial.scientific-run-start.v1'
  run_id: string
  task_ref: string
  harness_generation: HarnessGeneration
  loadout_id: 'scientific-retrodiction-v1'
  initial_observation_sha256: string
  max_real_actions: number
  escalation_policy: EscalationPolicy
}

export interface ProbeTransition {
  transition_index: number
  kind: 'probe'
  before_observation_sha256: string
  action_sha256: string
  observed_observation_sha256: string
  purpose: string
}

export interface DiscriminatingProbeTransition {
  transition_index: number
  kind: 'discriminating_probe'
  before_observation_sha256: string
  action_sha256: string
  predictions: Record<string, string>
  observed_observation_sha256: string
  supported_hypothesis_ids: string[]
  falsified_hypothesis_ids: string[]
}

export interface ResetTransition {
  transition_index: number
  kind: 'reset'
  before_observation_sha256: string
  action_sha256: string
  observed_observation_sha256: string
  reset_count: number
  invalidated_plan_ids: string[]
}

export interface PlannedActionTransition {
  transition_index: number
  kind: 'planned_action'
  plan_id: string
  action_index: number
  before_observation_sha256: string
  action_sha256: string
  expected_observation_sha256: string
  observed_observation_sha256: string
  matched_prediction: boolean
}

export type ScientificTransition =
  | ProbeTransition
  | DiscriminatingProbeTransition
  | ResetTransition
  | PlannedActionTransition

export interface ScientificHypothesis {
  hypothesis_id: string
  state_schema_sha256: string
  mechanism_sha256: string
  goal_predicate_sha256: string
  mechanism_kind: MechanismKind
  state: HypothesisState
  certified_transition_count: number
  certified_timeline_sha256: string | null
}

export interface ExpectedAction {
  action_sha256: string
  expected_observation_sha256: string
}

export interface ScientificPlan {
  plan_id: string
  hypothesis_id: string
  state: PlanState
  next_action_index: number
  actions: ExpectedAction[]
}

export interface Retrodiction {
  transition_index: number
  predicted_observation_sha256: string
}

export interface Counterexample {
  transition_index: number
  expected_observation_sha256: string
  observed_observation_sha256: string
}

export type ScientificEventPayload =
  | { kind: 'probe_recorded'; transition: ProbeTransition }
  | { kind: 'discriminating_probe_recorded'; transition: DiscriminatingProbeTransition }
  | { kind: 'reset_recorded'; transition: ResetTransition }
  | { kind: 'hypothesis_proposed'; hypothesis: ScientificHypothesis }
  | {
    kind: 'hypothesis_certified'
    hypothesis_id: string
    transition_count: number
    timeline_sha256: string
    retrodictions: Retrodiction[]
  }
  | { kind: 'actions_committed'; plan: ScientificPlan }
  | { kind: 'prediction_matched'; transition: PlannedActionTransition }
  | { kind: 'plan_completed'; transition: PlannedActionTransition }
  | {
    kind: 'prediction_mismatch'
    plan_id: string
    transition: PlannedActionTransition
    counterexample: Counterexample
  }

export type ScientificEventKind = ScientificEventPayload['kind']

export type ScientificEventEnvelope = ScientificEventPayload & {
  schema: 'mykrobial.scientific-run-event.v1'
  run_id: string
  harness_generation: HarnessGeneration
  loadout_id: 'scientific-retrodiction-v1'
  event_sequence: number
  previous_event_sha256: string | null
  event_sha256: string
}

export interface ScientificRunState {
  schema: 'mykrobial.scientific-run.v1'
  run_id: string
  task_ref: string
  harness_generation: HarnessGeneration
  loadout_id: 'scientific-retrodiction-v1'
  initial_observation_sha256: string
  current_observation_sha256: string
  max_real_actions: number
  real_actions_used: number
  reset_count: number
  escalation_policy: EscalationPolicy
  timeline: ScientificTransition[]
  hypotheses: Record<string, ScientificHypothesis>
  plans: Record<string, ScientificPlan>
}

export interface ScientificProjectionState {
  current: ScientificRunState | null
  events: ScientificEventEnvelope[]
  failure: string | null
}

export interface ScientificBehaviorProjection {
  schema: 'mykrobial.scientific-behavior-projection.v1'
  state: Omit<ScientificRunState, 'schema' | 'run_id' | 'harness_generation'>
  events: Array<Omit<ScientificEventEnvelope,
    'schema' | 'run_id' | 'harness_generation' | 'event_sequence' | 'previous_event_sha256' | 'event_sha256'>>
}

export interface ScientificCheckpoint {
  schema: 'mykrobial.scientific-run-checkpoint.v1'
  state: ScientificRunState
  events: ScientificEventEnvelope[]
  non_claims: string[]
  checkpoint_sha256: string
}

export interface StartScientificRunRequest {
  run_id: string
  task_ref: string
  harness_generation: HarnessGeneration
  initial_observation_sha256: string
  max_real_actions: number
  simulator_after_actions?: number
  novelty_after_actions?: number
  simulator_after_resets?: number
}

export interface RecordProbeRequest {
  action_sha256: string
  observed_observation_sha256: string
  purpose: string
}

export interface RecordDiscriminatingProbeRequest {
  action_sha256: string
  predictions: Record<string, string>
  observed_observation_sha256: string
}

export interface ProposeHypothesisRequest {
  hypothesis_id: string
  state_schema_sha256: string
  mechanism_sha256: string
  goal_predicate_sha256: string
  mechanism_kind?: MechanismKind
}

export interface CertifyHypothesisRequest {
  hypothesis_id: string
  retrodictions: Retrodiction[]
}

export interface CommitActionsRequest {
  hypothesis_id: string
  actions: ExpectedAction[]
}

export interface RecordActionResultRequest {
  plan_id: string
  action_index: number
  observed_observation_sha256: string
}

// Keep the merge-extensible event and projection declarations in the pure
// contract module. Re-exporting this module from the package root preserves
// the augmentation edge in the emitted declaration graph.
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Durable initialization adapter event. It is excluded from behavior equivalence. */
    'mykrobial/scientific/start': ScientificStart
    /** One event in the shared generation-neutral scientific event vocabulary. */
    'mykrobial/scientific/event': ScientificEventEnvelope
  }
}

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    mykrobialScientific: ScientificProjectionState
  }
  interface SessionProjectionMap {
    mykrobialScientific: ScientificBehaviorProjection | null
  }
}
