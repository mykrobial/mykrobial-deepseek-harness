import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ROOT = new URL('../../../../', import.meta.url)
const BINDING = 'contracts/mykrobial/evidence/donor-interface-census.binding.v2.json'

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
  predecessor: { path: string; sha256: string; state: string }
  source: { candidate_commit: string; candidate_tree: string; fresh_critic_sha256: string; decision: string }
  copied_evidence: Record<string, { path: string; sha256: string; rows?: number; unique_organ_ids?: number; entries?: number }>
  coverage: {
    organ_count: number
    unique_organ_count: number
    contract_manifest_entries: number
    null_contract_ref_count: number
    unresolved_contract_ref_count: number
    contract_hash_mismatch_count: number
    new_source_only_contract_count: number
    repaired_organ_ids: string[]
  }
  copied_contracts: Array<{ path: string; sha256: string; organ_ids: string[] }>
  next_generation_boundary: {
    contracts_are_shared_source_inputs: boolean
    current_production_implementation_copied: boolean
    organs_claimed_ported_by_this_binding: number
  }
  authority: Record<string, boolean>
}

interface Catalog {
  schema: string
  row_count: number
  rows: Array<{ organ_id: string; donor_contract: string | null }>
}

interface ContractManifest {
  entry_count: number
  expected_repaired_organ_ids: string[]
  entries: Array<{ path: string; sha256: string; bytes: number; organ_ids: string[] }>
}

test('accepted v24 census binds all 83 unique organs to non-null contracts', () => {
  const binding = json<Binding>(BINDING)
  const catalog = json<Catalog>(binding.copied_evidence.catalog.path)
  const manifest = json<ContractManifest>(binding.copied_evidence.contract_manifest.path)

  assert.equal(binding.schema, 'mykrobial.next-deepseek-cordis.donor-interface-census-binding.v2')
  assert.equal(binding.status, 'accepted_source_contract_census_bound_ports_unexecuted')
  assert.equal(binding.source.candidate_commit, 'd3ca34a9b7f62d2936c2e7a896c4bd1a418daf8e')
  assert.equal(binding.source.candidate_tree, 'f6116ebcb08063d3c3a7b904f7427427d84da264')
  assert.equal(binding.source.fresh_critic_sha256, '9cf3b078f6faffd5f50540383128f4f878a4c862a0868709853790b271e3544a')
  assert.equal(binding.source.decision, 'accept_source_only')

  assert.equal(catalog.row_count, 83)
  assert.equal(catalog.rows.length, 83)
  assert.equal(new Set(catalog.rows.map(row => row.organ_id)).size, 83)
  assert.equal(catalog.rows.filter(row => row.donor_contract === null).length, 0)
  assert.equal(manifest.entry_count, 47)
  assert.equal(manifest.entries.length, 47)
  assert.equal(new Set(manifest.entries.map(row => row.path)).size, 47)

  assert.deepEqual(binding.coverage, {
    organ_count: 83,
    unique_organ_count: 83,
    contract_manifest_entries: 47,
    null_contract_ref_count: 0,
    unresolved_contract_ref_count: 0,
    contract_hash_mismatch_count: 0,
    new_source_only_contract_count: 10,
    repaired_organ_ids: ['RSI-003', 'RSI-005', 'RSI-015', 'ATDP-001', 'NA-001', 'NA-002', 'NA-003', 'NA-005', 'NA-008', 'OMNI-002'],
  })
  assert.deepEqual(manifest.expected_repaired_organ_ids, binding.coverage.repaired_organ_ids)
})

test('copied evidence and ten repaired contracts retain exact accepted bytes', () => {
  const binding = json<Binding>(BINDING)
  const manifest = json<ContractManifest>(binding.copied_evidence.contract_manifest.path)
  const entries = new Map(manifest.entries.map(row => [row.path, row]))

  for (const evidence of Object.values(binding.copied_evidence)) {
    assert.equal(sha256(raw(evidence.path)), evidence.sha256, evidence.path)
  }
  assert.equal(sha256(raw(binding.predecessor.path)), binding.predecessor.sha256)
  assert.equal(binding.predecessor.state, 'preserved')

  assert.equal(binding.copied_contracts.length, 10)
  for (const contract of binding.copied_contracts) {
    const bytes = raw(contract.path)
    const entry = entries.get(contract.path)
    assert.ok(entry, contract.path)
    assert.equal(sha256(bytes), contract.sha256, contract.path)
    assert.equal(entry.sha256, contract.sha256, contract.path)
    assert.equal(entry.bytes, bytes.length, contract.path)
    assert.deepEqual(entry.organ_ids, contract.organ_ids, contract.path)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)).authority, {
      deployment_authorized: false,
      execution_authorized: false,
      promotion_authorized: false,
      training_authorized: false,
    })
  }
})

test('census binding cannot inflate contract coverage into implementation authority', () => {
  const binding = json<Binding>(BINDING)
  assert.equal(binding.next_generation_boundary.contracts_are_shared_source_inputs, true)
  assert.equal(binding.next_generation_boundary.current_production_implementation_copied, false)
  assert.equal(binding.next_generation_boundary.organs_claimed_ported_by_this_binding, 0)
  assert.deepEqual(binding.authority, {
    source_binding_authorized: true,
    contract_adoption_authorized: false,
    runtime_activation_authorized: false,
    trace_append_authorized: false,
    promotion_authorized: false,
    deployment_authorized: false,
  })
})
