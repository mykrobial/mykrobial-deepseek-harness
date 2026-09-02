import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ROOT = new URL('../../../../', import.meta.url)
const BINDING = 'contracts/mykrobial/evidence/expert-mixture-lineage.binding.v1.json'

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

interface Binding {
  schema: string
  status: string
  source: { candidate_commit: string; candidate_tree: string; fresh_critic_sha256: string; decision: string }
  copied_public_artifacts: Array<{ kind: string; path: string; sha256: string }>
  parity_shape: {
    requirement_id: string
    epoch_id: string
    candidate_state: string
    expert_count: number
    unique_lineage_count: number
    avoidable_single_lineage_collapse: boolean
    candidate_budgets: number[]
    total_budget: number
    budget_minimum: number
    budget_maximum: number
  }
  next_generation_boundary: Record<string, boolean | string>
  authority: Record<string, boolean>
}

interface Registry {
  schema: string
  epoch_id: string
  experts: Array<{
    expert_id: string
    lineage_id: string
    healthy: boolean
    definition: { ref: string; sha256: string; bytes: number }
    parent_receipt: { ref: string; sha256: string; bytes: number }
  }>
  prior_evidence_receipt: { ref: string; sha256: string; bytes: number }
  budget: { epoch_units: number; minimum_units_per_candidate: number; maximum_units_per_candidate: number }
  authority: Record<string, boolean>
}

interface BudgetLedger {
  schema: string
  epoch_id: string
  epoch_units: number
  allocated_units: number
  minimum_units_per_candidate: number
  maximum_units_per_candidate: number
  allocations: Array<{
    candidate_id: string
    expert_id: string
    budget_units: number
    derivation: { algorithm: string; attempt_count: number; success_count: number; weight_numerator: number; weight_denominator: number }
  }>
  prior_evidence_receipt: { ref: string; sha256: string; bytes: number }
}

interface LineageReceipt {
  schema: string
  epoch_id: string
  candidate_count: number
  unique_expert_count: number
  unique_lineage_count: number
  avoidable_single_lineage_collapse: boolean
  mappings: Array<{
    candidate_id: string
    expert_id: string
    lineage_id: string
    parent_candidate_sha256: string
    parent_receipt_sha256: string
  }>
}

interface CandidateBatch {
  schema: string
  state: string
  epoch_id: string
  candidates: Array<{
    candidate_id: string
    candidate_sha256: string
    expert_id: string
    lineage_id: string
    budget_units: number
    budget_derivation: BudgetLedger['allocations'][number]['derivation']
    definition: Registry['experts'][number]['definition']
    parent_candidate_sha256: string
    parent_receipt: Registry['experts'][number]['parent_receipt']
    prior_evidence_receipt: Registry['prior_evidence_receipt']
    state: string
  }>
  adaptive_budget_ledger: BudgetLedger
  lineage_receipt: LineageReceipt
  execution_counts: Record<string, number>
  authority: Record<string, boolean>
  receipt_sha256: string
}

test('accepted expert-mixture public artifacts retain exact source bytes', () => {
  const binding = json<Binding>(BINDING)
  assert.equal(binding.schema, 'mykrobial.next-deepseek-cordis.expert-mixture-lineage-binding.v1')
  assert.equal(binding.status, 'accepted_public_contract_and_receipt_shape_bound_unexecuted')
  assert.equal(binding.source.candidate_commit, '20a495d4dea494c9ad67abccb3eb4a2234521c2c')
  assert.equal(binding.source.candidate_tree, 'a68e9439cb8500acb265afb9b0be315c97af8796')
  assert.equal(binding.source.fresh_critic_sha256, 'eba2cd6c9a646b9c5cdd203477e8c21e31e7649e5fd0104d5ea3badce81a8b27')
  assert.equal(binding.source.decision, 'accept_source_only')
  assert.equal(binding.copied_public_artifacts.length, 8)
  for (const artifact of binding.copied_public_artifacts) {
    assert.equal(sha256(raw(artifact.path)), artifact.sha256, artifact.path)
  }

  const contract = json<Record<string, unknown>>('contracts/mykrobial/expert-mixture-lineage.v1.json')
  assert.equal(contract.capability_id, 'generate__expert_mixture_lineage')
  assert.equal(contract.harness_class, 'guidance')
  assert.equal(contract.reviewed, false)
  assert.equal(contract.production_authorized, false)
  assert.equal(contract.gate_ready, false)
})

test('fixture preserves three distinct lineages and exact finite budgets', () => {
  const binding = json<Binding>(BINDING)
  const registry = json<Registry>('contracts/mykrobial/evidence/expert-mixture-v25/expert-registry.v1.json')
  const ledger = json<BudgetLedger>('contracts/mykrobial/evidence/expert-mixture-v25/adaptive-budget-ledger.v1.json')
  const lineage = json<LineageReceipt>('contracts/mykrobial/evidence/expert-mixture-v25/lineage-receipt.v1.json')

  assert.equal(registry.epoch_id, binding.parity_shape.epoch_id)
  assert.equal(registry.experts.length, binding.parity_shape.expert_count)
  assert.equal(new Set(registry.experts.map(row => row.expert_id)).size, 3)
  assert.equal(new Set(registry.experts.map(row => row.lineage_id)).size, 3)
  assert.equal(registry.experts.every(row => row.healthy), true)
  assert.deepEqual(registry.budget, {
    epoch_units: 24,
    minimum_units_per_candidate: 4,
    maximum_units_per_candidate: 12,
  })

  assert.equal(ledger.allocated_units, ledger.epoch_units)
  assert.equal(ledger.allocations.reduce((sum, row) => sum + row.budget_units, 0), 24)
  assert.deepEqual(ledger.allocations.map(row => row.budget_units).sort((a, b) => a - b), [5, 8, 11])
  assert.equal(ledger.allocations.every(row => row.budget_units >= 4 && row.budget_units <= 12), true)
  assert.equal(ledger.allocations.every(row => row.derivation.algorithm === 'smoothed-evidence-diminishing-return-v1'), true)

  assert.equal(lineage.candidate_count, 3)
  assert.equal(lineage.unique_expert_count, 3)
  assert.equal(lineage.unique_lineage_count, 3)
  assert.equal(lineage.avoidable_single_lineage_collapse, false)
  assert.deepEqual(binding.parity_shape.candidate_budgets, [5, 8, 11])
  assert.equal(binding.parity_shape.total_budget, 24)
})

test('candidate batch joins definition parent evidence lineage and budget without authority', () => {
  const registry = json<Registry>('contracts/mykrobial/evidence/expert-mixture-v25/expert-registry.v1.json')
  const ledger = json<BudgetLedger>('contracts/mykrobial/evidence/expert-mixture-v25/adaptive-budget-ledger.v1.json')
  const lineage = json<LineageReceipt>('contracts/mykrobial/evidence/expert-mixture-v25/lineage-receipt.v1.json')
  const batch = json<CandidateBatch>('contracts/mykrobial/evidence/expert-mixture-v25/candidate-batch.v1.json')
  const experts = new Map(registry.experts.map(row => [row.expert_id, row]))
  const allocations = new Map(ledger.allocations.map(row => [row.candidate_id, row]))
  const mappings = new Map(lineage.mappings.map(row => [row.candidate_id, row]))

  assert.equal(batch.state, 'proposal_only_unexecuted')
  assert.equal(batch.candidates.length, 3)
  for (const candidate of batch.candidates) {
    const expert = experts.get(candidate.expert_id)
    const allocation = allocations.get(candidate.candidate_id)
    const mapping = mappings.get(candidate.candidate_id)
    assert.ok(expert)
    assert.ok(allocation)
    assert.ok(mapping)
    assert.equal(candidate.state, 'proposal_only_unexecuted')
    assert.equal(candidate.lineage_id, expert.lineage_id)
    assert.deepEqual(candidate.definition, expert.definition)
    assert.deepEqual(candidate.parent_receipt, expert.parent_receipt)
    assert.equal(candidate.parent_candidate_sha256, mapping.parent_candidate_sha256)
    assert.deepEqual(candidate.prior_evidence_receipt, registry.prior_evidence_receipt)
    assert.equal(candidate.budget_units, allocation.budget_units)
    assert.deepEqual(candidate.budget_derivation, allocation.derivation)
  }
  assert.deepEqual(batch.adaptive_budget_ledger, ledger)
  assert.deepEqual(batch.lineage_receipt, lineage)
  assert.equal(Object.values(batch.execution_counts).every(value => value === 0), true)
  assert.equal(Object.values(batch.authority).every(value => value === false), true)
  const { receipt_sha256: _receiptSha256, ...body } = batch
  assert.equal(batch.receipt_sha256, sha256(`${canonical(body)}\n`))
})

test('Next-Generation binding exposes parity shape without copying RSI execution', () => {
  const binding = json<Binding>(BINDING)
  assert.equal(binding.parity_shape.requirement_id, 'expert_mixture_lineage')
  assert.equal(binding.next_generation_boundary.contract_and_receipt_shape_available, true)
  assert.equal(binding.next_generation_boundary.current_production_runtime_implementation_copied, false)
  assert.equal(binding.next_generation_boundary.expert_generator_or_allocator_implemented, false)
  assert.equal(binding.next_generation_boundary.expert_or_model_dispatched, false)
  assert.equal(binding.next_generation_boundary.optimizer_or_evaluator_executed, false)
  assert.equal(binding.next_generation_boundary.training_or_promotion_authorized, false)
  assert.equal(Object.entries(binding.authority).every(([key, value]) => key === 'source_binding_authorized' ? value : value === false), true)
})
