import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DOMAINS,
  INTERVENTION_ORDER,
  REGISTRY_SHA256,
  buildDomainLearningSignal,
  buildInterventionProposal,
  type DomainLearningSignalInput,
} from '../src/index.ts'

const digest = (letter: string): string => letter.repeat(64)

function signal(domain: DomainLearningSignalInput['domain'] = 'engineering'): DomainLearningSignalInput {
  return {
    signal_id: 'signal-one',
    trajectory_event_id: 'event-one',
    domain,
    reward_signal: 'correctness',
    reward_definition: { direction: 'maximize', unit: 'fraction', aggregation: 'mean', value: 0.8 },
    provenance: {
      source_class: 'evaluator', source_event_ids: ['event-one'], evidence_sha256: [digest('a')],
      observed_at: '2026-08-31T00:00:00Z', delay_seconds: 1, delayed_final: true,
      tenant_id: 'tenant-one', privacy: 'restricted',
    },
    max_delay_seconds: 7776000,
    counterfactual_design: 'matched_control',
    data_classification: 'restricted',
    causal_method: 'matched_control',
    minimum_confidence: 0.8,
    maximum_uncertainty_width: 0.35,
    uncertainty: { lower: 0.7, point: 0.8, upper: 0.9, confidence: 0.95, basis: 'measured' },
    evaluator: { evaluator_id: 'evaluator-one', evaluator_sha256: digest('b') },
    allowed_interventions: ['weights', 'harness', 'memory_skill', 'tool', 'no_op'],
    applicability_state: 'proposal_only',
  }
}

test('public registry identities and intervention order are exact', () => {
  assert.equal(REGISTRY_SHA256, 'dd84971b0d9350921326d9711c5022ff5cf2bc1d80e52df024316eacc03a296f')
  assert.deepEqual(DOMAINS, ['biofoundry', 'customer_support', 'economics', 'engineering', 'finance', 'future_domain_template', 'hr', 'marketing', 'product', 'science'])
  assert.deepEqual(INTERVENTION_ORDER, ['weights', 'harness', 'memory_skill', 'tool', 'no_op'])
})

test('named domain signal preserves registry dimensions and grants no authority', () => {
  const event = buildDomainLearningSignal(signal())
  assert.equal(event.reward_definition?.direction, 'maximize')
  assert.equal(event.provenance.delay_seconds, 1)
  assert.equal(event.max_delay_seconds, 7776000)
  assert.equal(event.counterfactual_design, 'matched_control')
  assert.equal(event.data_classification, 'restricted')
  assert.equal(event.causal_method, 'matched_control')
  assert.equal(event.evaluator.hidden_promotion_cells_exposed, false)
  assert.deepEqual(event.authority, {
    training_authorized: false, promotion_authorized: false, application_authorized: false,
  })
})

test('future domain template is empty and no-op only', () => {
  const future = signal('future_domain_template')
  future.reward_signal = null
  future.reward_definition = null
  future.max_delay_seconds = 0
  future.provenance.delay_seconds = 0
  future.counterfactual_design = null
  future.data_classification = null
  future.causal_method = null
  future.minimum_confidence = 1
  future.maximum_uncertainty_width = 0
  future.uncertainty = { lower: null, point: null, upper: null, confidence: null, basis: 'unavailable' }
  future.allowed_interventions = ['no_op']
  future.applicability_state = 'no_op'
  assert.equal(buildDomainLearningSignal(future).applicability_state, 'no_op')
  const invalid = signal('future_domain_template')
  assert.throws(() => buildDomainLearningSignal(invalid), /future_domain_signal_must_be_no_op/)
})

test('delay and uncertainty thresholds fail closed', () => {
  const late = signal()
  late.provenance.delay_seconds = late.max_delay_seconds + 1
  assert.throws(() => buildDomainLearningSignal(late), /delay_or_provenance/)
  const wide = signal()
  wide.uncertainty = { lower: 0, point: 0.5, upper: 1, confidence: 0.95, basis: 'measured' }
  assert.throws(() => buildDomainLearningSignal(wide), /uncertainty_width_exceeded/)
})

test('intervention ranks follow the exact registry order and remain proposal-only', () => {
  const base = {
    proposal_id: 'proposal-one', signal_ids: ['signal-one'],
    target_component_id: 'component-one',
    candidate_delta_ref: { ref: 'outputs/delta.json', sha256: digest('c'), bytes: 10, media_type: 'application/json', storage_class: 'restricted' as const },
    expected_result_sha256: digest('d'), falsifier_sha256: digest('e'),
    evaluation_epoch_ref: { ref: 'outputs/epoch.json', sha256: digest('f'), bytes: 10, media_type: 'application/json', storage_class: 'restricted' as const },
  }
  for (const [rank, intervention_class] of INTERVENTION_ORDER.entries()) {
    const proposal = buildInterventionProposal({ ...base, intervention_class })
    assert.equal(proposal.intervention_rank, rank)
    assert.equal(proposal.state, 'proposed_unapplied')
    assert.equal(Object.values(proposal.authority).every(value => value === false), true)
  }
})

test('signal identity is deterministic and rejects non-finite rewards', () => {
  assert.equal(buildDomainLearningSignal(signal()).signal_sha256, buildDomainLearningSignal(signal()).signal_sha256)
  const invalid = signal()
  invalid.reward_definition!.value = Number.POSITIVE_INFINITY
  assert.throws(() => buildDomainLearningSignal(invalid), /nonfinite/)
})
