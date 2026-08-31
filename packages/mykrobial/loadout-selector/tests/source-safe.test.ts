import assert from 'node:assert/strict'
import test from 'node:test'
import {
  planDynamicLoadout,
  type LoadoutPolicy,
  type OrganDescriptor,
  type TaskDiagnosis,
} from '../src/index.ts'

const policy: LoadoutPolicy = {
  policy_id: 'retrodict-cost-policy-v1',
  base_organ_ids: ['scientific-core', 'omniroute-route', 'trace-intent'],
  simulator_capabilities: ['simulator_search'],
  novelty_capabilities: ['novelty_discovery'],
}

const organs: OrganDescriptor[] = [
  {
    organ_id: 'scientific-core', logical_identity: 'scientific-retrodiction',
    capabilities: ['retrodict'], dependency_ids: [], cost_class: 'zero', source_state: 'verified',
    reversible_lifecycle_tested: true, activation_admission: 'admitted',
  },
  {
    organ_id: 'omniroute-route', logical_identity: 'model-route',
    capabilities: ['model_routing'], dependency_ids: [], cost_class: 'low', source_state: 'verified',
    reversible_lifecycle_tested: true, activation_admission: 'admitted',
  },
  {
    organ_id: 'trace-intent', logical_identity: 'trace-v2-3-intent',
    capabilities: ['trace_projection'], dependency_ids: [], cost_class: 'zero', source_state: 'verified',
    reversible_lifecycle_tested: true, activation_admission: 'admitted',
  },
  {
    organ_id: 'read-tool', logical_identity: 'read-tool', capabilities: ['source_read'],
    dependency_ids: [], cost_class: 'low', source_state: 'verified', reversible_lifecycle_tested: true,
    activation_admission: 'admitted',
  },
  {
    organ_id: 'full-toolbox', logical_identity: 'full-toolbox', capabilities: ['source_read', 'browser', 'shell'],
    dependency_ids: [], cost_class: 'high', source_state: 'verified', reversible_lifecycle_tested: true,
    activation_admission: 'admitted',
  },
  {
    organ_id: 'simulator-provider', logical_identity: 'simulator-provider', capabilities: ['simulator'],
    dependency_ids: [], cost_class: 'medium', source_state: 'verified', reversible_lifecycle_tested: true,
    activation_admission: 'admitted',
  },
  {
    organ_id: 'simulator-search', logical_identity: 'simulator-search', capabilities: ['simulator_search'],
    dependency_ids: ['simulator-provider'], cost_class: 'medium', source_state: 'verified',
    reversible_lifecycle_tested: true, activation_admission: 'admitted',
  },
  {
    organ_id: 'novelty-discovery', logical_identity: 'novelty-discovery', capabilities: ['novelty_discovery'],
    dependency_ids: ['simulator-search'], cost_class: 'high', source_state: 'verified',
    reversible_lifecycle_tested: true, activation_admission: 'admitted',
  },
  {
    organ_id: 'unreviewed-camera', logical_identity: 'camera', capabilities: ['camera'],
    dependency_ids: [], cost_class: 'low', source_state: 'candidate', reversible_lifecycle_tested: false,
    activation_admission: 'not_requested',
  },
]

function diagnosis(capabilities: string[], maximum = 20): TaskDiagnosis {
  return {
    diagnosis_id: 'diagnosis-one',
    task_class: 'software',
    required_capabilities: capabilities,
    uncertainty: 0.2,
    maximum_cost_score: maximum,
  }
}

test('default loadout chooses the cheapest sufficient organ rather than the full toolbox', () => {
  const result = planDynamicLoadout({
    diagnosis: diagnosis(['source_read']), posture: 'retrodict_default', policy, organs,
  })
  assert.equal(result.activation_state, 'planned_unactivated')
  assert.equal(result.selected_organ_ids.includes('read-tool'), true)
  assert.equal(result.selected_organ_ids.includes('full-toolbox'), false)
  assert.deepEqual(result.unresolved_capabilities, [])
})

test('simulator organs and their dependencies mount only after simulator escalation', () => {
  const cheap = planDynamicLoadout({
    diagnosis: diagnosis([]), posture: 'retrodict_default', policy, organs,
  })
  assert.equal(cheap.selected_organ_ids.includes('simulator-search'), false)
  const escalated = planDynamicLoadout({
    diagnosis: diagnosis([]), posture: 'retrodict_simulator_escalated', policy, organs,
  })
  assert.equal(escalated.selected_organ_ids.includes('simulator-search'), true)
  assert.equal(escalated.selected_organ_ids.includes('simulator-provider'), true)
})

test('novelty escape is a later additive loadout, not the default', () => {
  const result = planDynamicLoadout({
    diagnosis: diagnosis([]), posture: 'retrodict_novelty_escape', policy, organs,
  })
  assert.equal(result.selected_organ_ids.includes('novelty-discovery'), true)
  assert.equal(result.selected_organ_ids.includes('simulator-search'), true)
})

test('unadmitted organs fail closed and uncovered capabilities stay explicit', () => {
  const result = planDynamicLoadout({
    diagnosis: diagnosis(['camera']), posture: 'retrodict_default', policy, organs,
  })
  assert.equal(result.activation_state, 'blocked')
  assert.deepEqual(result.unresolved_capabilities, ['camera'])
  assert.equal(result.rejected_organs['unreviewed-camera'], 'typed_blocker:loadout_organ_source_unverified')
})

test('cost overflow blocks activation even when capability coverage is complete', () => {
  const result = planDynamicLoadout({
    diagnosis: diagnosis(['browser', 'shell'], 5), posture: 'retrodict_default', policy, organs,
  })
  assert.equal(result.selected_organ_ids.includes('full-toolbox'), true)
  assert.equal(result.activation_state, 'blocked')
  assert.equal(result.unresolved_capabilities.includes('cost_budget'), true)
})

test('selection identity and manifest hash are deterministic', () => {
  const input = { diagnosis: diagnosis(['source_read']), posture: 'retrodict_default' as const, policy, organs }
  assert.deepEqual(planDynamicLoadout(input), planDynamicLoadout(input))
})
