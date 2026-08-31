/** Pure shared domain signal and proposal-only intervention constructors. */
import { createHash } from 'node:crypto'

export const REGISTRY_SHA256 = 'dd84971b0d9350921326d9711c5022ff5cf2bc1d80e52df024316eacc03a296f'
export const DOMAINS = [
  'biofoundry', 'customer_support', 'economics', 'engineering', 'finance',
  'future_domain_template', 'hr', 'marketing', 'product', 'science',
] as const
export const INTERVENTION_ORDER = ['weights', 'harness', 'memory_skill', 'tool', 'no_op'] as const

export type Domain = typeof DOMAINS[number]
export type InterventionClass = typeof INTERVENTION_ORDER[number]
export type RewardDirection = 'maximize' | 'minimize' | 'constraint'
export type RewardAggregation = 'mean' | 'sum' | 'median' | 'minimum' | 'maximum'
export type CounterfactualDesign = 'randomized' | 'matched_control' | 'difference_in_differences' | 'geo_holdout' | 'natural_experiment'
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted'
export type CausalMethod = 'randomized' | 'matched_control' | 'difference_in_differences' | 'natural_experiment'

export interface DomainLearningSignalInput {
  signal_id: string
  trajectory_event_id: string
  domain: Domain
  reward_signal: string | null
  reward_definition: {
    direction: RewardDirection
    unit: string
    aggregation: RewardAggregation
    value: number | null
  } | null
  provenance: {
    source_class: 'human' | 'provider' | 'tool' | 'environment' | 'evaluator' | 'derived' | 'unavailable'
    source_event_ids: string[]
    evidence_sha256: string[]
    observed_at: string
    delay_seconds: number
    delayed_final: boolean
    tenant_id: string
    privacy: DataClassification
  }
  max_delay_seconds: number
  counterfactual_design: CounterfactualDesign | null
  data_classification: DataClassification | null
  causal_method: CausalMethod | null
  minimum_confidence: number
  maximum_uncertainty_width: number
  uncertainty: {
    lower: number | null
    point: number | null
    upper: number | null
    confidence: number | null
    basis: 'measured' | 'estimated' | 'declared_unverified' | 'unavailable'
  }
  evaluator: { evaluator_id: string; evaluator_sha256: string }
  allowed_interventions: InterventionClass[]
  applicability_state: 'proposal_only' | 'no_op'
}

export type DomainLearningSignalEvent = DomainLearningSignalInput & {
  schema: 'mykrobial.harness.domain-learning-signal-event.v1'
  registry_sha256: typeof REGISTRY_SHA256
  evaluator: DomainLearningSignalInput['evaluator'] & { hidden_promotion_cells_exposed: false }
  authority: { training_authorized: false; promotion_authorized: false; application_authorized: false }
  signal_sha256: string
}

export interface ArtifactRef {
  ref: string
  sha256: string
  bytes: number
  media_type: string
  storage_class: 'public' | 'restricted' | 'provider_opaque' | 'external'
}

export interface DomainInterventionProposal {
  schema: 'mykrobial.harness.domain-intervention-proposal.v1'
  registry_sha256: typeof REGISTRY_SHA256
  proposal_id: string
  signal_ids: string[]
  intervention_order: InterventionClass[]
  intervention_class: InterventionClass
  intervention_rank: number
  target_component_id: string
  candidate_delta_ref: ArtifactRef
  expected_result_sha256: string
  falsifier_sha256: string
  evaluation_epoch_ref: ArtifactRef
  state: 'proposed_unapplied'
  authority: {
    training_authorized: false
    promotion_authorized: false
    application_authorized: false
    deployment_authorized: false
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA = /^[0-9a-f]{64}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('typed_blocker:learning_signal_nonfinite_number')
    return value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) output[key] = normalize(child)
    }
    return output
  }
  throw new Error('typed_blocker:learning_signal_value_invalid')
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalize(value)), 'utf8').digest('hex')
}

function id(value: string, blocker: string): string {
  if (!ID.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function digest(value: string, blocker: string): string {
  if (!SHA.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function unique<T extends string>(values: readonly T[], blocker: string): T[] {
  const copy = [...values].sort()
  if (new Set(copy).size !== copy.length) throw new Error(`typed_blocker:${blocker}`)
  return copy
}

function finiteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value)
}

export function buildDomainLearningSignal(source: DomainLearningSignalInput): DomainLearningSignalEvent {
  const input = structuredClone(source)
  id(input.signal_id, 'learning_signal_identity_invalid')
  id(input.trajectory_event_id, 'learning_signal_trajectory_identity_invalid')
  if (!DOMAINS.includes(input.domain)) throw new Error('typed_blocker:learning_signal_domain_invalid')
  if (!UTC.test(input.provenance.observed_at)
    || !Number.isSafeInteger(input.provenance.delay_seconds) || input.provenance.delay_seconds < 0
    || !Number.isSafeInteger(input.max_delay_seconds) || input.max_delay_seconds < 0
    || input.provenance.delay_seconds > input.max_delay_seconds) {
    throw new Error('typed_blocker:learning_signal_delay_or_provenance_invalid')
  }
  input.provenance.source_event_ids = unique(input.provenance.source_event_ids.map(value => id(value, 'learning_signal_source_identity_invalid')), 'learning_signal_source_identity_invalid')
  input.provenance.evidence_sha256 = unique(input.provenance.evidence_sha256.map(value => digest(value, 'learning_signal_evidence_digest_invalid')), 'learning_signal_evidence_digest_invalid')
  id(input.provenance.tenant_id, 'learning_signal_tenant_identity_invalid')
  id(input.evaluator.evaluator_id, 'learning_signal_evaluator_identity_invalid')
  digest(input.evaluator.evaluator_sha256, 'learning_signal_evaluator_digest_invalid')
  if (!Number.isFinite(input.minimum_confidence) || input.minimum_confidence < 0 || input.minimum_confidence > 1
    || !Number.isFinite(input.maximum_uncertainty_width) || input.maximum_uncertainty_width < 0
    || !finiteOrNull(input.uncertainty.lower) || !finiteOrNull(input.uncertainty.point)
    || !finiteOrNull(input.uncertainty.upper)
    || (input.uncertainty.confidence !== null && (
      !Number.isFinite(input.uncertainty.confidence)
      || input.uncertainty.confidence < 0 || input.uncertainty.confidence > 1
    ))) throw new Error('typed_blocker:learning_signal_uncertainty_invalid')
  if (input.uncertainty.lower !== null && input.uncertainty.upper !== null
    && input.uncertainty.upper - input.uncertainty.lower > input.maximum_uncertainty_width) {
    throw new Error('typed_blocker:learning_signal_uncertainty_width_exceeded')
  }
  input.allowed_interventions = unique(input.allowed_interventions, 'learning_signal_interventions_invalid')
  if (input.allowed_interventions.some(value => !INTERVENTION_ORDER.includes(value))) {
    throw new Error('typed_blocker:learning_signal_interventions_invalid')
  }
  if (input.domain === 'future_domain_template') {
    if (input.reward_signal !== null || input.reward_definition !== null
      || input.max_delay_seconds !== 0 || input.counterfactual_design !== null
      || input.data_classification !== null || input.causal_method !== null
      || input.minimum_confidence !== 1 || input.maximum_uncertainty_width !== 0
      || input.applicability_state !== 'no_op'
      || input.allowed_interventions.length !== 1 || input.allowed_interventions[0] !== 'no_op') {
      throw new Error('typed_blocker:future_domain_signal_must_be_no_op')
    }
  } else {
    if (input.reward_signal === null || input.reward_definition === null
      || input.counterfactual_design === null || input.data_classification === null
      || input.causal_method === null || input.applicability_state !== 'proposal_only') {
      throw new Error('typed_blocker:learning_signal_named_domain_incomplete')
    }
    id(input.reward_signal, 'learning_signal_reward_identity_invalid')
    if (!finiteOrNull(input.reward_definition.value)) throw new Error('typed_blocker:learning_signal_nonfinite_number')
  }
  const body = {
    ...input,
    schema: 'mykrobial.harness.domain-learning-signal-event.v1' as const,
    registry_sha256: REGISTRY_SHA256 as typeof REGISTRY_SHA256,
    evaluator: { ...input.evaluator, hidden_promotion_cells_exposed: false as const },
    authority: {
      training_authorized: false as const,
      promotion_authorized: false as const,
      application_authorized: false as const,
    },
  }
  return { ...body, signal_sha256: hash(body) }
}

export function buildInterventionProposal(input: Omit<
  DomainInterventionProposal,
  'schema' | 'registry_sha256' | 'intervention_order' | 'intervention_rank' | 'state' | 'authority'
>): DomainInterventionProposal {
  id(input.proposal_id, 'intervention_proposal_identity_invalid')
  input.signal_ids = unique(input.signal_ids.map(value => id(value, 'intervention_signal_identity_invalid')), 'intervention_signal_identity_invalid')
  if (input.signal_ids.length === 0) throw new Error('typed_blocker:intervention_signal_identity_invalid')
  const interventionRank = INTERVENTION_ORDER.indexOf(input.intervention_class)
  if (interventionRank < 0) throw new Error('typed_blocker:intervention_class_invalid')
  id(input.target_component_id, 'intervention_target_identity_invalid')
  digest(input.expected_result_sha256, 'intervention_expected_result_invalid')
  digest(input.falsifier_sha256, 'intervention_falsifier_invalid')
  for (const artifact of [input.candidate_delta_ref, input.evaluation_epoch_ref]) {
    digest(artifact.sha256, 'intervention_artifact_digest_invalid')
    if (artifact.ref.length === 0 || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
      throw new Error('typed_blocker:intervention_artifact_invalid')
    }
  }
  return {
    ...structuredClone(input),
    schema: 'mykrobial.harness.domain-intervention-proposal.v1',
    registry_sha256: REGISTRY_SHA256,
    intervention_order: [...INTERVENTION_ORDER],
    intervention_rank: interventionRank,
    state: 'proposed_unapplied',
    authority: {
      training_authorized: false,
      promotion_authorized: false,
      application_authorized: false,
      deployment_authorized: false,
    },
  }
}
