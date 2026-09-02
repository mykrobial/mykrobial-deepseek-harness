import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ROOT = new URL('../../../../', import.meta.url)
const BINDING = 'contracts/mykrobial/evidence/rollback-replay-drift.binding.v1.json'

function raw(path: string): Uint8Array {
  return readFileSync(new URL(path, ROOT))
}

function json<T>(path: string): T {
  return JSON.parse(new TextDecoder().decode(raw(path))) as T
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonical(value)}\n`)
}

function prefixedHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain)
    .update(Uint8Array.of(0))
    .update(canonicalBytes(value))
    .digest('hex')
}

interface AuthorityAndCounts {
  authority: Record<string, boolean>
  execution_counts: Record<string, number>
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
    preservation_bundle_sha256: string
    decision: string
  }
  copied_public_artifacts: Array<{ kind: string; path: string; sha256: string }>
  parity_shape: {
    requirement_id: string
    scenario_id: string
    source_generation: number
    target_generation: number
    replay_generation_count: number
    source_checkpoint_sha256: string
    target_checkpoint_sha256: string
    drift_report_sha256: string
    required_invariants: string[]
  }
  next_generation_boundary: Record<string, boolean | string>
  authority: Record<string, boolean>
}

interface RollbackPlan {
  schema: string
  scenario_id: string
  source_generation: number
  target_generation: number
  source_checkpoint_sha256: string
  target_checkpoint_sha256: string
  replay_generation_count: number
  state: string
}

interface RestoreReceipt extends AuthorityAndCounts {
  schema: string
  target_generation: number
  source_checkpoint_sha256: string
  target_checkpoint_sha256: string
  original_ancestor_checkpoint_sha256: string
  byte_equal_original_ancestor: boolean
  receipt_sha256: string
}

interface ReplayReceipt extends AuthorityAndCounts {
  schema: string
  target_checkpoint_sha256: string
  expected_descendant_sha256: string
  replayed_descendant_sha256: string
  replayed_generation_count: number
  canonical_equal: boolean
  receipt_sha256: string
}

interface DriftReport extends AuthorityAndCounts {
  schema: string
  expected_checkpoint_sha256: string
  observed_checkpoint_sha256: string
  equivalent: boolean
  drift_fields: string[]
  validation_blocker: string | null
  report_sha256: string
}

interface DriftReceipt extends AuthorityAndCounts {
  schema: string
  compared_fields: string[]
  exact_branch_equivalent: boolean
  exact_branch_report: DriftReport
  fork_detected: boolean
  fork_report: DriftReport
}

interface RestartReceipt extends AuthorityAndCounts {
  schema: string
  scenario_id: string
  generation: number
  checkpoint_sha256: string
  accepted_exact_branch: boolean
  drift_report_sha256: string
  receipt_sha256: string
}

function assertNoOperations(value: AuthorityAndCounts): void {
  assert.equal(Object.values(value.authority).every(item => item === false), true)
  assert.equal(Object.values(value.execution_counts).every(item => item === 0), true)
}

function assertReceiptHash(value: Record<string, unknown>, domain: string, field = 'receipt_sha256'): void {
  const { [field]: declared, ...body } = value
  assert.equal(declared, prefixedHash(domain, body))
}

test('accepted rollback and replay artifacts retain exact source bytes', () => {
  const binding = json<Binding>(BINDING)
  assert.equal(binding.schema, 'mykrobial.next-deepseek-cordis.rollback-replay-drift-binding.v1')
  assert.equal(binding.status, 'accepted_public_contract_and_receipt_shape_bound_unexecuted')
  assert.equal(binding.source.candidate_commit, '741cd480b3c74d54b66ac30f56e0b3f9db778848')
  assert.equal(binding.source.candidate_tree, '05214ca44da83bdf074251f44bc0b028c2128ef7')
  assert.equal(binding.source.review_seal_commit, '4ca12a7ed9e9a5e02b219294e4c6c47c2ecff41d')
  assert.equal(binding.source.review_seal_tree, '60a656a942447d43be6e1e2cfeaca5848d0cfca3')
  assert.equal(binding.source.fresh_critic_sha256, '9036cf79ec68c0cdf54a07f548666b2231fada8840c479893d033ab31459e283')
  assert.equal(binding.source.preservation_bundle_sha256, '1588e759ae0fe1597d075f17ea18b2a5f40ae3a27c5e071cfa7ae2938b3ffff6')
  assert.equal(binding.source.decision, 'accept_source_only')
  assert.equal(binding.copied_public_artifacts.length, 8)
  for (const artifact of binding.copied_public_artifacts) {
    assert.equal(sha256(raw(artifact.path)), artifact.sha256, artifact.path)
  }

  const contract = json<Record<string, unknown>>('contracts/mykrobial/rollback-replay-drift.v1.json')
  assert.equal(contract.capability_id, 'verify__rollback_replay_drift')
  assert.equal(contract.harness_class, 'evaluation')
  assert.equal(contract.reviewed, false)
  assert.equal(contract.production_authorized, false)
  assert.equal(contract.gate_ready, false)
})

test('rollback plan joins exact restore and replay receipts', () => {
  const binding = json<Binding>(BINDING)
  const plan = json<RollbackPlan>('contracts/mykrobial/evidence/rollback-replay-v27/rollback-plan.v1.json')
  const restore = json<RestoreReceipt>('contracts/mykrobial/evidence/rollback-replay-v27/generation-restore.receipt.v1.json')
  const replay = json<ReplayReceipt>('contracts/mykrobial/evidence/rollback-replay-v27/replay-equivalence.receipt.v1.json')

  assert.equal(plan.schema, 'mykrobial.rollback-plan.v1')
  assert.equal(plan.scenario_id, binding.parity_shape.scenario_id)
  assert.equal(plan.source_generation, binding.parity_shape.source_generation)
  assert.equal(plan.target_generation, binding.parity_shape.target_generation)
  assert.equal(plan.replay_generation_count, binding.parity_shape.replay_generation_count)
  assert.equal(plan.source_checkpoint_sha256, binding.parity_shape.source_checkpoint_sha256)
  assert.equal(plan.target_checkpoint_sha256, binding.parity_shape.target_checkpoint_sha256)
  assert.equal(plan.state, 'source_simulation_complete_unexecuted')

  assert.equal(restore.schema, 'mykrobial.generation-restore-receipt.v1')
  assert.equal(restore.target_generation, plan.target_generation)
  assert.equal(restore.source_checkpoint_sha256, plan.source_checkpoint_sha256)
  assert.equal(restore.target_checkpoint_sha256, plan.target_checkpoint_sha256)
  assert.equal(restore.original_ancestor_checkpoint_sha256, plan.target_checkpoint_sha256)
  assert.equal(restore.byte_equal_original_ancestor, true)
  assertReceiptHash(restore as unknown as Record<string, unknown>, restore.schema)
  assertNoOperations(restore)

  assert.equal(replay.schema, 'mykrobial.replay-equivalence-receipt.v1')
  assert.equal(replay.target_checkpoint_sha256, plan.target_checkpoint_sha256)
  assert.equal(replay.expected_descendant_sha256, plan.source_checkpoint_sha256)
  assert.equal(replay.replayed_descendant_sha256, plan.source_checkpoint_sha256)
  assert.equal(replay.replayed_generation_count, plan.replay_generation_count)
  assert.equal(replay.canonical_equal, true)
  assertReceiptHash(replay as unknown as Record<string, unknown>, replay.schema)
  assertNoOperations(replay)
})

test('drift reports distinguish the exact branch from the fork', () => {
  const binding = json<Binding>(BINDING)
  const drift = json<DriftReceipt>('contracts/mykrobial/evidence/rollback-replay-v27/drift-detection.receipt.v1.json')
  const restart = json<RestartReceipt>('contracts/mykrobial/evidence/rollback-replay-v27/restart-reconciliation.receipt.v1.json')

  assert.equal(drift.schema, 'mykrobial.drift-detection-receipt.v1')
  assert.deepEqual(drift.compared_fields, [
    'generation',
    'predecessor_checkpoint_sha256',
    'committed_action_sha256',
    'committed_head_sha256',
    'committed_state',
    'committed_state_sha256',
    'excluded_uncommitted_tail',
    'ancestry',
    'checkpoint_sha256',
  ])
  assert.equal(drift.exact_branch_equivalent, true)
  assert.equal(drift.exact_branch_report.equivalent, true)
  assert.deepEqual(drift.exact_branch_report.drift_fields, [])
  assert.equal(drift.exact_branch_report.validation_blocker, null)
  assert.equal(drift.exact_branch_report.expected_checkpoint_sha256, binding.parity_shape.source_checkpoint_sha256)
  assert.equal(drift.exact_branch_report.observed_checkpoint_sha256, binding.parity_shape.source_checkpoint_sha256)
  assert.equal(drift.exact_branch_report.report_sha256, binding.parity_shape.drift_report_sha256)

  assert.equal(drift.fork_detected, true)
  assert.equal(drift.fork_report.equivalent, false)
  assert.deepEqual(drift.fork_report.drift_fields, [
    'committed_action_sha256',
    'committed_head_sha256',
    'committed_state',
    'committed_state_sha256',
    'checkpoint_sha256',
  ])
  assert.equal(drift.fork_report.validation_blocker, null)
  assert.notEqual(drift.fork_report.observed_checkpoint_sha256, binding.parity_shape.source_checkpoint_sha256)

  for (const report of [drift.exact_branch_report, drift.fork_report]) {
    assertReceiptHash(report as unknown as Record<string, unknown>, report.schema, 'report_sha256')
    assertNoOperations(report)
  }
  assertNoOperations(drift)

  assert.equal(restart.schema, 'mykrobial.rollback-restart-reconciliation.v1')
  assert.equal(restart.scenario_id, binding.parity_shape.scenario_id)
  assert.equal(restart.generation, binding.parity_shape.source_generation)
  assert.equal(restart.checkpoint_sha256, binding.parity_shape.source_checkpoint_sha256)
  assert.equal(restart.drift_report_sha256, drift.exact_branch_report.report_sha256)
  assert.equal(restart.accepted_exact_branch, true)
  assertReceiptHash(restart as unknown as Record<string, unknown>, restart.schema)
  assertNoOperations(restart)
})

test('scenario and verification fixtures remain source-only and non-operational', () => {
  const binding = json<Binding>(BINDING)
  const matrix = json<{
    scenario_count: number
    failing_scenario_count: number
    reviewed: boolean
    execution_authorized: boolean
    source_only: boolean
    scenarios: Array<{ scenario_id: string; state: string; artifact: { bytes: number; sha256: string } }>
  }>('contracts/mykrobial/evidence/rollback-replay-v27/scenario-matrix.v1.json')
  const verification = json<Record<string, unknown> & AuthorityAndCounts>(
    'contracts/mykrobial/evidence/rollback-replay-v27/verification.v1.json',
  )
  const artifactPaths = [
    'contracts/mykrobial/evidence/rollback-replay-v27/generation-restore.receipt.v1.json',
    'contracts/mykrobial/evidence/rollback-replay-v27/replay-equivalence.receipt.v1.json',
    'contracts/mykrobial/evidence/rollback-replay-v27/drift-detection.receipt.v1.json',
    'contracts/mykrobial/evidence/rollback-replay-v27/restart-reconciliation.receipt.v1.json',
  ]

  assert.equal(matrix.scenario_count, 4)
  assert.equal(matrix.failing_scenario_count, 0)
  assert.equal(matrix.reviewed, false)
  assert.equal(matrix.execution_authorized, false)
  assert.equal(matrix.source_only, true)
  assert.equal(matrix.scenarios.every(row => row.state === 'passed'), true)
  for (const [index, scenario] of matrix.scenarios.entries()) {
    const bytes = raw(artifactPaths[index])
    assert.equal(scenario.artifact.bytes, bytes.byteLength)
    assert.equal(scenario.artifact.sha256, sha256(bytes))
  }

  for (const key of [
    'exact_branch_equivalent',
    'fork_detected',
    'idempotent',
    'input_unchanged',
    'replay_exact',
    'restart_exact_branch_accepted',
    'restore_exact',
  ]) {
    assert.equal(verification[key], true, key)
  }
  assert.equal(verification.observed, 0)
  assert.equal(verification.restored_generation, 1)
  assert.equal(verification.scenario_count, 4)
  assert.deepEqual(verification.failures, [])
  assert.equal(verification.reviewed, false)
  assert.equal(verification.execution_authorized, false)
  assertNoOperations(verification)

  assert.equal(binding.parity_shape.requirement_id, 'rollback_replay_drift')
  assert.equal(binding.parity_shape.required_invariants.length, 7)
  assert.equal(binding.next_generation_boundary.contract_and_receipt_shape_available, true)
  assert.equal(binding.next_generation_boundary.current_production_runtime_implementation_copied, false)
  assert.equal(binding.next_generation_boundary.rollback_replay_or_drift_engine_implemented, false)
  assert.equal(binding.next_generation_boundary.actual_rollback_restart_or_state_mutation_executed, false)
  assert.equal(
    Object.entries(binding.authority).every(([key, value]) => key === 'source_binding_authorized' ? value : value === false),
    true,
  )
})
