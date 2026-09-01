import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  acceptExternalComponentDecision,
  prepareComponentExperimentCapsule,
  prepareComponentMutationProposal,
  prepareComponentReconfigurationPlan,
} from '../../component-rsi-seam/src/index.ts'
import {
  buildFactoryHandoff,
  buildComponentOperationResult,
  buildOmniGentComponentEvolutionView,
  buildOmniGentHarnessView,
  validateOmniGentComponentEvolutionView,
  type FactoryHandoffInput,
  type OmniGentComponentEvolutionViewInput,
  type OmniGentHarnessViewInput,
} from '../src/index.ts'

const digest = (letter: string): string => letter.repeat(64)

const componentSeamFixture: any = JSON.parse(readFileSync(
  new URL('../../component-rsi-seam/tests/fixtures/single-prompt-experiment.v1.json', import.meta.url),
  'utf8',
))

function acceptedComponentArtifacts(): {
  capsule: ReturnType<typeof prepareComponentExperimentCapsule>
  decision: ReturnType<typeof acceptExternalComponentDecision>
  plan: ReturnType<typeof prepareComponentReconfigurationPlan>
} {
  const proposalInput = structuredClone(componentSeamFixture.proposal_input)
  proposalInput.proposal_id = 'proposal-prompt'
  proposalInput.task_capsule_id = 'capsule-component-view'
  proposalInput.loadout_id = 'retrodict-default-v1'
  proposalInput.targets[0].component_id = 'prompt-v2'
  const proposal = prepareComponentMutationProposal(proposalInput)
  const capsuleFields = structuredClone(componentSeamFixture.capsule_fields)
  capsuleFields.capsule_id = 'capsule-prompt'
  capsuleFields.experiment_id = 'experiment-prompt'
  capsuleFields.task_binding.task_capsule_id = proposal.task_capsule_id
  capsuleFields.task_binding.loadout_id = proposal.loadout_id
  capsuleFields.task_binding.loadout_manifest_sha256 = digest('a')
  for (const arm of capsuleFields.arms) arm.loadout_manifest_sha256 = digest('a')
  capsuleFields.arms[1].applied_delta_sha256 = proposal.target_set_sha256
  const capsule = prepareComponentExperimentCapsule({ ...capsuleFields, proposal })
  const decisionInput = structuredClone(componentSeamFixture.decision_input)
  decisionInput.decision_id = 'decision-prompt'
  decisionInput.capsule_id = capsule.capsule_id
  decisionInput.capsule_sha256 = capsule.capsule_sha256
  const decision = acceptExternalComponentDecision(decisionInput, capsule)
  const planFields = structuredClone(componentSeamFixture.plan_fields)
  planFields.current_loadout_manifest_sha256 = digest('a')
  const plan = prepareComponentReconfigurationPlan({ ...planFields, capsule, decision })
  return { capsule, decision, plan }
}

type JsonSchema = Record<string, any>
const SOURCE_CONTRACTS = new URL('../../../../contracts/', import.meta.url)
const INTEGRATED_CONTRACTS = new URL('../../../../contracts/mykrobial/', import.meta.url)
const contractUrl = (name: string): URL => {
  const integrated = new URL(name, INTEGRATED_CONTRACTS)
  return existsSync(integrated) ? integrated : new URL(name, SOURCE_CONTRACTS)
}
const schemaFiles: Record<string, JsonSchema> = {
  'omnigent-harness-read-model.v1.schema.json': JSON.parse(readFileSync(
    contractUrl('omnigent-harness-read-model.v1.schema.json'), 'utf8',
  )),
  'software-factory-handoff.v1.schema.json': JSON.parse(readFileSync(
    contractUrl('software-factory-handoff.v1.schema.json'), 'utf8',
  )),
  'harness-parity.v1.schema.json': JSON.parse(readFileSync(
    contractUrl('harness-parity.v1.schema.json'), 'utf8',
  )),
  'component-rsi-seam.v1.schema.json': JSON.parse(readFileSync(
    contractUrl('component-rsi-seam.v1.schema.json'), 'utf8',
  )),
  'omnigent-component-evolution-read-model.v1.schema.json': JSON.parse(readFileSync(
    contractUrl('omnigent-component-evolution-read-model.v1.schema.json'), 'utf8',
  )),
}

const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

function unicodeLength(value: string): number {
  return Array.from(value).length
}

function strictRfc3339DateTime(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = RFC3339_TIMESTAMP.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function resolvePointer(document: JsonSchema, pointer: string): JsonSchema {
  let current: any = document
  for (const token of pointer.replace(/^\//, '').split('/').filter(Boolean)) {
    current = current[token.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return current as JsonSchema
}

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'type', 'additionalProperties', 'required', 'properties',
  'const', 'enum', 'anyOf', 'allOf', 'if', 'then', 'else', 'minimum', 'maximum', 'minLength',
  'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'items',
  'prefixItems', 'contains',
])

function assertSupportedSchemaVocabulary(schema: JsonSchema): void {
  if (typeof schema === 'boolean') return
  for (const key of Object.keys(schema)) assert.equal(SUPPORTED_SCHEMA_KEYWORDS.has(key), true, `unsupported schema keyword: ${key}`)
  for (const child of Object.values(schema.$defs ?? {})) assertSupportedSchemaVocabulary(child as JsonSchema)
  for (const child of Object.values(schema.properties ?? {})) assertSupportedSchemaVocabulary(child as JsonSchema)
  if (schema.items !== undefined && typeof schema.items === 'object' && schema.items !== null) {
    assertSupportedSchemaVocabulary(schema.items as JsonSchema)
  }
  for (const child of schema.prefixItems ?? []) assertSupportedSchemaVocabulary(child as JsonSchema)
  if (schema.contains !== undefined) assertSupportedSchemaVocabulary(schema.contains as JsonSchema)
  for (const keyword of ['anyOf', 'allOf'] as const) {
    for (const child of schema[keyword] ?? []) assertSupportedSchemaVocabulary(child as JsonSchema)
  }
  for (const keyword of ['if', 'then', 'else'] as const) {
    if (schema[keyword] !== undefined) assertSupportedSchemaVocabulary(schema[keyword] as JsonSchema)
  }
}

for (const schema of Object.values(schemaFiles)) assertSupportedSchemaVocabulary(schema)

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : `nonfinite:${String(value)}`
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return `nonjson:${typeof value}`
}

function schemaErrors(value: unknown, schema: JsonSchema, document: JsonSchema): string[] {
  if (schema === false) return ['false schema']
  if (schema === true) return []
  const errors: string[] = []
  if (schema.$ref !== undefined) {
    const [filename, pointer = ''] = String(schema.$ref).split('#')
    const targetDocument = filename === '' ? document : schemaFiles[filename]
    if (targetDocument === undefined) return [`unresolved ref ${schema.$ref}`]
    errors.push(...schemaErrors(value, pointer === '' ? targetDocument : resolvePointer(targetDocument, pointer), targetDocument))
  }
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((candidate: JsonSchema) => schemaErrors(value, candidate, document).length === 0)) {
      errors.push('anyOf mismatch')
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) errors.push(...schemaErrors(value, candidate, document))
  }
  if (schema.if !== undefined && schemaErrors(value, schema.if, document).length === 0 && schema.then !== undefined) {
    errors.push(...schemaErrors(value, schema.then, document))
  }
  if (schema.if !== undefined && schemaErrors(value, schema.if, document).length !== 0 && schema.else !== undefined) {
    errors.push(...schemaErrors(value, schema.else, document))
  }
  if (schema.const !== undefined && !equalJson(value, schema.const)) errors.push('const mismatch')
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate: unknown) => equalJson(value, candidate))) {
    errors.push('enum mismatch')
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]
  const matchesType = (type: string): boolean => type === 'null' ? value === null
    : type === 'object' ? typeof value === 'object' && value !== null && !Array.isArray(value)
      : type === 'array' ? Array.isArray(value)
        : type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type
  if (types.length > 0 && !types.some(matchesType)) errors.push('type mismatch')
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && unicodeLength(value) < schema.minLength) errors.push('minLength')
    if (schema.maxLength !== undefined && unicodeLength(value) > schema.maxLength) errors.push('maxLength')
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) errors.push('pattern')
    if (schema.format === 'date-time' && !strictRfc3339DateTime(value)) errors.push('date-time')
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push('minimum')
    if (schema.maximum !== undefined && value > schema.maximum) errors.push('maximum')
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push('minItems')
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push('maxItems')
    if (schema.uniqueItems === true && new Set(value.map(canonicalJson)).size !== value.length) errors.push('uniqueItems')
    if (Array.isArray(schema.prefixItems)) {
      schema.prefixItems.forEach((itemSchema: JsonSchema, index: number) => {
        if (index < value.length) errors.push(...schemaErrors(value[index], itemSchema, document))
      })
    }
    if (schema.contains !== undefined
      && !value.some(item => schemaErrors(item, schema.contains, document).length === 0)) errors.push('contains')
    if (schema.items === false && value.length > (schema.prefixItems?.length ?? 0)) errors.push('items:false')
    if (schema.items !== undefined && schema.items !== false) {
      const start = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0
      value.slice(start).forEach(item => errors.push(...schemaErrors(item, schema.items, document)))
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) if (!Object.hasOwn(record, key)) errors.push(`required:${key}`)
    }
    if (schema.additionalProperties === false && schema.properties !== undefined) {
      for (const key of Object.keys(record)) if (!Object.hasOwn(schema.properties, key)) errors.push(`additional:${key}`)
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(record, key)) errors.push(...schemaErrors(record[key], childSchema as JsonSchema, document))
    }
  }
  return errors
}

function factoryInput(): FactoryHandoffInput {
  return {
    handoff_id: 'handoff-one', factory_id: 'super_simple_software_factory' as const,
    task_capsule_id: 'capsule-one', work_item_id: 'work-one', prh_stage: 'Protract' as const,
    frozen_prediction_sha256: digest('a'), built_artifact_sha256: [digest('b')],
    proof_level: 'source_verified' as const, next_action: 'Run fresh parity review.',
    blockers: ['typed_blocker:runtime_unadmitted'],
  }
}

test('Factory handoff is deterministic and never authorizes execution or deployment', () => {
  const input = factoryInput()
  const first = buildFactoryHandoff(input)
  const second = buildFactoryHandoff(input)
  assert.equal(first.handoff_sha256, second.handoff_sha256)
  assert.equal(first.execution_authorized, false)
  assert.equal(first.deployment_authorized, false)
})

function view(): OmniGentHarnessViewInput {
  return {
    generated_at: '2026-08-31T00:00:00Z', task_capsule_id: 'capsule-one',
    harness_generation: 'next_deepseek_cordis' as const,
    source_identity: { repository: 'mykrobial/mykrobial-deepseek-harness', commit: 'a'.repeat(40), tree: 'b'.repeat(40), dirty_state: 'clean' as const, configuration_sha256: digest('c') },
    loadout_id: 'scientific-retrodiction-v1', component_manifest_sha256: digest('d'), behavior_projection_sha256: digest('e'),
    scientific_posture: 'retrodict_default' as const,
    route: { state: 'blocked' as const, requested_model: null, routed_model: null, served_model: null, provider: null, receipt_sha256: null },
    trace: { state: 'blocked' as const, intent_count: 0, canonical_append_receipt_sha256: null, blocker: 'typed_blocker:trace_unadmitted' },
    replay: { state: 'available' as const, receipt_sha256: null },
    rollback: { state: 'declared' as const, receipt_sha256: null },
    factory: { factory_id: 'super_simple_software_factory' as const, integration_state: 'contract_only' as const, prh_stage: 'Protract' as const, work_item_id: 'work-one', handoff_sha256: digest('f') },
    proof_level: 'source_verified' as const,
    end_user_acceptance: [{ step_id: 'open-task', description: 'Open the real OmniGent task.', state: 'pending' as const, receipt_sha256: null }],
    non_claims: ['not_runtime', 'not_deployment'],
  }
}

function assertOperatorSchema(input: OmniGentHarnessViewInput): void {
  const output = buildOmniGentHarnessView(input)
  const schema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  assert.deepEqual(schemaErrors(output, schema, schema), [])
}

function withVerifiedRuntimeEvidence(input: OmniGentHarnessViewInput): OmniGentHarnessViewInput {
  input.route = {
    state: 'served_verified', requested_model: 'requested', routed_model: 'routed',
    served_model: 'served', provider: 'provider', receipt_sha256: digest('1'),
  }
  input.trace = {
    state: 'append_verified', intent_count: 1, canonical_append_receipt_sha256: digest('2'), blocker: null,
  }
  input.replay = { state: 'verified', receipt_sha256: digest('3') }
  input.rollback = { state: 'verified', receipt_sha256: digest('4') }
  input.factory.integration_state = 'runtime_verified'
  return input
}

test('source view exposes blockers without inflating route, Trace, runtime, or deployment', () => {
  const result = buildOmniGentHarnessView(view())
  assert.equal(result.proof_level, 'source_verified')
  assert.equal(result.route.state, 'blocked')
  assert.equal(result.trace.state, 'blocked')
})

test('served and Trace-append states require exact receipts', () => {
  const operatorSchema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  const route = view()
  route.route = {
    state: 'served_verified', requested_model: 'requested', routed_model: 'routed',
    served_model: 'served', provider: 'provider', receipt_sha256: null,
  }
  assert.notDeepEqual(schemaErrors(route, operatorSchema, operatorSchema), [])
  assert.throws(() => buildOmniGentHarnessView(route), /route_receipt_missing/)
  const trace = view()
  trace.trace.state = 'append_verified'
  trace.trace.blocker = null
  assert.notDeepEqual(schemaErrors(trace, operatorSchema, operatorSchema), [])
  assert.throws(() => buildOmniGentHarnessView(trace), /trace_append_receipt_missing/)
})

test('closed source identity and verified receipt digests are enforced at runtime', () => {
  const source = view()
  source.source_identity.commit = 'not-a-commit'
  assert.throws(() => buildOmniGentHarnessView(source), /source_identity_invalid/)

  const route = view()
  route.route = {
    state: 'served_verified', requested_model: 'requested', routed_model: 'routed',
    served_model: 'served', provider: 'provider', receipt_sha256: 'not-a-digest',
  }
  assert.throws(() => buildOmniGentHarnessView(route), /digest_invalid/)

  const trace = view()
  trace.trace = {
    state: 'append_verified', intent_count: 1, blocker: null,
    canonical_append_receipt_sha256: 'not-a-digest',
  }
  assert.throws(() => buildOmniGentHarnessView(trace), /digest_invalid/)
})

test('verified replay, rollback, and end-user steps require their own receipts', () => {
  const operatorSchema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  const replay = view()
  replay.replay.state = 'verified'
  assert.notDeepEqual(schemaErrors(replay, operatorSchema, operatorSchema), [])
  assert.throws(() => buildOmniGentHarnessView(replay), /replay_receipt_missing/)
  const rollback = view()
  rollback.rollback.state = 'rehearsed'
  assert.notDeepEqual(schemaErrors(rollback, operatorSchema, operatorSchema), [])
  assert.throws(() => buildOmniGentHarnessView(rollback), /rollback_receipt_missing/)
  const acceptance = view()
  acceptance.end_user_acceptance[0]!.state = 'passed'
  assert.notDeepEqual(schemaErrors(acceptance, operatorSchema, operatorSchema), [])
  assert.throws(() => buildOmniGentHarnessView(acceptance), /acceptance_receipt_missing/)
})

test('deployment proof requires every end-user step and rollback to be verified', () => {
  const input = view()
  input.proof_level = 'deployed_verified'
  assert.throws(() => buildOmniGentHarnessView(input), /deployment_proof_incomplete/)
})

test('constructor outputs have the exact public-schema top-level shape', () => {
  const factory = buildFactoryHandoff({
    handoff_id: 'handoff-schema', factory_id: 'super_simple_software_factory',
    task_capsule_id: 'capsule-one', work_item_id: 'work-one', prh_stage: 'Protract',
    frozen_prediction_sha256: digest('a'), built_artifact_sha256: [digest('b')],
    proof_level: 'source_verified', next_action: 'Review.', blockers: [],
  })
  const factorySchema = schemaFiles['software-factory-handoff.v1.schema.json']
  assert.deepEqual(Object.keys(factory).sort(), Object.keys(factorySchema.properties).sort())
  assert.equal(factorySchema.required.every((key: string) => Object.hasOwn(factory, key)), true)
  assert.deepEqual(schemaErrors(factory, factorySchema, factorySchema), [])

  const operator = buildOmniGentHarnessView(view())
  const operatorSchema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  assert.deepEqual(Object.keys(operator).sort(), Object.keys(operatorSchema.properties).sort())
  assert.equal(operatorSchema.required.every((key: string) => Object.hasOwn(operator, key)), true)
  assert.deepEqual(schemaErrors(operator, operatorSchema, operatorSchema), [])
})

test('closed objects reject extra keys before construction and after schema projection', () => {
  const factorySchema = schemaFiles['software-factory-handoff.v1.schema.json']
  const factoryInputWithExtra: any = { ...factoryInput(), unexpected_factory_key: true }
  assert.throws(() => buildFactoryHandoff(factoryInputWithExtra), /object_closure_invalid/)
  const factoryOutput: any = buildFactoryHandoff(factoryInput())
  factoryOutput.unexpected_factory_key = true
  assert.notDeepEqual(schemaErrors(factoryOutput, factorySchema, factorySchema), [])

  const operatorSchema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  const extraKeyMutations: Array<(candidate: any) => void> = [
    candidate => { candidate.unexpected_top_level_key = true },
    candidate => { candidate.source_identity.unexpected_source_identity_key = true },
    candidate => { candidate.route.unexpected_route_key = true },
    candidate => { candidate.trace.unexpected_trace_key = true },
    candidate => { candidate.replay.unexpected_replay_key = true },
    candidate => { candidate.rollback.unexpected_rollback_key = true },
    candidate => { candidate.factory.unexpected_factory_key = true },
    candidate => { candidate.end_user_acceptance[0].unexpected_acceptance_key = true },
  ]
  for (const mutate of extraKeyMutations) {
    const input: any = view()
    mutate(input)
    assert.throws(() => buildOmniGentHarnessView(input), /closure_invalid/)
    const projected: any = buildOmniGentHarnessView(view())
    mutate(projected)
    assert.notDeepEqual(schemaErrors(projected, operatorSchema, operatorSchema), [])
  }
})

test('strict UTC calendar timestamps match constructor and public-schema boundaries', () => {
  const operatorSchema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  for (const timestamp of [
    '2000-02-29T00:00:00Z',
    '2024-02-29T23:59:59.123456Z',
    '2026-12-31T23:59:59Z',
  ]) {
    const input = view()
    input.generated_at = timestamp
    const projected = buildOmniGentHarnessView(input)
    assert.deepEqual(schemaErrors(projected, operatorSchema, operatorSchema), [])
  }
  for (const timestamp of [
    '2026-02-31T00:00:00Z',
    '2023-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2024-04-31T00:00:00Z',
    '2024-01-01T24:00:00Z',
    '2024-01-01T00:60:00Z',
    '2024-01-01T00:00:60Z',
    '2024-01-01T00:00:00.Z',
    '2024-01-01T00:00:00.1234567Z',
    '2024-01-01T00:00:00+00:00',
  ]) {
    const input = view()
    input.generated_at = timestamp
    assert.throws(() => buildOmniGentHarnessView(input), /generated_at_invalid/)
    const projected: any = buildOmniGentHarnessView(view())
    projected.generated_at = timestamp
    assert.notDeepEqual(schemaErrors(projected, operatorSchema, operatorSchema), [])
  }
})

test('Factory schema enums, duplicate arrays, missing fields, and Unicode bounds have exact behavior', () => {
  const schema = schemaFiles['software-factory-handoff.v1.schema.json']
  for (const factory_id of ['legacy_four_gate', 'super_simple_software_factory', 'unresolved'] as const) {
    const input = factoryInput()
    input.factory_id = factory_id
    const output = buildFactoryHandoff(input)
    assert.deepEqual(schemaErrors(output, schema, schema), [])
  }
  for (const prh_stage of ['Abstract', 'Extract', 'Interact', 'Act', 'React', 'Counteract', 'Protract', 'Enact', 'Transact'] as const) {
    const input = factoryInput()
    input.prh_stage = prh_stage
    const output = buildFactoryHandoff(input)
    assert.deepEqual(schemaErrors(output, schema, schema), [])
  }
  for (const proof_level of ['designed', 'source_built', 'source_verified', 'runtime_verified', 'deployed_verified'] as const) {
    const input = factoryInput()
    input.proof_level = proof_level
    const output = buildFactoryHandoff(input)
    assert.deepEqual(schemaErrors(output, schema, schema), [])
  }

  const maximum = factoryInput()
  maximum.next_action = '🙂'.repeat(1024)
  assert.deepEqual(schemaErrors(buildFactoryHandoff(maximum), schema, schema), [])
  const tooLong = factoryInput()
  tooLong.next_action = '🙂'.repeat(1025)
  assert.throws(() => buildFactoryHandoff(tooLong), /handoff_incomplete/)
  const tooLongOutput: any = buildFactoryHandoff(factoryInput())
  tooLongOutput.next_action = '🙂'.repeat(1025)
  assert.notDeepEqual(schemaErrors(tooLongOutput, schema, schema), [])

  const duplicateArtifacts = factoryInput()
  duplicateArtifacts.built_artifact_sha256 = [digest('a'), digest('a')]
  assert.throws(() => buildFactoryHandoff(duplicateArtifacts), /duplicate_artifact_invalid/)
  const duplicateBlockers = factoryInput()
  duplicateBlockers.blockers = ['typed_blocker:duplicate', 'typed_blocker:duplicate']
  assert.throws(() => buildFactoryHandoff(duplicateBlockers), /duplicate_blocker_invalid/)
  const duplicateOutput: any = buildFactoryHandoff(factoryInput())
  duplicateOutput.built_artifact_sha256 = [digest('a'), digest('a')]
  assert.notDeepEqual(schemaErrors(duplicateOutput, schema, schema), [])
  const duplicateBlockerOutput: any = buildFactoryHandoff(factoryInput())
  duplicateBlockerOutput.blockers = ['typed_blocker:duplicate', 'typed_blocker:duplicate']
  assert.notDeepEqual(schemaErrors(duplicateBlockerOutput, schema, schema), [])
  const missing: any = factoryInput()
  delete missing.next_action
  assert.throws(() => buildFactoryHandoff(missing), /object_closure_invalid/)
})

test('OmniGent exact public schema accepts every declared state and rejects missing, duplicate, and bound-invalid values', () => {
  for (const route of [
    { state: 'not_requested', requested_model: null, routed_model: null, served_model: null, provider: null, receipt_sha256: null },
    { state: 'prepared', requested_model: '', routed_model: null, served_model: null, provider: null, receipt_sha256: null },
    { state: 'served_unverified', requested_model: '', routed_model: '', served_model: '', provider: '', receipt_sha256: null },
    { state: 'served_verified', requested_model: 'requested', routed_model: 'routed', served_model: 'served', provider: 'provider', receipt_sha256: digest('a') },
    { state: 'blocked', requested_model: null, routed_model: null, served_model: null, provider: null, receipt_sha256: null },
  ] as const) {
    const input = view()
    input.route = route
    assertOperatorSchema(input)
  }
  for (const trace of [
    { state: 'intent_only', intent_count: 0, canonical_append_receipt_sha256: null, blocker: null },
    { state: 'queued', intent_count: 1, canonical_append_receipt_sha256: null, blocker: null },
    { state: 'append_verified', intent_count: 1, canonical_append_receipt_sha256: digest('b'), blocker: null },
    { state: 'blocked', intent_count: 0, canonical_append_receipt_sha256: null, blocker: 'typed_blocker:trace_unadmitted' },
  ] as const) {
    const input = view()
    input.trace = trace
    assertOperatorSchema(input)
  }
  for (const state of ['available', 'verified', 'blocked'] as const) {
    const input = view()
    input.replay = { state, receipt_sha256: state === 'verified' ? digest('c') : null }
    assertOperatorSchema(input)
  }
  for (const state of ['declared', 'rehearsed', 'verified', 'blocked'] as const) {
    const input = view()
    input.rollback = { state, receipt_sha256: state === 'rehearsed' || state === 'verified' ? digest('d') : null }
    assertOperatorSchema(input)
  }
  for (const state of ['pending', 'passed', 'failed', 'blocked'] as const) {
    const input = view()
    input.end_user_acceptance = [{ step_id: 'step', description: 'A step.', state, receipt_sha256: state === 'passed' ? digest('e') : null }]
    assertOperatorSchema(input)
  }
  for (const scientific_posture of ['base', 'retrodict_default', 'retrodict_simulator_escalated', 'retrodict_novelty_escape'] as const) {
    const input = view()
    input.scientific_posture = scientific_posture
    assertOperatorSchema(input)
  }
  for (const harness_generation of ['current_production', 'next_deepseek_cordis'] as const) {
    const input = view()
    input.harness_generation = harness_generation
    assertOperatorSchema(input)
  }
  for (const integration_state of ['contract_only', 'source_wired', 'runtime_verified', 'blocked'] as const) {
    const input = view()
    input.factory.integration_state = integration_state
    assertOperatorSchema(input)
  }
  for (const factory_id of ['legacy_four_gate', 'super_simple_software_factory', 'unresolved'] as const) {
    const input = view()
    input.factory.factory_id = factory_id
    assertOperatorSchema(input)
  }
  for (const prh_stage of ['Abstract', 'Extract', 'Interact', 'Act', 'React', 'Counteract', 'Protract', 'Enact', 'Transact'] as const) {
    const input = view()
    input.factory.prh_stage = prh_stage
    assertOperatorSchema(input)
  }
  for (const proof_level of ['designed', 'source_built', 'source_verified', 'runtime_verified', 'deployed_verified'] as const) {
    const input = view()
    input.proof_level = proof_level
    if (proof_level === 'runtime_verified' || proof_level === 'deployed_verified') withVerifiedRuntimeEvidence(input)
    if (proof_level === 'deployed_verified') {
      input.end_user_acceptance = [{ step_id: 'step', description: 'A step.', state: 'passed', receipt_sha256: digest('6') }]
    }
    assertOperatorSchema(input)
  }

  const unicode = view()
  unicode.source_identity.repository = '🙂'.repeat(512)
  unicode.route = { state: 'prepared', requested_model: '🙂'.repeat(128), routed_model: null, served_model: null, provider: null, receipt_sha256: null }
  unicode.end_user_acceptance[0]!.description = '🙂'.repeat(512)
  unicode.non_claims = ['🙂'.repeat(128)]
  assertOperatorSchema(unicode)
  const beyondUnicode = view()
  beyondUnicode.route = { state: 'prepared', requested_model: '🙂'.repeat(129), routed_model: null, served_model: null, provider: null, receipt_sha256: null }
  assert.throws(() => buildOmniGentHarnessView(beyondUnicode), /text_invalid/)
  const tooLongBlocker = view()
  tooLongBlocker.trace.blocker = `typed_blocker:${'a'.repeat(243)}`
  assert.throws(() => buildOmniGentHarnessView(tooLongBlocker), /trace_blocker_invalid/)
  const maximumBlocker = view()
  maximumBlocker.trace.blocker = `typed_blocker:${'a'.repeat(242)}`
  assertOperatorSchema(maximumBlocker)
  const duplicateNonClaims = view()
  duplicateNonClaims.non_claims = ['duplicate', 'duplicate']
  assert.throws(() => buildOmniGentHarnessView(duplicateNonClaims), /non_claims_duplicate_invalid/)
  const duplicateNonClaimsOutput: any = buildOmniGentHarnessView(view())
  duplicateNonClaimsOutput.non_claims = ['duplicate', 'duplicate']
  const schema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  assert.notDeepEqual(schemaErrors(duplicateNonClaimsOutput, schema, schema), [])
  const emptyAcceptance = view()
  emptyAcceptance.end_user_acceptance = []
  assert.throws(() => buildOmniGentHarnessView(emptyAcceptance), /acceptance_plan_missing/)
  const tooManyAcceptance = view()
  tooManyAcceptance.end_user_acceptance = Array.from({ length: 33 }, (_, index) => ({ step_id: `step-${index}`, description: 'A step.', state: 'pending' as const, receipt_sha256: null }))
  assert.throws(() => buildOmniGentHarnessView(tooManyAcceptance), /acceptance_plan_missing/)
  const missingNested: any = view()
  delete missingNested.route.provider
  assert.throws(() => buildOmniGentHarnessView(missingNested), /route_closure_invalid/)
  const missingOutput: any = buildOmniGentHarnessView(view())
  delete missingOutput.route.provider
  assert.notDeepEqual(schemaErrors(missingOutput, schema, schema), [])
})

test('every closed public object requires its declared fields before construction and in projections', () => {
  const schema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  const missingFieldMutations: Array<(candidate: any) => void> = [
    candidate => { delete candidate.task_capsule_id },
    candidate => { delete candidate.source_identity.configuration_sha256 },
    candidate => { delete candidate.route.provider },
    candidate => { delete candidate.trace.intent_count },
    candidate => { delete candidate.replay.receipt_sha256 },
    candidate => { delete candidate.rollback.state },
    candidate => { delete candidate.factory.handoff_sha256 },
    candidate => { delete candidate.end_user_acceptance[0].description },
  ]
  for (const mutate of missingFieldMutations) {
    const input: any = view()
    mutate(input)
    assert.throws(() => buildOmniGentHarnessView(input), /typed_blocker:/)
    const projected: any = buildOmniGentHarnessView(view())
    mutate(projected)
    assert.notDeepEqual(schemaErrors(projected, schema, schema), [])
  }
})

test('closed-schema runtime mutation matrix rejects malformed nested values', () => {
  const mutations: Array<(candidate: any) => void> = [
    candidate => { candidate.generated_at = 'not-a-timestamp' },
    candidate => { candidate.harness_generation = 'unknown' },
    candidate => { candidate.scientific_posture = 'expensive_default' },
    candidate => { candidate.source_identity.commit = 'bad' },
    candidate => { candidate.source_identity.tree = 'bad' },
    candidate => { candidate.source_identity.configuration_sha256 = 'bad' },
    candidate => { candidate.route.state = 'unknown' },
    candidate => { candidate.route.requested_model = 7 },
    candidate => { candidate.route.receipt_sha256 = 'bad' },
    candidate => { candidate.trace.state = 'unknown' },
    candidate => { candidate.trace.intent_count = -1 },
    candidate => { candidate.trace.canonical_append_receipt_sha256 = 'bad' },
    candidate => { candidate.replay.state = 'unknown' },
    candidate => { candidate.replay.receipt_sha256 = 'bad' },
    candidate => { candidate.rollback.state = 'unknown' },
    candidate => { candidate.rollback.receipt_sha256 = 'bad' },
    candidate => { candidate.factory.factory_id = 'unknown' },
    candidate => { candidate.factory.integration_state = 'unknown' },
    candidate => { candidate.factory.prh_stage = 'Skip' },
    candidate => { candidate.factory.handoff_sha256 = 'bad' },
    candidate => { candidate.proof_level = 'claimed' },
    candidate => { candidate.end_user_acceptance[0].state = 'claimed' },
    candidate => { candidate.end_user_acceptance[0].receipt_sha256 = 'bad' },
    candidate => { candidate.end_user_acceptance[0].description = '' },
    candidate => { candidate.non_claims = [7] },
  ]
  for (const mutate of mutations) {
    const projected: any = buildOmniGentHarnessView(view())
    mutate(projected)
    const operatorSchema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
    assert.notDeepEqual(schemaErrors(projected, operatorSchema, operatorSchema), [])
    const candidate: any = view()
    mutate(candidate)
    assert.throws(() => buildOmniGentHarnessView(candidate), /typed_blocker:/)
  }
})

test('global proof levels cannot overstate any required subsystem evidence', () => {
  const schema = schemaFiles['omnigent-harness-read-model.v1.schema.json']
  for (const proof_level of ['designed', 'source_built', 'source_verified'] as const) {
    const honestBlocked = view()
    honestBlocked.proof_level = proof_level
    assertOperatorSchema(honestBlocked)
  }

  const degradeRuntimeEvidence: Array<(candidate: any) => void> = [
    candidate => { candidate.route = { state: 'blocked', requested_model: null, routed_model: null, served_model: null, provider: null, receipt_sha256: null } },
    candidate => { candidate.trace = { state: 'blocked', intent_count: 0, canonical_append_receipt_sha256: null, blocker: 'typed_blocker:trace_unadmitted' } },
    candidate => { candidate.replay = { state: 'available', receipt_sha256: null } },
    candidate => { candidate.rollback = { state: 'declared', receipt_sha256: null } },
    candidate => { candidate.factory.integration_state = 'contract_only' },
  ]
  for (const mutate of degradeRuntimeEvidence) {
    const runtime: any = withVerifiedRuntimeEvidence(view())
    runtime.proof_level = 'runtime_verified'
    mutate(runtime)
    assert.throws(() => buildOmniGentHarnessView(runtime), /runtime_proof_incomplete/)
    const projected: any = buildOmniGentHarnessView(Object.assign(withVerifiedRuntimeEvidence(view()), { proof_level: 'runtime_verified' }))
    mutate(projected)
    assert.notDeepEqual(schemaErrors(projected, schema, schema), [])

    const deployed: any = withVerifiedRuntimeEvidence(view())
    deployed.proof_level = 'deployed_verified'
    deployed.end_user_acceptance = [{ step_id: 'step', description: 'A step.', state: 'passed', receipt_sha256: digest('5') }]
    mutate(deployed)
    assert.throws(() => buildOmniGentHarnessView(deployed), /deployment_proof_incomplete/)
  }
  const incompleteAcceptance = withVerifiedRuntimeEvidence(view())
  incompleteAcceptance.proof_level = 'deployed_verified'
  assert.throws(() => buildOmniGentHarnessView(incompleteAcceptance), /deployment_proof_incomplete/)
})

test('runtime and deployed verified states require and accept complete exact receipts', () => {
  const runtime = withVerifiedRuntimeEvidence(view())
  runtime.proof_level = 'runtime_verified'
  assert.equal(buildOmniGentHarnessView(runtime).proof_level, 'runtime_verified')

  runtime.proof_level = 'deployed_verified'
  runtime.end_user_acceptance[0] = {
    step_id: 'open-task', description: 'Open the real OmniGent task.', state: 'passed', receipt_sha256: digest('5'),
  }
  assert.equal(buildOmniGentHarnessView(runtime).proof_level, 'deployed_verified')
})

function componentEvolutionView(): OmniGentComponentEvolutionViewInput {
  const artifacts = acceptedComponentArtifacts()
  return {
    generated_at: '2026-09-01T00:00:00Z',
    task_capsule_id: 'capsule-component-view',
    run_id: 'run-component-view',
    harness_generation: 'next_deepseek_cordis',
    active_loadout: { loadout_id: 'retrodict-default-v1', manifest_sha256: digest('a') },
    component_manifest_sha256: digest('b'),
    mutation_surface_registry_sha256: artifacts.capsule.source_binding.mutation_surface_registry_sha256,
    components: [
      {
        component_id: 'prompt-v1',
        logical_identity: 'system-prompt',
        surface_id: 'prompt',
        generation: 1,
        lifecycle_state: 'active',
        source_sha256: digest('d'),
        configuration_sha256: digest('e'),
        dependency_ids: [],
        branch_id: 'branch-main',
        parent_component_id: null,
        transaction_time: '2026-09-01T00:00:00Z',
        valid_from: '2026-09-01T00:00:00Z',
        valid_until: null,
        experiment_id: null,
        active: true,
        rollback_available: true,
      },
      {
        component_id: 'prompt-v2',
        logical_identity: 'system-prompt',
        surface_id: 'prompt',
        generation: 2,
        lifecycle_state: 'inactive',
        source_sha256: digest('f'),
        configuration_sha256: digest('1'),
        dependency_ids: [],
        branch_id: 'branch-experiment',
        parent_component_id: 'prompt-v1',
        transaction_time: '2026-09-01T00:01:00Z',
        valid_from: null,
        valid_until: null,
        experiment_id: 'experiment-prompt',
        active: false,
        rollback_available: true,
      },
    ],
    experiments: [
      {
        experiment_id: 'experiment-prompt',
        capsule_id: artifacts.capsule.capsule_id,
        capsule_sha256: artifacts.capsule.capsule_sha256,
        plane: artifacts.capsule.plane,
        target_component_ids: [...artifacts.capsule.target_component_ids],
        target_surface_ids: [...artifacts.capsule.target_surface_ids],
        target_set_sha256: artifacts.capsule.target_set_sha256,
        capsule_artifact: artifacts.capsule,
        arms: artifacts.capsule.arms.map(arm => ({
          ...arm,
          execution_state: 'planned' as const,
          result_receipt_sha256: null,
        })) as OmniGentComponentEvolutionViewInput['experiments'][number]['arms'],
        decision: {
          state: 'untrusted', decision_id: artifacts.decision.decision_id,
          capsule_id: artifacts.decision.capsule_id,
          external_input_sha256: artifacts.decision.external_input_sha256,
          capsule_sha256: artifacts.decision.capsule_sha256,
          disposition: artifacts.decision.disposition,
          authority_receipt_sha256: null,
          training_gate_receipt_sha256: null,
          artifact: artifacts.decision,
        },
        plan: {
          state: 'prepared_unexecuted', operation: artifacts.plan.operation,
          plan_id: artifacts.plan.plan_id,
          capsule_id: artifacts.plan.capsule_id, decision_id: artifacts.plan.decision_id,
          plan_sha256: artifacts.plan.plan_sha256,
          post_loadout_manifest_sha256: null,
          capsule_sha256: artifacts.plan.capsule_sha256,
          decision_external_input_sha256: artifacts.plan.decision_external_input_sha256,
          verification_receipt_sha256: null,
          applied_receipt_sha256: null,
          replay_receipt_sha256: null, rollback_receipt_sha256: null,
          blocker_resolutions: [],
          operation_result: null,
          artifact: artifacts.plan,
        },
        proof_level: 'source_verified',
      },
    ],
    optimizer_ports: [
      {
        strategy_id: 'local-inner-loop',
        plane: 'local_idle_compute',
        strategy_class: 'inner_loop',
        state: 'declared',
        receipt_sha256: null,
        blocker: null,
        proposal_only: true,
        training_authorized: false,
        apply_authorized: false,
      },
      {
        strategy_id: 'frontier-external',
        plane: 'frontier_builder_critic',
        strategy_class: 'external_optimizer',
        state: 'blocked',
        receipt_sha256: null,
        blocker: 'typed_blocker:external_optimizer_unadmitted',
        proposal_only: true,
        training_authorized: false,
        apply_authorized: false,
      },
    ],
    timeline: [
      {
        sequence: 0,
        transaction_time: '2026-09-01T00:00:30Z',
        valid_from: null,
        valid_until: null,
        phase: 'proposal_prepared',
        source_event_sha256: digest('a'),
        component_ids: ['prompt-v2'],
        experiment_id: 'experiment-prompt',
        causality_state: 'not_asserted',
        receipt_sha256: null,
      },
      {
        sequence: 1,
        transaction_time: '2026-09-01T00:01:00Z',
        valid_from: null,
        valid_until: null,
        phase: 'capsule_prepared',
        source_event_sha256: digest('b'),
        component_ids: ['prompt-v2'],
        experiment_id: 'experiment-prompt',
        causality_state: 'asserted_unverified',
        receipt_sha256: null,
      },
    ],
    trace: {
      state: 'blocked',
      intent_count: 2,
      chain_head_sha256: null,
      append_receipt_sha256: null,
      blocker: 'typed_blocker:trace_unadmitted',
    },
    replay: { state: 'available', receipt_sha256: null },
    rollback: { state: 'declared', receipt_sha256: null },
    proof_level: 'source_verified',
    deployment_receipt_sha256: null,
    non_claims: [
      'not_optimizer_execution', 'not_component_application', 'not_trace_append',
      'not_training', 'not_deployment',
    ],
  }
}

function withComponentRuntimeEvidence(
  input: OmniGentComponentEvolutionViewInput,
): OmniGentComponentEvolutionViewInput {
  input.trace = {
    state: 'append_verified', intent_count: 3, chain_head_sha256: digest('c'),
    append_receipt_sha256: digest('d'), blocker: null,
  }
  input.replay = { state: 'verified', receipt_sha256: digest('e') }
  input.rollback = { state: 'verified', receipt_sha256: digest('f') }
  const experiment = input.experiments[0]!
  for (const [index, arm] of experiment.arms.entries()) {
    arm.execution_state = 'completed'
    arm.result_receipt_sha256 = digest(String(7 + index))
  }
  experiment.proof_level = 'runtime_verified'
  experiment.decision = {
    ...experiment.decision,
    state: 'verified',
    authority_receipt_sha256: digest('1'),
    training_gate_receipt_sha256: null,
  }
  const observedAt = '2026-09-01T00:02:00Z'
  const parent = input.components.find(component => component.component_id === 'prompt-v1')!
  parent.active = false
  parent.lifecycle_state = 'inactive'
  parent.valid_until = observedAt
  const candidate = input.components.find(component => component.component_id === 'prompt-v2')!
  candidate.active = true
  candidate.lifecycle_state = 'active'
  candidate.valid_from = observedAt
  candidate.valid_until = null
  const operationResult = buildComponentOperationResult({
    capsule: experiment.capsule_artifact,
    decision: experiment.decision.artifact!,
    plan: experiment.plan.artifact!,
    post_loadout_manifest_sha256: digest('b'),
    observed_components: [parent, candidate],
    verification_receipt_sha256: digest('6'),
    operation_receipt_sha256: digest('2'),
    observed_at: observedAt,
  })
  experiment.plan = {
    ...experiment.plan,
    state: 'applied',
    post_loadout_manifest_sha256: digest('b'),
    verification_receipt_sha256: digest('6'), applied_receipt_sha256: digest('2'),
    replay_receipt_sha256: null,
    rollback_receipt_sha256: null,
    blocker_resolutions: [{
      blocker: 'typed_blocker:external_decision_authority_unverified',
      receipt_sha256: digest('1'),
    }],
    operation_result: operationResult,
  }
  input.active_loadout.manifest_sha256 = digest('b')
  input.generated_at = '2026-09-01T00:03:00Z'
  input.proof_level = 'runtime_verified'
  return input
}

function assertComponentViewSchema(input: OmniGentComponentEvolutionViewInput): void {
  const output = buildOmniGentComponentEvolutionView(input)
  const schema = schemaFiles['omnigent-component-evolution-read-model.v1.schema.json']
  assert.deepEqual(schemaErrors(output, schema, schema), [])
}

test('component evolution source view is deterministic and schema exact', () => {
  const first = buildOmniGentComponentEvolutionView(componentEvolutionView())
  const second = buildOmniGentComponentEvolutionView(componentEvolutionView())
  assert.deepEqual(first, second)
  assert.equal(first.view_sha256, second.view_sha256)
  assert.equal(first.proof_level, 'source_verified')
  assert.equal(first.trace.state, 'blocked')
  assert.equal(first.experiments[0]?.plan.state, 'prepared_unexecuted')
  assert.equal(first.optimizer_ports.every(port => port.proposal_only
    && !port.training_authorized && !port.apply_authorized), true)
  assertComponentViewSchema(componentEvolutionView())
})

test('component evolution view closes root and every nested object', () => {
  const mutations: Array<(candidate: any) => void> = [
    candidate => { candidate.extra = true },
    candidate => { candidate.active_loadout.extra = true },
    candidate => { candidate.components[0].extra = true },
    candidate => { candidate.experiments[0].extra = true },
    candidate => { candidate.experiments[0].capsule_artifact.extra = true },
    candidate => { candidate.experiments[0].arms[0].extra = true },
    candidate => { candidate.experiments[0].decision.extra = true },
    candidate => { candidate.experiments[0].decision.artifact.extra = true },
    candidate => { candidate.experiments[0].plan.extra = true },
    candidate => { candidate.experiments[0].plan.artifact.extra = true },
    candidate => { candidate.optimizer_ports[0].extra = true },
    candidate => { candidate.timeline[0].extra = true },
    candidate => { candidate.trace.extra = true },
    candidate => { candidate.replay.extra = true },
    candidate => { candidate.rollback.extra = true },
  ]
  const schema = schemaFiles['omnigent-component-evolution-read-model.v1.schema.json']
  for (const mutate of mutations) {
    const input: any = componentEvolutionView()
    mutate(input)
    assert.throws(
      () => buildOmniGentComponentEvolutionView(input),
      /(closure_invalid|closed_object_invalid)/,
    )
    const output: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
    mutate(output)
    assert.notDeepEqual(schemaErrors(output, schema, schema), [])
  }
  const runtimeInput: any = withComponentRuntimeEvidence(componentEvolutionView())
  runtimeInput.experiments[0].plan.operation_result.extra = true
  assert.throws(
    () => buildOmniGentComponentEvolutionView(runtimeInput),
    /component_operation_result_closure_invalid/,
  )
  const runtimeOutput: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  runtimeOutput.experiments[0].plan.operation_result.extra = true
  assert.notDeepEqual(schemaErrors(runtimeOutput, schema, schema), [])
})

test('component identity, active generation, and timeline references fail closed', () => {
  const duplicate = componentEvolutionView()
  duplicate.components[1]!.component_id = duplicate.components[0]!.component_id
  duplicate.components[1]!.parent_component_id = null
  assert.throws(() => buildOmniGentComponentEvolutionView(duplicate), /component_duplicate_invalid/)
  const activeCollision = componentEvolutionView()
  activeCollision.components[1]!.active = true
  activeCollision.components[1]!.lifecycle_state = 'active'
  assert.throws(() => buildOmniGentComponentEvolutionView(activeCollision), /active_identity_collision/)
  const unknownTarget = componentEvolutionView()
  unknownTarget.experiments[0]!.target_component_ids = ['missing-component']
  assert.throws(() => buildOmniGentComponentEvolutionView(unknownTarget), /capsule_artifact_mismatch/)
  const unknownParent = componentEvolutionView()
  unknownParent.components[1]!.parent_component_id = 'missing-parent'
  assert.throws(() => buildOmniGentComponentEvolutionView(unknownParent), /parent_identity_invalid/)
  const crossLineage = componentEvolutionView()
  crossLineage.components[1]!.logical_identity = 'different-logical-component'
  assert.throws(() => buildOmniGentComponentEvolutionView(crossLineage), /parent_identity_invalid/)
  const crossSurface = componentEvolutionView()
  crossSurface.components[1]!.surface_id = 'router'
  assert.throws(() => buildOmniGentComponentEvolutionView(crossSurface), /parent_identity_invalid/)
  const nonEarlierParent = componentEvolutionView()
  nonEarlierParent.components[1]!.generation = 1
  assert.throws(() => buildOmniGentComponentEvolutionView(nonEarlierParent), /parent_identity_invalid/)
  const parentAfterChild = componentEvolutionView()
  parentAfterChild.components[0]!.transaction_time = '2026-09-01T00:02:00Z'
  assert.throws(() => buildOmniGentComponentEvolutionView(parentAfterChild), /parent_identity_invalid/)
  const unknownComponentExperiment = componentEvolutionView()
  unknownComponentExperiment.components[1]!.experiment_id = 'missing-experiment'
  assert.throws(() => buildOmniGentComponentEvolutionView(unknownComponentExperiment), /experiment_identity_invalid/)
  const reversedTimeline = componentEvolutionView()
  reversedTimeline.timeline[1]!.sequence = 0
  assert.throws(() => buildOmniGentComponentEvolutionView(reversedTimeline), /timeline_identity_or_order_invalid/)
  const unknownTimeline = componentEvolutionView()
  unknownTimeline.timeline[0]!.experiment_id = 'missing-experiment'
  assert.throws(() => buildOmniGentComponentEvolutionView(unknownTimeline), /timeline_identity_or_order_invalid/)
})

test('component experiments require exact BASE TRUE SHAM controls and planes', () => {
  const wrongRole = componentEvolutionView()
  wrongRole.experiments[0]!.arms[2]!.role = 'BASE'
  assert.throws(() => buildOmniGentComponentEvolutionView(wrongRole), /arms_invalid/)
  const loadoutDrift = componentEvolutionView()
  loadoutDrift.experiments[0]!.arms[2]!.loadout_manifest_sha256 = digest('f')
  assert.throws(() => buildOmniGentComponentEvolutionView(loadoutDrift), /arms_invalid/)
  const swappedControlSemantics = componentEvolutionView()
  const baseDelta = swappedControlSemantics.experiments[0]!.arms[0]!.applied_delta_sha256
  swappedControlSemantics.experiments[0]!.arms[0]!.applied_delta_sha256
    = swappedControlSemantics.experiments[0]!.arms[1]!.applied_delta_sha256
  swappedControlSemantics.experiments[0]!.arms[1]!.applied_delta_sha256 = baseDelta
  assert.throws(() => buildOmniGentComponentEvolutionView(swappedControlSemantics), /arms_invalid/)
  const wrongControlStrategy = componentEvolutionView()
  wrongControlStrategy.experiments[0]!.arms[0]!.control_strategy = 'candidate_delta'
  assert.throws(() => buildOmniGentComponentEvolutionView(wrongControlStrategy), /arms_invalid/)
  const modelWeights = componentEvolutionView()
  modelWeights.experiments[0]!.target_surface_ids = ['model_weights']
  assert.throws(() => buildOmniGentComponentEvolutionView(modelWeights), /model_weights_plane_invalid/)
  const targetSurfaceMismatch = componentEvolutionView()
  targetSurfaceMismatch.experiments[0]!.target_surface_ids = ['router']
  assert.throws(() => buildOmniGentComponentEvolutionView(targetSurfaceMismatch), /capsule_artifact_mismatch/)
  const completedWithoutReceipt = componentEvolutionView()
  completedWithoutReceipt.experiments[0]!.arms[0]!.execution_state = 'completed'
  assert.throws(() => buildOmniGentComponentEvolutionView(completedWithoutReceipt), /arm_receipt_missing/)
})

test('component decision and plan states cannot overstate receipts', () => {
  const untrustedWithAuthority = componentEvolutionView()
  untrustedWithAuthority.experiments[0]!.decision.authority_receipt_sha256 = digest('1')
  assert.throws(() => buildOmniGentComponentEvolutionView(untrustedWithAuthority), /decision_state_invalid/)
  const verifiedWithoutAuthority = componentEvolutionView()
  verifiedWithoutAuthority.experiments[0]!.decision.state = 'verified'
  assert.throws(() => buildOmniGentComponentEvolutionView(verifiedWithoutAuthority), /decision_state_invalid/)
  const resealedCapsule = withComponentRuntimeEvidence(componentEvolutionView())
  resealedCapsule.experiments[0]!.capsule_sha256 = digest('f')
  assert.throws(() => buildOmniGentComponentEvolutionView(resealedCapsule), /capsule_artifact_mismatch/)
  const stalePlanCapsule = componentEvolutionView()
  stalePlanCapsule.experiments[0]!.plan.capsule_sha256 = digest('f')
  assert.throws(() => buildOmniGentComponentEvolutionView(stalePlanCapsule), /plan_state_invalid/)
  const stalePlanDecision = componentEvolutionView()
  stalePlanDecision.experiments[0]!.plan.decision_external_input_sha256 = digest('f')
  assert.throws(() => buildOmniGentComponentEvolutionView(stalePlanDecision), /plan_state_invalid/)
  const staleDecisionCapsuleId = componentEvolutionView()
  staleDecisionCapsuleId.experiments[0]!.decision.capsule_id = 'different-capsule'
  assert.throws(() => buildOmniGentComponentEvolutionView(staleDecisionCapsuleId), /decision_state_invalid/)
  const stalePlanDecisionId = componentEvolutionView()
  stalePlanDecisionId.experiments[0]!.plan.decision_id = 'different-decision'
  assert.throws(() => buildOmniGentComponentEvolutionView(stalePlanDecisionId), /plan_state_invalid/)
  const verifiedUnappliedWithoutReceipt = componentEvolutionView()
  verifiedUnappliedWithoutReceipt.experiments[0]!.plan.state = 'verified_unapplied'
  assert.throws(() => buildOmniGentComponentEvolutionView(verifiedUnappliedWithoutReceipt), /plan_state_invalid/)
  const sourceApplied = withComponentRuntimeEvidence(componentEvolutionView())
  sourceApplied.proof_level = 'source_verified'
  sourceApplied.experiments[0]!.proof_level = 'source_verified'
  assert.throws(() => buildOmniGentComponentEvolutionView(sourceApplied), /proof_overstated/)
  const appliedWithoutReceipt = withComponentRuntimeEvidence(componentEvolutionView())
  appliedWithoutReceipt.experiments[0]!.plan.applied_receipt_sha256 = null
  assert.throws(() => buildOmniGentComponentEvolutionView(appliedWithoutReceipt), /plan_state_invalid/)
  const runtimeWithPlannedArms = withComponentRuntimeEvidence(componentEvolutionView())
  for (const arm of runtimeWithPlannedArms.experiments[0]!.arms) {
    arm.execution_state = 'planned'
    arm.result_receipt_sha256 = null
  }
  assert.throws(() => buildOmniGentComponentEvolutionView(runtimeWithPlannedArms), /experiment_proof_incomplete/)
  const rollbackWithoutApplication = withComponentRuntimeEvidence(componentEvolutionView())
  rollbackWithoutApplication.experiments[0]!.plan.state = 'rolled_back'
  rollbackWithoutApplication.experiments[0]!.plan.applied_receipt_sha256 = null
  rollbackWithoutApplication.experiments[0]!.plan.rollback_receipt_sha256 = digest('5')
  assert.throws(() => buildOmniGentComponentEvolutionView(rollbackWithoutApplication), /plan_state_invalid/)
})

test('accepted seam artifacts reject synchronized stale-digest substitutions', () => {
  const capsuleAlias = withComponentRuntimeEvidence(componentEvolutionView())
  const capsuleRow = capsuleAlias.experiments[0]!
  capsuleRow.capsule_id = 'synchronized-capsule-alias'
  capsuleRow.decision.capsule_id = 'synchronized-capsule-alias'
  capsuleRow.plan.capsule_id = 'synchronized-capsule-alias'
  capsuleRow.capsule_artifact.capsule_id = 'synchronized-capsule-alias'
  capsuleRow.decision.artifact!.capsule_id = 'synchronized-capsule-alias'
  capsuleRow.plan.artifact!.capsule_id = 'synchronized-capsule-alias'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(capsuleAlias),
    /component_experiment_capsule_invalid/,
  )

  const decisionAlias = withComponentRuntimeEvidence(componentEvolutionView())
  const decisionRow = decisionAlias.experiments[0]!
  decisionRow.decision.decision_id = 'synchronized-decision-alias'
  decisionRow.plan.decision_id = 'synchronized-decision-alias'
  decisionRow.decision.artifact!.decision_id = 'synchronized-decision-alias'
  decisionRow.plan.artifact!.decision_id = 'synchronized-decision-alias'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(decisionAlias),
    /external_component_decision_invalid/,
  )

  const planAlias = withComponentRuntimeEvidence(componentEvolutionView())
  planAlias.experiments[0]!.plan.plan_id = 'synchronized-plan-alias'
  planAlias.experiments[0]!.plan.artifact!.plan_id = 'synchronized-plan-alias'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(planAlias),
    /component_reconfiguration_plan_invalid/,
  )

  const dispositionAlias = withComponentRuntimeEvidence(componentEvolutionView())
  dispositionAlias.experiments[0]!.decision.disposition = 'rollback'
  dispositionAlias.experiments[0]!.decision.artifact!.disposition = 'rollback'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(dispositionAlias),
    /external_component_decision_invalid/,
  )

  const planeAlias = withComponentRuntimeEvidence(componentEvolutionView())
  planeAlias.experiments[0]!.plane = 'frontier_builder_critic'
  planeAlias.experiments[0]!.capsule_artifact.plane = 'frontier_builder_critic'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(planeAlias),
    /component_experiment_capsule_invalid/,
  )

  const targetAlias = withComponentRuntimeEvidence(componentEvolutionView())
  targetAlias.experiments[0]!.target_component_ids = ['prompt-v1']
  targetAlias.experiments[0]!.capsule_artifact.target_component_ids = ['prompt-v1']
  targetAlias.experiments[0]!.plan.artifact!.target_component_ids = ['prompt-v1']
  assert.throws(
    () => buildOmniGentComponentEvolutionView(targetAlias),
    /component_experiment_capsule_invalid/,
  )

  const loadoutAlias = withComponentRuntimeEvidence(componentEvolutionView())
  for (const arm of loadoutAlias.experiments[0]!.arms) arm.loadout_manifest_sha256 = digest('f')
  for (const arm of loadoutAlias.experiments[0]!.capsule_artifact.arms) {
    arm.loadout_manifest_sha256 = digest('f')
  }
  assert.throws(
    () => buildOmniGentComponentEvolutionView(loadoutAlias),
    /component_experiment_controls_not_distinct/,
  )

  const planDigestAlias = withComponentRuntimeEvidence(componentEvolutionView())
  planDigestAlias.experiments[0]!.plan.plan_sha256 = digest('f')
  planDigestAlias.experiments[0]!.plan.artifact!.plan_sha256 = digest('f')
  assert.throws(
    () => buildOmniGentComponentEvolutionView(planDigestAlias),
    /component_reconfiguration_plan_invalid/,
  )
})

test('runtime proof requires structurally admitted operation artifacts and exact loadout readback', () => {
  const replayCandidate = withComponentRuntimeEvidence(componentEvolutionView())
  const replayExperiment = replayCandidate.experiments[0]!
  const replayFields = structuredClone(componentSeamFixture.plan_fields)
  replayFields.operation = 'replay'
  replayFields.current_loadout_manifest_sha256
    = replayExperiment.capsule_artifact.task_binding.loadout_manifest_sha256
  replayFields.replay_receipt_sha256 = null
  const replayPlan = prepareComponentReconfigurationPlan({
    ...replayFields,
    capsule: replayExperiment.capsule_artifact,
    decision: replayExperiment.decision.artifact!,
  })
  replayExperiment.plan = {
    ...replayExperiment.plan,
    operation: replayPlan.operation,
    plan_id: replayPlan.plan_id,
    capsule_id: replayPlan.capsule_id,
    decision_id: replayPlan.decision_id,
    plan_sha256: replayPlan.plan_sha256,
    post_loadout_manifest_sha256: replayExperiment.capsule_artifact.task_binding.loadout_manifest_sha256,
    capsule_sha256: replayPlan.capsule_sha256,
    decision_external_input_sha256: replayPlan.decision_external_input_sha256,
    replay_receipt_sha256: null,
    blocker_resolutions: [{
      blocker: 'typed_blocker:external_decision_authority_unverified',
      receipt_sha256: replayExperiment.decision.authority_receipt_sha256!,
    }],
    artifact: replayPlan,
  }
  replayCandidate.active_loadout.manifest_sha256
    = replayExperiment.capsule_artifact.task_binding.loadout_manifest_sha256
  assert.throws(
    () => buildOmniGentComponentEvolutionView(replayCandidate),
    /typed_blocker:(component_view_plan_execution_admission_invalid|component_operation_result_invalid)/,
  )

  const dispositionCandidate = withComponentRuntimeEvidence(componentEvolutionView())
  const dispositionExperiment = dispositionCandidate.experiments[0]!
  const decisionInput = structuredClone(componentSeamFixture.decision_input)
  decisionInput.decision_id = 'decision-rollback-for-swap'
  decisionInput.capsule_id = dispositionExperiment.capsule_artifact.capsule_id
  decisionInput.capsule_sha256 = dispositionExperiment.capsule_artifact.capsule_sha256
  decisionInput.decision_kind = 'rollback_recommendation'
  decisionInput.disposition = 'rollback'
  const rollbackDecision = acceptExternalComponentDecision(
    decisionInput, dispositionExperiment.capsule_artifact,
  )
  const swapFields = structuredClone(componentSeamFixture.plan_fields)
  swapFields.operation = 'swap'
  swapFields.current_loadout_manifest_sha256
    = dispositionExperiment.capsule_artifact.task_binding.loadout_manifest_sha256
  const blockedSwapPlan = prepareComponentReconfigurationPlan({
    ...swapFields,
    capsule: dispositionExperiment.capsule_artifact,
    decision: rollbackDecision,
  })
  dispositionExperiment.decision = {
    state: 'verified', decision_id: rollbackDecision.decision_id,
    capsule_id: rollbackDecision.capsule_id,
    external_input_sha256: rollbackDecision.external_input_sha256,
    capsule_sha256: rollbackDecision.capsule_sha256,
    disposition: rollbackDecision.disposition,
    authority_receipt_sha256: digest('1'), training_gate_receipt_sha256: null,
    artifact: rollbackDecision,
  }
  dispositionExperiment.plan = {
    ...dispositionExperiment.plan,
    operation: blockedSwapPlan.operation,
    plan_id: blockedSwapPlan.plan_id,
    capsule_id: blockedSwapPlan.capsule_id,
    decision_id: blockedSwapPlan.decision_id,
    plan_sha256: blockedSwapPlan.plan_sha256,
    capsule_sha256: blockedSwapPlan.capsule_sha256,
    decision_external_input_sha256: blockedSwapPlan.decision_external_input_sha256,
    artifact: blockedSwapPlan,
  }
  assert.throws(
    () => buildOmniGentComponentEvolutionView(dispositionCandidate),
    /typed_blocker:(component_view_plan_execution_admission_invalid|component_operation_result_invalid)/,
  )

  const wrongLoadout = withComponentRuntimeEvidence(componentEvolutionView())
  wrongLoadout.active_loadout.manifest_sha256 = digest('f')
  assert.throws(
    () => buildOmniGentComponentEvolutionView(wrongLoadout),
    /typed_blocker:component_view_active_loadout_binding_invalid/,
  )
})

test('runtime and deployed proof require exact component-generation post-operation readback', () => {
  const inactiveTarget = withComponentRuntimeEvidence(componentEvolutionView())
  const parent = inactiveTarget.components.find(component => component.component_id === 'prompt-v1')!
  parent.active = true
  parent.lifecycle_state = 'active'
  parent.valid_until = null
  const candidate = inactiveTarget.components.find(component => component.component_id === 'prompt-v2')!
  candidate.active = false
  candidate.lifecycle_state = 'inactive'
  candidate.valid_from = null
  assert.throws(
    () => buildOmniGentComponentEvolutionView(inactiveTarget),
    /typed_blocker:component_view_post_operation_readback_invalid/,
  )

  const deployedInactiveTarget = withComponentRuntimeEvidence(componentEvolutionView())
  deployedInactiveTarget.proof_level = 'deployed_verified'
  deployedInactiveTarget.deployment_receipt_sha256 = digest('3')
  deployedInactiveTarget.experiments[0]!.proof_level = 'deployed_verified'
  const deployedParent = deployedInactiveTarget.components.find(
    component => component.component_id === 'prompt-v1',
  )!
  deployedParent.active = true
  deployedParent.lifecycle_state = 'active'
  deployedParent.valid_until = null
  const deployedCandidate = deployedInactiveTarget.components.find(
    component => component.component_id === 'prompt-v2',
  )!
  deployedCandidate.active = false
  deployedCandidate.lifecycle_state = 'inactive'
  deployedCandidate.valid_from = null
  assert.throws(
    () => buildOmniGentComponentEvolutionView(deployedInactiveTarget),
    /typed_blocker:component_view_post_operation_readback_invalid/,
  )
})

test('operation results preserve non-activating replay and parent-restoring rollback semantics', () => {
  const source = componentEvolutionView()
  const experiment = source.experiments[0]!
  const replayFields = structuredClone(componentSeamFixture.plan_fields)
  replayFields.operation = 'replay'
  replayFields.current_loadout_manifest_sha256
    = experiment.capsule_artifact.task_binding.loadout_manifest_sha256
  replayFields.replay_receipt_sha256 = digest('e')
  const replayPlan = prepareComponentReconfigurationPlan({
    ...replayFields, capsule: experiment.capsule_artifact,
    decision: experiment.decision.artifact!,
  })
  const replayResult = buildComponentOperationResult({
    capsule: experiment.capsule_artifact,
    decision: experiment.decision.artifact!,
    plan: replayPlan,
    post_loadout_manifest_sha256: replayPlan.current_loadout_manifest_sha256,
    observed_components: source.components,
    verification_receipt_sha256: digest('6'),
    operation_receipt_sha256: digest('e'),
    observed_at: '2026-09-01T00:02:00Z',
  })
  assert.equal(replayResult.receipt_class, 'replay')
  assert.equal(replayResult.activation_changed, false)
  assert.equal(replayResult.pre_loadout_manifest_sha256, replayResult.post_loadout_manifest_sha256)

  const rollbackInput = structuredClone(componentSeamFixture.decision_input)
  rollbackInput.decision_id = 'decision-rollback-result'
  rollbackInput.capsule_id = experiment.capsule_artifact.capsule_id
  rollbackInput.capsule_sha256 = experiment.capsule_artifact.capsule_sha256
  rollbackInput.decision_kind = 'rollback_recommendation'
  rollbackInput.disposition = 'rollback'
  const rollbackDecision = acceptExternalComponentDecision(
    rollbackInput, experiment.capsule_artifact,
  )
  const rollbackFields = structuredClone(componentSeamFixture.plan_fields)
  rollbackFields.operation = 'rollback'
  rollbackFields.current_loadout_manifest_sha256
    = experiment.capsule_artifact.task_binding.loadout_manifest_sha256
  rollbackFields.rollback_receipt_sha256 = digest('f')
  const rollbackPlan = prepareComponentReconfigurationPlan({
    ...rollbackFields, capsule: experiment.capsule_artifact, decision: rollbackDecision,
  })
  const rollbackResult = buildComponentOperationResult({
    capsule: experiment.capsule_artifact,
    decision: rollbackDecision,
    plan: rollbackPlan,
    post_loadout_manifest_sha256: rollbackPlan.current_loadout_manifest_sha256,
    observed_components: source.components,
    verification_receipt_sha256: digest('6'),
    operation_receipt_sha256: digest('f'),
    observed_at: '2026-09-01T00:02:00Z',
  })
  assert.equal(rollbackResult.receipt_class, 'rollback')
  assert.equal(rollbackResult.activation_changed, true)
  assert.equal(rollbackResult.pre_loadout_manifest_sha256, rollbackResult.post_loadout_manifest_sha256)
})

test('component runtime and deployment proof levels require the complete floor', () => {
  const source = componentEvolutionView()
  source.proof_level = 'runtime_verified'
  assert.throws(() => buildOmniGentComponentEvolutionView(source), /runtime_proof_incomplete/)
  const runtime = withComponentRuntimeEvidence(componentEvolutionView())
  assertComponentViewSchema(runtime)
  assert.equal(buildOmniGentComponentEvolutionView(runtime).proof_level, 'runtime_verified')
  const deployedWithoutReceipt = withComponentRuntimeEvidence(componentEvolutionView())
  deployedWithoutReceipt.proof_level = 'deployed_verified'
  deployedWithoutReceipt.experiments[0]!.proof_level = 'deployed_verified'
  assert.throws(() => buildOmniGentComponentEvolutionView(deployedWithoutReceipt), /deployment_proof_incomplete/)
  const deployedWithRuntimeOnlyExperiment = withComponentRuntimeEvidence(componentEvolutionView())
  deployedWithRuntimeOnlyExperiment.proof_level = 'deployed_verified'
  deployedWithRuntimeOnlyExperiment.deployment_receipt_sha256 = digest('3')
  assert.throws(() => buildOmniGentComponentEvolutionView(deployedWithRuntimeOnlyExperiment), /deployment_proof_incomplete/)
  const deployed = withComponentRuntimeEvidence(componentEvolutionView())
  deployed.proof_level = 'deployed_verified'
  deployed.experiments[0]!.proof_level = 'deployed_verified'
  deployed.deployment_receipt_sha256 = digest('3')
  assertComponentViewSchema(deployed)
})

test('component valid time and strict UTC calendar dates reject normalization', () => {
  const impossible = componentEvolutionView()
  impossible.components[0]!.transaction_time = '2026-02-31T00:00:00Z'
  assert.throws(() => buildOmniGentComponentEvolutionView(impossible), /timestamp_invalid/)
  const reversed = componentEvolutionView()
  reversed.components[1]!.valid_from = '2026-09-02T00:00:00Z'
  reversed.components[1]!.valid_until = '2026-09-01T00:00:00Z'
  assert.throws(() => buildOmniGentComponentEvolutionView(reversed), /component_state_invalid/)
  const fractionalReversal = componentEvolutionView()
  fractionalReversal.components[1]!.valid_from = '2026-09-01T00:00:00.1Z'
  fractionalReversal.components[1]!.valid_until = '2026-09-01T00:00:00Z'
  assert.throws(() => buildOmniGentComponentEvolutionView(fractionalReversal), /component_state_invalid/)
  const centuryBoundaryReversal = componentEvolutionView()
  centuryBoundaryReversal.components[1]!.valid_from = '0100-01-01T00:00:00Z'
  centuryBoundaryReversal.components[1]!.valid_until = '0099-12-31T23:59:59Z'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(centuryBoundaryReversal),
    /component_state_invalid/,
  )
  const centuryParentAfterChild = componentEvolutionView()
  centuryParentAfterChild.components[0]!.transaction_time = '0100-01-01T00:00:00Z'
  centuryParentAfterChild.components[1]!.transaction_time = '0099-12-31T23:59:59Z'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(centuryParentAfterChild),
    /parent_identity_invalid/,
  )
  const centuryTimelineReversal = componentEvolutionView()
  centuryTimelineReversal.timeline[0]!.transaction_time = '0100-01-01T00:00:00Z'
  centuryTimelineReversal.timeline[1]!.transaction_time = '0099-12-31T23:59:59Z'
  assert.throws(
    () => buildOmniGentComponentEvolutionView(centuryTimelineReversal),
    /timeline_identity_or_order_invalid/,
  )
  const activeUntil = componentEvolutionView()
  activeUntil.components[0]!.valid_until = '2026-09-02T00:00:00Z'
  assert.throws(() => buildOmniGentComponentEvolutionView(activeUntil), /component_state_invalid/)
})

test('optimizer ports remain proposal-only and external is a strategy, not a plane', () => {
  const available = componentEvolutionView()
  available.optimizer_ports[0]!.state = 'available'
  available.optimizer_ports[0]!.receipt_sha256 = digest('4')
  assertComponentViewSchema(available)
  const unauthorized = componentEvolutionView() as any
  unauthorized.optimizer_ports[0].apply_authorized = true
  assert.throws(() => buildOmniGentComponentEvolutionView(unauthorized), /optimizer_state_invalid/)
  const externalPlane = componentEvolutionView() as any
  externalPlane.optimizer_ports[1].plane = 'external_optimizer'
  assert.throws(() => buildOmniGentComponentEvolutionView(externalPlane), /plane_invalid/)
  const blockedWithoutReason = componentEvolutionView()
  blockedWithoutReason.optimizer_ports[1]!.blocker = null
  assert.throws(() => buildOmniGentComponentEvolutionView(blockedWithoutReason), /optimizer_state_invalid/)
})

test('component view rejects numeric aliases, duplicate non-claims, and invalid receipts', () => {
  const floatGeneration = componentEvolutionView() as any
  floatGeneration.components[0].generation = 1.5
  assert.throws(() => buildOmniGentComponentEvolutionView(floatGeneration), /generation_invalid/)
  const booleanSequence = componentEvolutionView() as any
  booleanSequence.timeline[0].sequence = true
  assert.throws(() => buildOmniGentComponentEvolutionView(booleanSequence), /timeline_sequence_invalid/)
  const duplicateClaims = componentEvolutionView()
  duplicateClaims.non_claims = ['duplicate', 'duplicate']
  assert.throws(() => buildOmniGentComponentEvolutionView(duplicateClaims), /non_claims_invalid/)
  const badDigest = componentEvolutionView()
  badDigest.component_manifest_sha256 = 'not-a-digest'
  assert.throws(() => buildOmniGentComponentEvolutionView(badDigest), /digest_invalid/)
})

test('component timeline causality and Trace states require exact receipts', () => {
  const causal = componentEvolutionView()
  causal.timeline[0]!.causality_state = 'verified'
  assert.throws(() => buildOmniGentComponentEvolutionView(causal), /causality_receipt_missing/)
  const nonCausalReceipt = componentEvolutionView()
  nonCausalReceipt.timeline[0]!.receipt_sha256 = digest('4')
  assert.throws(() => buildOmniGentComponentEvolutionView(nonCausalReceipt), /causality_state_invalid/)
  const reversedTransactionTime = componentEvolutionView()
  reversedTransactionTime.timeline[0]!.transaction_time = '2026-09-01T00:02:00Z'
  assert.throws(() => buildOmniGentComponentEvolutionView(reversedTransactionTime), /timeline_identity_or_order_invalid/)
  const appendWithoutReceipts = componentEvolutionView()
  appendWithoutReceipts.trace.state = 'append_verified'
  appendWithoutReceipts.trace.blocker = null
  assert.throws(() => buildOmniGentComponentEvolutionView(appendWithoutReceipts), /trace_state_invalid/)
  const nonAppendReceipt = componentEvolutionView()
  nonAppendReceipt.trace.append_receipt_sha256 = digest('5')
  assert.throws(() => buildOmniGentComponentEvolutionView(nonAppendReceipt), /trace_state_invalid/)
  const replayReceiptDrift = componentEvolutionView()
  replayReceiptDrift.replay.receipt_sha256 = digest('6')
  assert.throws(() => buildOmniGentComponentEvolutionView(replayReceiptDrift), /replay_state_invalid/)
})

test('public component projection revalidation rejects semantic reseals', () => {
  const source = buildOmniGentComponentEvolutionView(componentEvolutionView())
  assert.deepEqual(validateOmniGentComponentEvolutionView(source), source)
  const crossLineage: any = structuredClone(source)
  crossLineage.components[1].logical_identity = 'wrong-lineage'
  assert.throws(() => validateOmniGentComponentEvolutionView(crossLineage), /parent_identity_invalid/)
  const reversedTimeline: any = structuredClone(source)
  reversedTimeline.timeline[0].transaction_time = '2026-09-01T00:02:00Z'
  assert.throws(() => validateOmniGentComponentEvolutionView(reversedTimeline), /timeline_identity_or_order_invalid/)
  const centuryBoundaryReseal: any = structuredClone(source)
  centuryBoundaryReseal.components[1].valid_from = '0100-01-01T00:00:00Z'
  centuryBoundaryReseal.components[1].valid_until = '0099-12-31T23:59:59Z'
  // Bind the exact stale view hash produced by the Round 2 counterexample.
  centuryBoundaryReseal.view_sha256 = '5721ecebd3006ed080af63ce958150bbd3f6b24988670fbec8d20567a8a24d24'
  assert.throws(
    () => validateOmniGentComponentEvolutionView(centuryBoundaryReseal),
    /component_state_invalid/,
  )
  const swappedControlReseal: any = structuredClone(source)
  const baseDelta = swappedControlReseal.experiments[0].arms[0].applied_delta_sha256
  swappedControlReseal.experiments[0].arms[0].applied_delta_sha256
    = swappedControlReseal.experiments[0].arms[1].applied_delta_sha256
  swappedControlReseal.experiments[0].arms[1].applied_delta_sha256 = baseDelta
  swappedControlReseal.view_sha256 = '182e44f350ebb5cfe60caca54e66384f71ad0373ec72a6bf998e20aeddacc962'
  assert.throws(
    () => validateOmniGentComponentEvolutionView(swappedControlReseal),
    /arms_invalid/,
  )
  const staleCapsuleReseal: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  staleCapsuleReseal.experiments[0].capsule_sha256 = digest('f')
  staleCapsuleReseal.view_sha256 = '716ae3df84961b631d78180f407ffbb956ce25a5da8d1a89ab2ff812612059d8'
  assert.throws(
    () => validateOmniGentComponentEvolutionView(staleCapsuleReseal),
    /capsule_artifact_mismatch/,
  )
  const synchronizedCapsuleReseal: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  const synchronizedRow = synchronizedCapsuleReseal.experiments[0]
  synchronizedRow.capsule_id = 'synchronized-capsule-alias'
  synchronizedRow.decision.capsule_id = 'synchronized-capsule-alias'
  synchronizedRow.plan.capsule_id = 'synchronized-capsule-alias'
  synchronizedRow.capsule_artifact.capsule_id = 'synchronized-capsule-alias'
  synchronizedRow.decision.artifact.capsule_id = 'synchronized-capsule-alias'
  synchronizedRow.plan.artifact.capsule_id = 'synchronized-capsule-alias'
  synchronizedCapsuleReseal.view_sha256 = '51d57de8f48dc877de5a8fe0814f84f0871bc2825a9ef4c1f1965c9bceff99d3'
  assert.throws(
    () => validateOmniGentComponentEvolutionView(synchronizedCapsuleReseal),
    /component_experiment_capsule_invalid/,
  )
  const blockedReplayReseal: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  const blockedReplayExperiment = blockedReplayReseal.experiments[0]
  const blockedReplayFields = structuredClone(componentSeamFixture.plan_fields)
  blockedReplayFields.operation = 'replay'
  blockedReplayFields.current_loadout_manifest_sha256
    = blockedReplayExperiment.capsule_artifact.task_binding.loadout_manifest_sha256
  blockedReplayFields.replay_receipt_sha256 = null
  const blockedReplayPlan = prepareComponentReconfigurationPlan({
    ...blockedReplayFields,
    capsule: blockedReplayExperiment.capsule_artifact,
    decision: blockedReplayExperiment.decision.artifact,
  })
  Object.assign(blockedReplayExperiment.plan, {
    operation: blockedReplayPlan.operation,
    plan_id: blockedReplayPlan.plan_id,
    capsule_id: blockedReplayPlan.capsule_id,
    decision_id: blockedReplayPlan.decision_id,
    plan_sha256: blockedReplayPlan.plan_sha256,
    post_loadout_manifest_sha256:
      blockedReplayExperiment.capsule_artifact.task_binding.loadout_manifest_sha256,
    capsule_sha256: blockedReplayPlan.capsule_sha256,
    decision_external_input_sha256: blockedReplayPlan.decision_external_input_sha256,
    replay_receipt_sha256: null,
    artifact: blockedReplayPlan,
  })
  blockedReplayReseal.active_loadout.manifest_sha256
    = blockedReplayExperiment.capsule_artifact.task_binding.loadout_manifest_sha256
  blockedReplayReseal.view_sha256 = '7356f3edd788a5aec3b0d3cd1e4150f498753742d1f727c0999c29d2e4fe59ff'
  assert.throws(
    () => validateOmniGentComponentEvolutionView(blockedReplayReseal),
    /typed_blocker:(component_view_plan_execution_admission_invalid|component_operation_result_invalid)/,
  )
  const inactiveTargetReseal: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  const inactiveParent = inactiveTargetReseal.components.find(
    (component: any) => component.component_id === 'prompt-v1',
  )
  inactiveParent.active = true
  inactiveParent.lifecycle_state = 'active'
  inactiveParent.valid_until = null
  const inactiveCandidate = inactiveTargetReseal.components.find(
    (component: any) => component.component_id === 'prompt-v2',
  )
  inactiveCandidate.active = false
  inactiveCandidate.lifecycle_state = 'inactive'
  inactiveCandidate.valid_from = null
  inactiveTargetReseal.view_sha256 = 'a946f7968530aeff0421353c55cc148b7d39e3ef8fff520d0208311f230ddfa7'
  assert.throws(
    () => validateOmniGentComponentEvolutionView(inactiveTargetReseal),
    /typed_blocker:component_view_post_operation_readback_invalid/,
  )
  const wrongViewHash: any = structuredClone(source)
  wrongViewHash.view_sha256 = digest('f')
  assert.throws(() => validateOmniGentComponentEvolutionView(wrongViewHash), /public_revalidation_failed/)
})

test('component public schema mirrors every expressible proof and receipt join', () => {
  const schema = schemaFiles['omnigent-component-evolution-read-model.v1.schema.json']
  const wrongControl: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  wrongControl.experiments[0].arms[0].control_strategy = 'candidate_delta'
  assert.notDeepEqual(schemaErrors(wrongControl, schema, schema), [])

  const missingTargetSet: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  delete missingTargetSet.experiments[0].target_set_sha256
  assert.notDeepEqual(schemaErrors(missingTargetSet, schema, schema), [])

  const missingDecisionBinding: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  missingDecisionBinding.experiments[0].decision.capsule_sha256 = null
  assert.notDeepEqual(schemaErrors(missingDecisionBinding, schema, schema), [])

  const missingPlanBinding: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  missingPlanBinding.experiments[0].plan.decision_external_input_sha256 = null
  assert.notDeepEqual(schemaErrors(missingPlanBinding, schema, schema), [])

  const verifiedUnapplied: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  verifiedUnapplied.experiments[0].plan.state = 'verified_unapplied'
  assert.notDeepEqual(schemaErrors(verifiedUnapplied, schema, schema), [])

  const runtimePlannedArms: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  for (const arm of runtimePlannedArms.experiments[0].arms) {
    arm.execution_state = 'planned'
    arm.result_receipt_sha256 = null
  }
  assert.notDeepEqual(schemaErrors(runtimePlannedArms, schema, schema), [])

  const runtimeWithoutAdmission: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  runtimeWithoutAdmission.experiments[0].plan.blocker_resolutions = []
  assert.notDeepEqual(schemaErrors(runtimeWithoutAdmission, schema, schema), [])

  const runtimeWithoutPostLoadout: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  runtimeWithoutPostLoadout.experiments[0].plan.post_loadout_manifest_sha256 = null
  assert.notDeepEqual(schemaErrors(runtimeWithoutPostLoadout, schema, schema), [])

  const deployedRuntimeOnly: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  deployedRuntimeOnly.proof_level = 'deployed_verified'
  deployedRuntimeOnly.deployment_receipt_sha256 = digest('3')
  assert.notDeepEqual(schemaErrors(deployedRuntimeOnly, schema, schema), [])

  const rolledBack: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  rolledBack.experiments[0].plan.state = 'rolled_back'
  rolledBack.experiments[0].plan.rollback_receipt_sha256 = digest('5')
  rolledBack.experiments[0].plan.applied_receipt_sha256 = null
  assert.notDeepEqual(schemaErrors(rolledBack, schema, schema), [])

  const nonCausalReceipt: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  nonCausalReceipt.timeline[0].receipt_sha256 = digest('4')
  assert.notDeepEqual(schemaErrors(nonCausalReceipt, schema, schema), [])
})
