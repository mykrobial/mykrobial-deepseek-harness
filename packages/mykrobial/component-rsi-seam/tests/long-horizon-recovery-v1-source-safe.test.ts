import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ROOT = new URL('../../../../', import.meta.url)
const BINDING = 'contracts/mykrobial/evidence/long-horizon-checkpoint-recovery.binding.v1.json'

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

function domainHash(domain: string, ...parts: Uint8Array[]): string {
  const digest = createHash('sha256')
  digest.update(domain)
  digest.update(Uint8Array.of(0))
  for (const part of parts) {
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(part.length))
    digest.update(length)
    digest.update(part)
  }
  return digest.digest('hex')
}

function prefixedHash(domain: string, part: Uint8Array): string {
  return createHash('sha256').update(domain).update(Uint8Array.of(0)).update(part).digest('hex')
}

interface Binding {
  schema: string
  status: string
  source: { candidate_commit: string; candidate_tree: string; fresh_critic_sha256: string; decision: string }
  copied_public_artifacts: Array<{ kind: string; path: string; sha256: string }>
  parity_shape: {
    requirement_id: string
    scenario_id: string
    validated_generations: number[]
    generation_count: number
    latest_generation: number
    latest_checkpoint_sha256: string
    latest_state_sha256: string
  }
  next_generation_boundary: Record<string, boolean | string>
  authority: Record<string, boolean>
}

interface Checkpoint {
  schema: string
  scenario_id: string
  generation: number
  predecessor_checkpoint_sha256: string
  committed_action_count: number
  committed_action_sha256: string[]
  committed_head_sha256: string
  committed_state: Record<string, number | string>
  committed_state_sha256: string
  excluded_uncommitted_tail: {
    action_count: number
    action_sha256: string[]
    payloads_included: boolean
    tail_head_sha256: string | null
  }
  state: string
  authority: Record<string, boolean>
  execution_counts: Record<string, number>
  non_claims: string[]
  ancestry: Array<Omit<Checkpoint, 'ancestry'>>
  checkpoint_sha256: string
}

interface RecoveryReceipt {
  schema: string
  scenario_id: string
  recovered_generation: number
  recovered_checkpoint_sha256: string
  recovered_state_sha256: string
  recovered_state: Record<string, number | string>
  discarded_partial_record_count: number
  state_equivalent: boolean
  authority: Record<string, boolean>
  execution_counts: Record<string, number>
  non_claims: string[]
  receipt_sha256: string
}

function checkpointCore(value: Checkpoint | Omit<Checkpoint, 'ancestry'>): Record<string, unknown> {
  const { checkpoint_sha256: _checkpointSha256, ...withoutHash } = value
  if ('ancestry' in withoutHash) {
    const { ancestry: _ancestry, ...core } = withoutHash
    return core
  }
  return withoutHash
}

function checkpointHash(core: Record<string, unknown>, ancestry: Array<Omit<Checkpoint, 'ancestry'>>): string {
  return domainHash(
    'mykrobial.long-horizon.checkpoint.v2',
    canonicalBytes({ core, ancestry }),
  )
}

function assertZeroAuthority(value: { authority: Record<string, boolean>; execution_counts: Record<string, number> }): void {
  assert.equal(Object.values(value.authority).every(item => item === false), true)
  assert.equal(Object.values(value.execution_counts).every(item => item === 0), true)
}

test('accepted long-horizon public artifacts retain exact source bytes', () => {
  const binding = json<Binding>(BINDING)
  assert.equal(binding.schema, 'mykrobial.next-deepseek-cordis.long-horizon-checkpoint-recovery-binding.v1')
  assert.equal(binding.status, 'accepted_public_contract_and_receipt_shape_bound_unexecuted')
  assert.equal(binding.source.candidate_commit, 'f4ad0a9a97ed56d483d9facdb364104b06f3bd79')
  assert.equal(binding.source.candidate_tree, '7f0ffe4af847d506ba52744c3773231795ff4666')
  assert.equal(binding.source.fresh_critic_sha256, '040503f4fa14593a50be0339356db6a4fabca9cae6d803c2ff8a30433e5fb7f5')
  assert.equal(binding.source.decision, 'accept_source_only')
  assert.equal(binding.copied_public_artifacts.length, 8)
  for (const artifact of binding.copied_public_artifacts) {
    assert.equal(sha256(raw(artifact.path)), artifact.sha256, artifact.path)
  }

  const contract = json<Record<string, unknown>>('contracts/mykrobial/long-horizon-checkpoint-recovery.v1.json')
  assert.equal(contract.capability_id, 'recover__long_horizon_checkpoint')
  assert.equal(contract.harness_class, 'evaluation')
  assert.equal(contract.reviewed, false)
  assert.equal(contract.production_authorized, false)
  assert.equal(contract.gate_ready, false)
})

test('generation zero through three forms one exact content-addressed chain', () => {
  const binding = json<Binding>(BINDING)
  const latest = json<Checkpoint>('contracts/mykrobial/evidence/long-horizon-v26/checkpoint.v1.json')
  const generations: Array<Checkpoint | Omit<Checkpoint, 'ancestry'>> = [...latest.ancestry, latest]
  const ancestry: Array<Omit<Checkpoint, 'ancestry'>> = []
  let predecessor = domainHash(
    'mykrobial.long-horizon.genesis.v1',
    new TextEncoder().encode(latest.scenario_id),
  )

  assert.deepEqual(generations.map(row => row.generation), [0, 1, 2, 3])
  for (const [generation, row] of generations.entries()) {
    assert.equal(row.generation, generation)
    assert.equal(row.predecessor_checkpoint_sha256, predecessor)
    assert.equal(row.committed_action_count, row.committed_action_sha256.length)
    assert.equal(row.committed_head_sha256, row.committed_action_sha256.at(-1))
    assert.equal(row.excluded_uncommitted_tail.payloads_included, false)
    assert.equal(row.excluded_uncommitted_tail.action_count, row.excluded_uncommitted_tail.action_sha256.length)
    assert.equal(
      row.excluded_uncommitted_tail.tail_head_sha256,
      row.excluded_uncommitted_tail.action_sha256.at(-1) ?? null,
    )
    const stateHash = domainHash(
      'mykrobial.long-horizon.state.v1',
      new TextEncoder().encode(row.scenario_id),
      new TextEncoder().encode(String(row.generation)),
      canonicalBytes(row.committed_state),
    )
    assert.equal(row.committed_state_sha256, stateHash)
    assert.equal(row.checkpoint_sha256, checkpointHash(checkpointCore(row), ancestry))
    assertZeroAuthority(row)
    predecessor = row.checkpoint_sha256
    ancestry.push(row as Omit<Checkpoint, 'ancestry'>)
  }
  assert.equal(latest.checkpoint_sha256, binding.parity_shape.latest_checkpoint_sha256)
  assert.equal(latest.committed_state_sha256, binding.parity_shape.latest_state_sha256)
  assert.deepEqual(binding.parity_shape.validated_generations, [0, 1, 2, 3])
})

test('restart pivot and crash receipts bind the same committed generation', () => {
  const latest = json<Checkpoint>('contracts/mykrobial/evidence/long-horizon-v26/checkpoint.v1.json')
  const restart = json<Record<string, unknown>>('contracts/mykrobial/evidence/long-horizon-v26/restart-recovery.receipt.v1.json')
  const pivot = json<Record<string, unknown>>('contracts/mykrobial/evidence/long-horizon-v26/pivot-recovery.receipt.v1.json')
  const crash = json<RecoveryReceipt>('contracts/mykrobial/evidence/long-horizon-v26/crash-recovery.receipt.v1.json')

  assert.equal(restart.checkpoint_sha256, latest.checkpoint_sha256)
  assert.equal(restart.expected_state_sha256, latest.committed_state_sha256)
  assert.equal(restart.recovered_state_sha256, latest.committed_state_sha256)
  assert.equal(restart.checkpoint_restart_equal, true)
  assert.equal(restart.recovery_restart_equal, true)
  assert.equal(restart.state_equivalent, true)
  assert.equal(restart.partial_record_discarded, true)
  assert.deepEqual(restart.validated_generations, [0, 1, 2, 3])

  assert.equal(pivot.child_checkpoint_sha256, latest.checkpoint_sha256)
  assert.equal(pivot.child_state_sha256, latest.committed_state_sha256)
  assert.equal(pivot.child_predecessor_checkpoint_sha256, latest.predecessor_checkpoint_sha256)
  assert.equal(pivot.parent_checkpoint_sha256, latest.predecessor_checkpoint_sha256)
  assert.equal(pivot.parent_bytes_unchanged, true)
  assert.equal(pivot.child_restart_equal, true)
  assert.equal(pivot.complete_ancestry_length, 3)

  assert.equal(crash.recovered_generation, 3)
  assert.equal(crash.recovered_checkpoint_sha256, latest.checkpoint_sha256)
  assert.equal(crash.recovered_state_sha256, latest.committed_state_sha256)
  assert.deepEqual(crash.recovered_state, latest.committed_state)
  assert.equal(crash.discarded_partial_record_count, 1)
  assert.equal(crash.state_equivalent, true)

  for (const [value, domain] of [
    [restart, 'mykrobial.long-horizon.restart-receipt.v1'],
    [pivot, 'mykrobial.long-horizon.pivot-receipt.v1'],
  ] as const) {
    const { receipt_sha256: declared, ...body } = value as Record<string, unknown>
    assert.equal(declared, prefixedHash(domain, canonicalBytes(body)))
    assertZeroAuthority(value as unknown as { authority: Record<string, boolean>; execution_counts: Record<string, number> })
  }
  const { receipt_sha256: crashReceiptSha256, ...crashBody } = crash
  assert.equal(
    crashReceiptSha256,
    domainHash('mykrobial.long-horizon.recovery-receipt.v1', canonicalBytes(crashBody)),
  )
  assertZeroAuthority(crash)
})

test('scenario matrix and binding remain source-only and non-operational', () => {
  const binding = json<Binding>(BINDING)
  const matrix = json<{ scenario_count: number; failing_scenario_count: number; scenarios: Array<{ scenario_id: string; state: string }>; execution_authorized: boolean }>(
    'contracts/mykrobial/evidence/long-horizon-v26/scenario-matrix.v1.json',
  )
  const verification = json<Record<string, unknown>>('contracts/mykrobial/evidence/long-horizon-v26/verification.v1.json')
  assert.equal(matrix.scenario_count, 3)
  assert.equal(matrix.failing_scenario_count, 0)
  assert.equal(matrix.scenarios.every(row => row.state === 'passed'), true)
  assert.equal(matrix.execution_authorized, false)
  assert.equal(verification.partial_write_preserves_committed_state, true)
  assert.equal(verification.pivot_parent_unchanged, true)
  assert.equal(verification.recovery_idempotent, true)
  assert.equal(verification.restart_idempotent, true)
  assert.equal(binding.next_generation_boundary.contract_and_receipt_shape_available, true)
  assert.equal(binding.next_generation_boundary.current_production_runtime_implementation_copied, false)
  assert.equal(binding.next_generation_boundary.recovery_engine_implemented, false)
  assert.equal(binding.next_generation_boundary.actual_process_or_service_restart_executed, false)
  assert.equal(Object.entries(binding.authority).every(([key, value]) => key === 'source_binding_authorized' ? value : value === false), true)
})
