import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildFactoryHandoff,
  buildOmniGentComponentEvolutionView,
  buildOmniGentHarnessView,
  validateOmniGentComponentEvolutionView,
  type FactoryHandoffInput,
  type OmniGentComponentEvolutionViewInput,
  type OmniGentHarnessViewInput,
} from '../src/index.ts'

const digest = (letter: string): string => letter.repeat(64)

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
  return {
    generated_at: '2026-09-01T00:00:00Z',
    task_capsule_id: 'capsule-component-view',
    run_id: 'run-component-view',
    harness_generation: 'next_deepseek_cordis',
    active_loadout: { loadout_id: 'retrodict-default-v1', manifest_sha256: digest('a') },
    component_manifest_sha256: digest('b'),
    mutation_surface_registry_sha256: digest('c'),
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
        capsule_id: 'capsule-prompt',
        capsule_sha256: digest('2'),
        plane: 'local_idle_compute',
        target_component_ids: ['prompt-v2'],
        target_surface_ids: ['prompt'],
        arms: [
          {
            role: 'BASE', loadout_manifest_sha256: digest('a'),
            component_set_sha256: digest('3'), applied_delta_sha256: digest('4'),
            execution_state: 'planned', result_receipt_sha256: null,
          },
          {
            role: 'TRUE', loadout_manifest_sha256: digest('a'),
            component_set_sha256: digest('5'), applied_delta_sha256: digest('6'),
            execution_state: 'planned', result_receipt_sha256: null,
          },
          {
            role: 'SHAM', loadout_manifest_sha256: digest('a'),
            component_set_sha256: digest('7'), applied_delta_sha256: digest('8'),
            execution_state: 'planned', result_receipt_sha256: null,
          },
        ],
        decision: {
          state: 'untrusted', decision_id: 'decision-prompt',
          decision_sha256: digest('9'), disposition: 'accept_candidate',
          authority_receipt_sha256: null,
        },
        plan: {
          state: 'prepared_unexecuted', plan_id: 'plan-prompt',
          plan_sha256: digest('0'), verification_receipt_sha256: null,
          applied_receipt_sha256: null,
          replay_receipt_sha256: null, rollback_receipt_sha256: null,
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
    state: 'verified', decision_id: 'decision-prompt',
    decision_sha256: digest('9'), disposition: 'accept_candidate',
    authority_receipt_sha256: digest('1'),
  }
  experiment.plan = {
    state: 'applied', plan_id: 'plan-prompt', plan_sha256: digest('0'),
    verification_receipt_sha256: digest('6'), applied_receipt_sha256: digest('2'),
    replay_receipt_sha256: null,
    rollback_receipt_sha256: null,
  }
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
    candidate => { candidate.experiments[0].arms[0].extra = true },
    candidate => { candidate.experiments[0].decision.extra = true },
    candidate => { candidate.experiments[0].plan.extra = true },
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
    assert.throws(() => buildOmniGentComponentEvolutionView(input), /closure_invalid/)
    const output: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
    mutate(output)
    assert.notDeepEqual(schemaErrors(output, schema, schema), [])
  }
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
  assert.throws(() => buildOmniGentComponentEvolutionView(unknownTarget), /experiment_identity_invalid/)
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
  const modelWeights = componentEvolutionView()
  modelWeights.experiments[0]!.target_surface_ids = ['model_weights']
  assert.throws(() => buildOmniGentComponentEvolutionView(modelWeights), /model_weights_plane_invalid/)
  const targetSurfaceMismatch = componentEvolutionView()
  targetSurfaceMismatch.experiments[0]!.target_surface_ids = ['router']
  assert.throws(() => buildOmniGentComponentEvolutionView(targetSurfaceMismatch), /experiment_target_mismatch/)
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
  const wrongViewHash: any = structuredClone(source)
  wrongViewHash.view_sha256 = digest('f')
  assert.throws(() => validateOmniGentComponentEvolutionView(wrongViewHash), /public_revalidation_failed/)
})

test('component public schema mirrors every expressible proof and receipt join', () => {
  const schema = schemaFiles['omnigent-component-evolution-read-model.v1.schema.json']
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

  const deployedRuntimeOnly: any = buildOmniGentComponentEvolutionView(
    withComponentRuntimeEvidence(componentEvolutionView()),
  )
  deployedRuntimeOnly.proof_level = 'deployed_verified'
  deployedRuntimeOnly.deployment_receipt_sha256 = digest('3')
  assert.notDeepEqual(schemaErrors(deployedRuntimeOnly, schema, schema), [])

  const rolledBackInput = withComponentRuntimeEvidence(componentEvolutionView())
  rolledBackInput.experiments[0]!.plan.state = 'rolled_back'
  rolledBackInput.experiments[0]!.plan.rollback_receipt_sha256 = digest('5')
  const rolledBack: any = buildOmniGentComponentEvolutionView(rolledBackInput)
  rolledBack.experiments[0].plan.applied_receipt_sha256 = null
  assert.notDeepEqual(schemaErrors(rolledBack, schema, schema), [])

  const nonCausalReceipt: any = buildOmniGentComponentEvolutionView(componentEvolutionView())
  nonCausalReceipt.timeline[0].receipt_sha256 = digest('4')
  assert.notDeepEqual(schemaErrors(nonCausalReceipt, schema, schema), [])
})
