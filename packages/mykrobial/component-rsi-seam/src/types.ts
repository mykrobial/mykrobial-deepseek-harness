/** Types for source-only, per-component recursive-improvement planning. */

/** Independently versioned and experimentally replaceable harness surface. */
export type MutationSurfaceId =
  | 'prompt'
  | 'skill_card'
  | 'ontology_edge_or_function'
  | 'router'
  | 'workflow'
  | 'memory'
  | 'tool'
  | 'model_route'
  | 'model_adapter'
  | 'model_weights'
  | 'harness'
  | 'guardrail'
  | 'ui_projection'
  | 'loadout'

/** Proposal-producing plane; this package does not implement any plane. */
export type EvolutionPlane = 'online' | 'local_idle' | 'frontier' | 'future_joint'

/** Exact source identity shared with the public Harness parity schemas. */
export interface SourceIdentity {
  repository: string
  commit: string
  tree: string
  dirty_state: 'clean' | 'dirty_bound' | 'unknown'
  configuration_sha256: string
}

/** One row in the canonical mutation-surface registry. */
export interface MutationSurfacePolicy {
  surface_id: MutationSurfaceId
  independently_versioned: true
  independently_swappable: true
  per_task_experiment_allowed: true
  allowed_planes: EvolutionPlane[]
  training_gate_required: boolean
  runtime_application_authority_required: true
  trace_projection_required: true
}

/** Immutable source-only mutation-surface registry. */
export interface MutationSurfaceRegistry {
  schema: 'mykrobial.harness.component-mutation-surface-registry.v1'
  registry_id: 'next-deepseek-cordis-component-surfaces-v1'
  surfaces: MutationSurfacePolicy[]
  registry_sha256: string
}

/** One component-specific delta within a proposal. */
export interface MutationTarget {
  component_id: string
  surface_id: MutationSurfaceId
  base_component_identity_sha256: string
  candidate_component_identity_sha256: string
  delta_sha256: string
}

/** Input accepted by the pure mutation-proposal constructor. */
export interface PrepareMutationProposalInput {
  proposal_id: string
  plane: EvolutionPlane
  task_capsule_id: string
  loadout_id: string
  source: SourceIdentity
  context_pack_sha256: string
  optimizer_input_sha256: string
  targets: MutationTarget[]
  joint_delta_declaration_sha256: string | null
  created_at: string
}

/** Content-addressed proposal that grants no execution or promotion authority. */
export interface ComponentMutationProposal extends PrepareMutationProposalInput {
  schema: 'mykrobial.harness.component-mutation-proposal.v1'
  harness_generation: 'next_deepseek_cordis'
  delta_mode: 'single_component' | 'declared_joint'
  target_set_sha256: string
  mutation_surface_registry_sha256: string
  status: 'proposal_only_untrusted'
  apply_authorized: false
  training_authorized: false
  promotion_authorized: false
  non_claims: string[]
  proposal_sha256: string
}

/** Immutable task and loadout facts for a matched experiment. */
export interface ExperimentTaskBinding {
  task_capsule_id: string
  task_capsule_sha256: string
  task_population_sha256: string
  loadout_id: string
  loadout_manifest_sha256: string
  seed: number
  task_order_sha256: string
}

/** Evaluator identity and anti-leakage facts frozen outside this package. */
export interface ExperimentEvaluatorBinding {
  evaluator_id: string
  evaluator_sha256: string
  evaluator_source_sha256: string
  candidate_visible: false
  frozen: true
}

/** Finite experiment budget expressed without floating-point currency. */
export interface ExperimentBudgetBinding {
  max_input_tokens: number
  max_output_tokens: number
  max_wall_ms: number
  max_monetary_microusd: number
  max_actions: number
}

/** Shared source and public-contract bindings used by every arm. */
export interface ExperimentSourceBinding {
  harness_source: SourceIdentity
  component_lifecycle_contract_sha256: string
  loadout_contract_sha256: string
  trajectory_contract_sha256: string
  trace_bridge_source_sha256: string
  mutation_surface_registry_sha256: string
}

/** One of the required BASE, TRUE, or SHAM experiment arms. */
export interface ComponentExperimentArm {
  arm_id: string
  role: 'BASE' | 'TRUE' | 'SHAM'
  control_strategy: 'unchanged_baseline' | 'candidate_delta' | 'placebo_delta'
  loadout_manifest_sha256: string
  component_set_sha256: string
  applied_delta_sha256: string
}

/** Input accepted by the pure experiment-capsule constructor. */
export interface PrepareExperimentCapsuleInput {
  capsule_id: string
  experiment_id: string
  proposal: ComponentMutationProposal
  task_binding: ExperimentTaskBinding
  evaluator_binding: ExperimentEvaluatorBinding
  budget_binding: ExperimentBudgetBinding
  source_binding: ExperimentSourceBinding
  arms: ComponentExperimentArm[]
  created_at: string
}

/** Frozen matched-cell experiment request; it is not an evaluator or runner. */
export interface ComponentExperimentCapsule {
  schema: 'mykrobial.harness.component-experiment-capsule.v1'
  capsule_id: string
  experiment_id: string
  proposal_id: string
  proposal_sha256: string
  plane: EvolutionPlane
  delta_mode: 'single_component' | 'declared_joint'
  target_component_ids: string[]
  target_surface_ids: MutationSurfaceId[]
  target_set_sha256: string
  task_binding: ExperimentTaskBinding
  evaluator_binding: ExperimentEvaluatorBinding
  budget_binding: ExperimentBudgetBinding
  source_binding: ExperimentSourceBinding
  arms: ComponentExperimentArm[]
  created_at: string
  status: 'prepared_unexecuted'
  evaluation_authorized: false
  training_authorized: false
  promotion_authorized: false
  non_claims: string[]
  capsule_sha256: string
}

/** Untrusted optimizer or promotion recommendation received from another lane. */
export interface ExternalComponentDecisionInput {
  decision_id: string
  capsule_id: string
  decision_kind: 'optimizer_recommendation' | 'promotion_recommendation' | 'rollback_recommendation'
  disposition: 'accept_candidate' | 'reject_candidate' | 'revise_candidate' | 'no_change' | 'rollback'
  issuer_id: string
  issuer_artifact_sha256: string
  decision_payload_sha256: string
  authority_receipt_sha256: string | null
  training_gate_receipt_sha256: string | null
  issued_at: string
}

/** Normalized external input that remains untrusted even when it names receipts. */
export interface ExternalComponentDecision extends ExternalComponentDecisionInput {
  schema: 'mykrobial.harness.external-component-decision.v1'
  trust_state: 'untrusted_external_input'
  authority_verified: false
  training_gate_verified: false
  apply_authorized: false
  promotion_authorized: false
  blockers: string[]
  non_claims: string[]
  external_input_sha256: string
}

/** Reconfiguration operation prepared but never applied by this package. */
export type ComponentPlanOperation = 'swap' | 'rollback' | 'replay'

/** Input accepted by the no-apply reconfiguration planner. */
export interface PrepareComponentPlanInput {
  operation: ComponentPlanOperation
  capsule: ComponentExperimentCapsule
  decision: ExternalComponentDecision
  current_component_snapshot_sha256: string
  current_loadout_manifest_sha256: string
  dependency_closure_sha256: string
  replay_receipt_sha256: string | null
  rollback_receipt_sha256: string | null
  requested_at: string
}

/** Hash-bound CORDIS lifecycle/loadout plan with application authority false. */
export interface ComponentReconfigurationPlan {
  schema: 'mykrobial.harness.component-reconfiguration-plan.v1'
  plan_id: string
  operation: ComponentPlanOperation
  capsule_id: string
  decision_id: string
  target_component_ids: string[]
  target_surface_ids: MutationSurfaceId[]
  component_lifecycle_contract: 'mykrobial.component-snapshot.v1'
  loadout_contract: 'mykrobial.harness.loadout-manifest.v1'
  component_lifecycle_contract_sha256: string
  loadout_contract_sha256: string
  current_component_snapshot_sha256: string
  current_loadout_manifest_sha256: string
  dependency_closure_sha256: string
  replay_receipt_sha256: string | null
  rollback_receipt_sha256: string | null
  steps: string[]
  blockers: string[]
  requested_at: string
  state: 'prepared_unexecuted'
  apply_authorized: false
  trace_append_authorized: false
  non_claims: string[]
  plan_sha256: string
}

/** Artifact pointer compatible with the public trajectory-event schema. */
export interface ArtifactRef {
  ref: string
  sha256: string
  bytes: number
  media_type: string
  storage_class: 'public' | 'restricted' | 'provider_opaque' | 'external'
}

/** Source-only experiment phase projected into the shared trajectory vocabulary. */
export type ComponentExperimentPhase =
  | 'proposal_prepared'
  | 'capsule_prepared'
  | 'evaluation_requested'
  | 'external_decision_received'
  | 'swap_planned'
  | 'rollback_planned'
  | 'replay_planned'
  | 'mismatch_observed'
  | 'no_change_selected'

/** Input accepted by the trajectory and Trace-intent projector. */
export interface ProjectExperimentLifecycleInput {
  phase: ComponentExperimentPhase
  capsule: ComponentExperimentCapsule
  event_id: string
  run_id: string
  trace_id: string
  session_id: string
  sequence: number
  previous_event_sha256: string
  occurred_at: string
  branch_id: string
  component_generation: number
  payload_ref: ArtifactRef
}

/** Public trajectory event emitted as data, without appending it. */
export interface ProjectedTrajectoryEvent {
  schema: 'mykrobial.harness.trajectory-event.v1'
  event_id: string
  run_id: string
  task_capsule_id: string
  loadout_id: string
  harness_generation: 'next_deepseek_cordis'
  sequence: number
  previous_event_sha256: string
  kind: 'hypothesis' | 'experiment' | 'model_revision' | 'plan' | 'mismatch' | 'checkpoint' | 'result'
  source_component_id: string
  occurred_at: string
  temporal: {
    transaction_time: string
    valid_from: null
    valid_until: null
    valid_time_basis: 'not_asserted'
    supersedes_event_id: null
    parent_event_id: null
    branch_id: string
    component_generation: number
    duration_ms: null
    deadline_at: null
    causality_state: 'not_asserted'
  }
  payload_sha256: string
  payload_ref: ArtifactRef
  component_ids: string[]
  cost: {
    input_tokens: null
    output_tokens: null
    cached_tokens: null
    monetary_usd: null
    energy_wh: null
    wall_ms: null
    human_minutes: null
    basis: 'unavailable'
  }
  proof: {
    source: { state: 'candidate'; receipt_refs: ArtifactRef[]; blocker: null }
    execution: { state: 'blocked'; receipt_refs: []; blocker: 'typed_blocker:component_experiment_execution_unadmitted' }
    review: { state: 'unavailable'; receipt_refs: []; blocker: 'typed_blocker:component_experiment_review_unavailable' }
    deployment: { state: 'unavailable'; receipt_refs: []; blocker: 'typed_blocker:component_experiment_deployment_unavailable' }
  }
  event_sha256: string
}

/** Exact metadata-only intent consumed by the existing Trace v2.3 bridge. */
export interface ComponentTraceV23Intent {
  schema: 'mykrobial.deepseek.trace-v2.3-intent.v1'
  target_schema: 'mykrobial.trace.v2.3.event.v1'
  target_schema_version: '2.3.0'
  trace_id: string
  session_id: string
  source_event_sha256: string
  source_event_sequence: number
  source_event_kind: string
  scope: 'root_run'
  phase: 'progress'
  content_mode: 'metadata_only'
  status: 'candidate_report_only'
  blocker: 'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted'
  non_claims: string[]
}

/** Paired trajectory and Trace intent with both append authorities false. */
export interface ComponentExperimentProjection {
  schema: 'mykrobial.harness.component-experiment-projection.v1'
  phase: ComponentExperimentPhase
  capsule_id: string
  trajectory_event: ProjectedTrajectoryEvent
  trace_v2_3_intent: ComponentTraceV23Intent
  trajectory_append_authorized: false
  trace_append_authorized: false
  non_claims: string[]
  projection_sha256: string
}
