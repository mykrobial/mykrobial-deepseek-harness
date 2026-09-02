import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ROOT = new URL('../../../../', import.meta.url)
const BINDING = 'contracts/mykrobial/evidence/retrodict-first-class-loadout.binding.v1.json'

function raw(path: string): Uint8Array {
  return readFileSync(new URL(path, ROOT))
}

function json<T>(path: string): T {
  return JSON.parse(new TextDecoder().decode(raw(path))) as T
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

interface Binding {
  schema: string
  status: string
  source: {
    candidate_commit: string
    candidate_tree: string
    review_seal_commit: string
    review_seal_tree: string
    fresh_critic_sha256: string
    bundle_sha256: string
    decision: string
  }
  copied_public_artifacts: Array<{ kind: string; path: string; sha256: string }>
  parity_shape: {
    requirement_id: string
    compiler_entrypoint: string
    primary_source_commit: string
    mechanism_order: string[]
  }
  native_correspondence: Array<{
    mechanism: string
    native_source: string
    native_symbol: string
    state: string
  }>
  semantic_differences_requiring_successor: string[]
  next_generation_boundary: Record<string, boolean | string>
  authority: Record<string, boolean>
}

interface Contract {
  schema: string
  capability_id: string
  reviewed: boolean
  production_authorized: boolean
  gate_ready: boolean
  environment_contract: {
    compiler_entrypoint: string
    required_primary_source_refs: string[]
    mechanism_order: string[]
  }
}

interface SourceAuthority {
  schema: string
  repository: string
  commit: string
  refs: string[]
  reviewed: boolean
}

interface FixtureStep {
  index: number
  expected_state: string
  observed_state: string
  observation_logged: boolean
  hypothesis_checked: boolean
  live_action_spent: boolean
  mismatch: boolean
  simulator_called: boolean
}

interface Fixture {
  schema: string
  playbook_before_reset_sha256: string
  playbook_after_resume_sha256: string
  reset_resume: boolean
  steps: FixtureStep[]
  stuck_trials: Array<{ attempt: number; simulator_called: boolean }>
}

const MECHANISMS = [
  'snapshot_log_history_paper_pencil',
  'log_as_context',
  'history_retrodiction_gate',
  'expected_action_queue',
  'first_mismatch_stop_divergence',
  'persistent_playbook_reset_resume',
  'stuck_threshold_simulator_search',
  'bounded_containment',
]

const SOURCE_REFS = [
  'README.md',
  'src/arc3/prompts.py',
  'src/arc3/plan_parser.py',
  'src/arc3/runner.py',
  'src/arc3/logwriter.py',
]

test('accepted RetroDICT public artifacts retain exact source bytes', () => {
  const binding = json<Binding>(BINDING)
  assert.equal(binding.schema, 'mykrobial.next-deepseek-cordis.retrodict-first-class-loadout-binding.v1')
  assert.equal(binding.status, 'accepted_public_contract_provenance_and_fixture_bound_unmounted')
  assert.equal(binding.source.candidate_commit, 'a26125668b1c489bf9c2c5d6c37f80c72d3f007c')
  assert.equal(binding.source.candidate_tree, '0fbb2c94d1dc72c1fb8da886dc5eef31af2c6d5c')
  assert.equal(binding.source.review_seal_commit, '90e18ce69df607fdbd6c0558d4792924e61eb9f7')
  assert.equal(binding.source.review_seal_tree, 'cfe982de0a82753f00dd869171d06e9c9a97abd7')
  assert.equal(binding.source.fresh_critic_sha256, 'e6eb6fe354cf6f93b85a945b365a60bd877ab0c4bac857bb72448d919d3ef80c')
  assert.equal(binding.source.bundle_sha256, 'b5ccc81eba934e7a1209a848f9eee24184f51b081c2356b2dd5b3d8ea0934305')
  assert.equal(binding.source.decision, 'accept_source_only')
  assert.equal(binding.copied_public_artifacts.length, 3)
  for (const artifact of binding.copied_public_artifacts) {
    assert.equal(sha256(raw(artifact.path)), artifact.sha256, artifact.path)
  }
})

test('contract and primary-source authority bind exact compiler refs and mechanism order', () => {
  const binding = json<Binding>(BINDING)
  const contract = json<Contract>('contracts/mykrobial/retrodict-first-class-loadout.v1.json')
  const source = json<SourceAuthority>('contracts/mykrobial/evidence/retrodict-v28/source-authority.v1.json')

  assert.equal(contract.schema, 'mykrobial.ucp.capability_contract.v2.1')
  assert.equal(contract.capability_id, 'compose__retrodict_first_class_loadout')
  assert.equal(contract.reviewed, false)
  assert.equal(contract.production_authorized, false)
  assert.equal(contract.gate_ready, false)
  assert.equal(contract.environment_contract.compiler_entrypoint, 'retrodict_loadout_v1.compile_retrodict_loadout')
  assert.deepEqual(contract.environment_contract.required_primary_source_refs, SOURCE_REFS)
  assert.deepEqual(contract.environment_contract.mechanism_order, MECHANISMS)

  assert.equal(source.schema, 'mykrobial.retrodict.source-authority.v1')
  assert.equal(source.repository, 'https://github.com/ryanbbrown/Retrodict')
  assert.equal(source.commit, '71672e8e5adb008360f52a61ef9e2adf91a62d89')
  assert.deepEqual(source.refs, SOURCE_REFS)
  assert.equal(source.reviewed, false)
  assert.equal(binding.parity_shape.requirement_id, 'retrodict_first_class_loadout')
  assert.equal(binding.parity_shape.compiler_entrypoint, contract.environment_contract.compiler_entrypoint)
  assert.equal(binding.parity_shape.primary_source_commit, source.commit)
  assert.deepEqual(binding.parity_shape.mechanism_order, MECHANISMS)
})

test('deterministic fixture preserves mismatch reset resume and bounded escalation evidence', () => {
  const fixture = json<Fixture>('contracts/mykrobial/evidence/retrodict-v28/deterministic-state-fixture.v1.json')
  assert.equal(fixture.schema, 'mykrobial.retrodict.deterministic-state-fixture.v1')
  assert.equal(fixture.reset_resume, true)
  assert.equal(fixture.playbook_before_reset_sha256, fixture.playbook_after_resume_sha256)
  assert.equal(fixture.steps.length, 2)
  assert.deepEqual(fixture.steps.map(row => row.index), [0, 1])
  assert.equal(fixture.steps.every(row => row.observation_logged && row.hypothesis_checked), true)
  assert.equal(fixture.steps[0]?.expected_state, fixture.steps[0]?.observed_state)
  assert.equal(fixture.steps[0]?.live_action_spent, true)
  assert.equal(fixture.steps[0]?.mismatch, false)
  assert.notEqual(fixture.steps[1]?.expected_state, fixture.steps[1]?.observed_state)
  assert.equal(fixture.steps[1]?.live_action_spent, false)
  assert.equal(fixture.steps[1]?.mismatch, true)
  assert.equal(fixture.steps.every(row => row.simulator_called === false), true)
  assert.deepEqual(fixture.stuck_trials, [
    { attempt: 1, simulator_called: false },
    { attempt: 2, simulator_called: false },
    { attempt: 3, simulator_called: true },
  ])
})

test('native correspondence is exhaustive while unresolved semantics and authority remain explicit', () => {
  const binding = json<Binding>(BINDING)
  assert.deepEqual(binding.native_correspondence.map(row => row.mechanism), MECHANISMS)
  assert.equal(new Set(binding.native_correspondence.map(row => row.mechanism)).size, MECHANISMS.length)
  assert.equal(binding.native_correspondence.every(row => row.native_source.startsWith('packages/mykrobial/scientific-retrodiction/src/')), true)
  assert.equal(binding.native_correspondence.every(row => row.native_symbol.length > 0 && row.state.length > 0), true)
  assert.equal(binding.semantic_differences_requiring_successor.length, 4)
  assert.equal(binding.next_generation_boundary.public_contract_provenance_and_fixture_available, true)
  assert.equal(binding.next_generation_boundary.current_production_runtime_implementation_copied, false)
  assert.equal(binding.next_generation_boundary.native_cordis_service_replaced, false)
  assert.equal(binding.next_generation_boundary.loadout_mounted_or_executed, false)
  assert.equal(binding.next_generation_boundary.exact_behavioral_parity_claimed, false)
  assert.equal(
    Object.entries(binding.authority).every(([key, value]) => key === 'source_binding_authorized' ? value : value === false),
    true,
  )
})
