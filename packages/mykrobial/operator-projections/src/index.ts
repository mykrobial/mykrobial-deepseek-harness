/** Pure read models for OmniGent and either Software Factory generation. */
import { createHash } from 'node:crypto'

export type ProofLevel = 'designed' | 'source_built' | 'source_verified' | 'runtime_verified' | 'deployed_verified'
export type PrhStage = 'Abstract' | 'Extract' | 'Interact' | 'Act' | 'React' | 'Counteract' | 'Protract' | 'Enact' | 'Transact'
export type FactoryId = 'legacy_four_gate' | 'super_simple_software_factory' | 'unresolved'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA = /^[0-9a-f]{64}$/
const GIT_OBJECT = /^[0-9a-f]{40}$/
const UTC = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/
const TYPED_BLOCKER = /^typed_blocker:[a-z0-9_:-]+$/
const PROOF_LEVELS: readonly ProofLevel[] = ['designed', 'source_built', 'source_verified', 'runtime_verified', 'deployed_verified']
const PRH_STAGES: readonly PrhStage[] = ['Abstract', 'Extract', 'Interact', 'Act', 'React', 'Counteract', 'Protract', 'Enact', 'Transact']
const FACTORY_IDS: readonly FactoryId[] = ['legacy_four_gate', 'super_simple_software_factory', 'unresolved']
const ROUTE_STATES = ['not_requested', 'prepared', 'served_unverified', 'served_verified', 'blocked'] as const
const TRACE_STATES = ['intent_only', 'queued', 'append_verified', 'blocked'] as const
const REPLAY_STATES = ['available', 'verified', 'blocked'] as const
const ROLLBACK_STATES = ['declared', 'rehearsed', 'verified', 'blocked'] as const
const FACTORY_INTEGRATION_STATES = ['contract_only', 'source_wired', 'runtime_verified', 'blocked'] as const
const ACCEPTANCE_STATES = ['pending', 'passed', 'failed', 'blocked'] as const

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('typed_blocker:operator_projection_nonfinite_number')
    return value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) result[key] = normalize(child)
    }
    return result
  }
  throw new Error('typed_blocker:operator_projection_value_invalid')
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalize(value)), 'utf8').digest('hex')
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('typed_blocker:operator_projection_identity_invalid')
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error('typed_blocker:operator_projection_digest_invalid')
  return value
}

function optionalDigest(value: unknown): void {
  if (value !== null) digest(value)
}

function unicodeLength(value: string): number {
  return Array.from(value).length
}

function boundedText(value: unknown, maximum: number): void {
  if (value !== null && (typeof value !== 'string' || unicodeLength(value) > maximum)) {
    throw new Error('typed_blocker:operator_projection_text_invalid')
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], blocker: string): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`typed_blocker:${blocker}`)
}

function requireRecord(value: unknown, blocker: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`typed_blocker:${blocker}`)
  }
}

function requireExactRecord(value: unknown, keys: readonly string[], blocker: string): asserts value is Record<string, unknown> {
  requireRecord(value, blocker)
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length
    || actual.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`typed_blocker:${blocker}`)
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function validTimestamp(value: unknown): void {
  const match = typeof value === 'string' ? UTC.exec(value) : null
  if (match === null) {
    throw new Error('typed_blocker:omnigent_generated_at_invalid')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error('typed_blocker:omnigent_generated_at_invalid')
  }
}

export interface FactoryHandoffInput {
  handoff_id: string
  factory_id: FactoryId
  task_capsule_id: string
  work_item_id: string
  prh_stage: PrhStage
  frozen_prediction_sha256: string
  built_artifact_sha256: string[]
  proof_level: ProofLevel
  next_action: string
  blockers: string[]
}

export type FactoryHandoff = FactoryHandoffInput & {
  schema: 'mykrobial.software-factory.handoff.v1'
  execution_authorized: false
  deployment_authorized: false
  handoff_sha256: string
}

export function buildFactoryHandoff(source: FactoryHandoffInput): FactoryHandoff {
  requireExactRecord(source, [
    'handoff_id', 'factory_id', 'task_capsule_id', 'work_item_id', 'prh_stage',
    'frozen_prediction_sha256', 'built_artifact_sha256', 'proof_level', 'next_action', 'blockers',
  ], 'software_factory_handoff_object_closure_invalid')
  const input = structuredClone(source)
  oneOf(input.factory_id, FACTORY_IDS, 'software_factory_id_invalid')
  oneOf(input.prh_stage, PRH_STAGES, 'software_factory_prh_stage_invalid')
  oneOf(input.proof_level, PROOF_LEVELS, 'software_factory_proof_level_invalid')
  id(input.handoff_id); id(input.task_capsule_id); id(input.work_item_id)
  digest(input.frozen_prediction_sha256)
  if (!Array.isArray(input.built_artifact_sha256)) throw new Error('typed_blocker:software_factory_handoff_incomplete')
  const builtArtifacts = input.built_artifact_sha256.map(value => digest(value))
  if (new Set(builtArtifacts).size !== builtArtifacts.length) {
    throw new Error('typed_blocker:software_factory_handoff_duplicate_artifact_invalid')
  }
  input.built_artifact_sha256 = [...builtArtifacts].sort()
  if (input.built_artifact_sha256.length === 0 || typeof input.next_action !== 'string'
    || unicodeLength(input.next_action) === 0 || unicodeLength(input.next_action) > 1024) {
    throw new Error('typed_blocker:software_factory_handoff_incomplete')
  }
  if (!Array.isArray(input.blockers) || input.blockers.some(value => typeof value !== 'string')) {
    throw new Error('typed_blocker:software_factory_handoff_blocker_invalid')
  }
  if (new Set(input.blockers).size !== input.blockers.length) {
    throw new Error('typed_blocker:software_factory_handoff_duplicate_blocker_invalid')
  }
  input.blockers = [...input.blockers].sort()
  if (input.blockers.some(value => !TYPED_BLOCKER.test(value))) {
    throw new Error('typed_blocker:software_factory_handoff_blocker_invalid')
  }
  const body = {
    ...input,
    schema: 'mykrobial.software-factory.handoff.v1' as const,
    execution_authorized: false as const,
    deployment_authorized: false as const,
  }
  return { ...body, handoff_sha256: hash(body) }
}

export interface OmniGentHarnessViewInput {
  generated_at: string
  task_capsule_id: string
  harness_generation: 'current_production' | 'next_deepseek_cordis'
  source_identity: { repository: string; commit: string; tree: string; dirty_state: 'clean' | 'dirty_bound' | 'unknown'; configuration_sha256: string }
  loadout_id: string
  component_manifest_sha256: string
  behavior_projection_sha256: string
  scientific_posture: 'base' | 'retrodict_default' | 'retrodict_simulator_escalated' | 'retrodict_novelty_escape'
  route: { state: 'not_requested' | 'prepared' | 'served_unverified' | 'served_verified' | 'blocked'; requested_model: string | null; routed_model: string | null; served_model: string | null; provider: string | null; receipt_sha256: string | null }
  trace: { state: 'intent_only' | 'queued' | 'append_verified' | 'blocked'; intent_count: number; canonical_append_receipt_sha256: string | null; blocker: string | null }
  replay: { state: 'available' | 'verified' | 'blocked'; receipt_sha256: string | null }
  rollback: { state: 'declared' | 'rehearsed' | 'verified' | 'blocked'; receipt_sha256: string | null }
  factory: { factory_id: FactoryId; integration_state: 'contract_only' | 'source_wired' | 'runtime_verified' | 'blocked'; prh_stage: PrhStage; work_item_id: string; handoff_sha256: string }
  proof_level: ProofLevel
  end_user_acceptance: Array<{ step_id: string; description: string; state: 'pending' | 'passed' | 'failed' | 'blocked'; receipt_sha256: string | null }>
  non_claims: string[]
}

export type OmniGentHarnessView = OmniGentHarnessViewInput & { schema: 'mykrobial.omnigent.harness-read-model.v1' }

function hasVerifiedRuntimeEvidence(input: OmniGentHarnessViewInput): boolean {
  return input.route.state === 'served_verified'
    && input.trace.state === 'append_verified'
    && input.replay.state === 'verified'
    && input.rollback.state === 'verified'
    && input.factory.integration_state === 'runtime_verified'
}

export function buildOmniGentHarnessView(source: OmniGentHarnessViewInput): OmniGentHarnessView {
  requireExactRecord(source, [
    'generated_at', 'task_capsule_id', 'harness_generation', 'source_identity', 'loadout_id',
    'component_manifest_sha256', 'behavior_projection_sha256', 'scientific_posture', 'route',
    'trace', 'replay', 'rollback', 'factory', 'proof_level', 'end_user_acceptance', 'non_claims',
  ], 'omnigent_view_object_closure_invalid')
  const input = structuredClone(source)
  requireExactRecord(input.source_identity, [
    'repository', 'commit', 'tree', 'dirty_state', 'configuration_sha256',
  ], 'omnigent_source_identity_closure_invalid')
  requireExactRecord(input.route, [
    'state', 'requested_model', 'routed_model', 'served_model', 'provider', 'receipt_sha256',
  ], 'omnigent_route_closure_invalid')
  requireExactRecord(input.trace, [
    'state', 'intent_count', 'canonical_append_receipt_sha256', 'blocker',
  ], 'omnigent_trace_closure_invalid')
  requireExactRecord(input.replay, ['state', 'receipt_sha256'], 'omnigent_replay_closure_invalid')
  requireExactRecord(input.rollback, ['state', 'receipt_sha256'], 'omnigent_rollback_closure_invalid')
  requireExactRecord(input.factory, [
    'factory_id', 'integration_state', 'prh_stage', 'work_item_id', 'handoff_sha256',
  ], 'omnigent_factory_closure_invalid')
  validTimestamp(input.generated_at)
  oneOf(input.harness_generation, ['current_production', 'next_deepseek_cordis'] as const, 'omnigent_harness_generation_invalid')
  oneOf(input.scientific_posture, ['base', 'retrodict_default', 'retrodict_simulator_escalated', 'retrodict_novelty_escape'] as const, 'omnigent_scientific_posture_invalid')
  oneOf(input.proof_level, PROOF_LEVELS, 'omnigent_proof_level_invalid')
  oneOf(input.route.state, ROUTE_STATES, 'omnigent_route_state_invalid')
  oneOf(input.trace.state, TRACE_STATES, 'omnigent_trace_state_invalid')
  oneOf(input.replay.state, REPLAY_STATES, 'omnigent_replay_state_invalid')
  oneOf(input.rollback.state, ROLLBACK_STATES, 'omnigent_rollback_state_invalid')
  oneOf(input.factory.factory_id, FACTORY_IDS, 'omnigent_factory_id_invalid')
  oneOf(input.factory.integration_state, FACTORY_INTEGRATION_STATES, 'omnigent_factory_integration_state_invalid')
  oneOf(input.factory.prh_stage, PRH_STAGES, 'omnigent_factory_prh_stage_invalid')
  id(input.task_capsule_id); id(input.loadout_id); id(input.factory.work_item_id)
  if (typeof input.source_identity !== 'object' || input.source_identity === null
    || typeof input.source_identity.repository !== 'string'
    || unicodeLength(input.source_identity.repository) === 0 || unicodeLength(input.source_identity.repository) > 512
    || typeof input.source_identity.commit !== 'string' || typeof input.source_identity.tree !== 'string'
    || !GIT_OBJECT.test(input.source_identity.commit) || !GIT_OBJECT.test(input.source_identity.tree)
    || !['clean', 'dirty_bound', 'unknown'].includes(input.source_identity.dirty_state)) {
    throw new Error('typed_blocker:omnigent_source_identity_invalid')
  }
  for (const value of [input.source_identity.configuration_sha256, input.component_manifest_sha256,
    input.behavior_projection_sha256, input.factory.handoff_sha256]) digest(value)
  for (const value of [input.route.requested_model, input.route.routed_model, input.route.served_model, input.route.provider]) {
    boundedText(value, 128)
  }
  optionalDigest(input.route.receipt_sha256)
  optionalDigest(input.trace.canonical_append_receipt_sha256)
  optionalDigest(input.replay.receipt_sha256)
  optionalDigest(input.rollback.receipt_sha256)
  if (!Number.isInteger(input.trace.intent_count) || input.trace.intent_count < 0) {
    throw new Error('typed_blocker:omnigent_trace_intent_count_invalid')
  }
  if (input.route.state === 'not_requested' && [
    input.route.requested_model, input.route.routed_model, input.route.served_model,
    input.route.provider, input.route.receipt_sha256,
  ].some(value => value !== null)) throw new Error('typed_blocker:omnigent_route_state_invalid')
  if (input.route.state === 'prepared' && (
    input.route.requested_model === null
    || [input.route.routed_model, input.route.served_model, input.route.provider, input.route.receipt_sha256]
      .some(value => value !== null)
  )) throw new Error('typed_blocker:omnigent_route_state_invalid')
  if ((input.route.state === 'served_unverified' || input.route.state === 'served_verified')
    && [input.route.requested_model, input.route.routed_model, input.route.served_model, input.route.provider]
      .some(value => value === null)) throw new Error('typed_blocker:omnigent_route_state_invalid')
  if (input.route.state === 'served_verified' && input.route.receipt_sha256 === null) {
    throw new Error('typed_blocker:omnigent_route_receipt_missing')
  }
  if (input.trace.state === 'blocked' && (
    typeof input.trace.blocker !== 'string' || unicodeLength(input.trace.blocker) > 256
    || !TYPED_BLOCKER.test(input.trace.blocker)
  )) throw new Error('typed_blocker:omnigent_trace_blocker_invalid')
  if (input.trace.state !== 'blocked' && input.trace.blocker !== null) {
    throw new Error('typed_blocker:omnigent_trace_state_invalid')
  }
  if (input.trace.state === 'append_verified' && input.trace.canonical_append_receipt_sha256 === null) {
    throw new Error('typed_blocker:omnigent_trace_append_receipt_missing')
  }
  if (input.trace.state !== 'append_verified' && input.trace.canonical_append_receipt_sha256 !== null) {
    throw new Error('typed_blocker:omnigent_trace_state_invalid')
  }
  if (input.replay.state === 'verified' && input.replay.receipt_sha256 === null) {
    throw new Error('typed_blocker:omnigent_replay_receipt_missing')
  }
  if ((input.rollback.state === 'rehearsed' || input.rollback.state === 'verified')
    && input.rollback.receipt_sha256 === null) {
    throw new Error('typed_blocker:omnigent_rollback_receipt_missing')
  }
  if (!Array.isArray(input.end_user_acceptance) || input.end_user_acceptance.length === 0
    || input.end_user_acceptance.length > 32) throw new Error('typed_blocker:omnigent_acceptance_plan_missing')
  for (const step of input.end_user_acceptance) {
    requireExactRecord(step, ['step_id', 'description', 'state', 'receipt_sha256'], 'omnigent_acceptance_closure_invalid')
    id(step.step_id)
    oneOf(step.state, ACCEPTANCE_STATES, 'omnigent_acceptance_state_invalid')
    if (typeof step.description !== 'string' || unicodeLength(step.description) === 0 || unicodeLength(step.description) > 512) {
      throw new Error('typed_blocker:omnigent_acceptance_step_invalid')
    }
    if (step.receipt_sha256 !== null) digest(step.receipt_sha256)
    if (step.state === 'passed' && step.receipt_sha256 === null) {
      throw new Error('typed_blocker:omnigent_acceptance_receipt_missing')
    }
  }
  if (input.proof_level === 'runtime_verified' && !hasVerifiedRuntimeEvidence(input)) {
    throw new Error('typed_blocker:omnigent_runtime_proof_incomplete')
  }
  if (input.proof_level === 'deployed_verified' && (
    !hasVerifiedRuntimeEvidence(input)
    || input.end_user_acceptance.some(step => step.state !== 'passed' || step.receipt_sha256 === null)
  )) throw new Error('typed_blocker:omnigent_deployment_proof_incomplete')
  if (!Array.isArray(input.non_claims)
    || input.non_claims.some(value => typeof value !== 'string' || unicodeLength(value) === 0 || unicodeLength(value) > 128)) {
    throw new Error('typed_blocker:omnigent_non_claims_invalid')
  }
  if (new Set(input.non_claims).size !== input.non_claims.length) {
    throw new Error('typed_blocker:omnigent_non_claims_duplicate_invalid')
  }
  input.non_claims = [...input.non_claims].sort()
  if (input.non_claims.length === 0) throw new Error('typed_blocker:omnigent_non_claims_missing')
  return { ...input, schema: 'mykrobial.omnigent.harness-read-model.v1' }
}

export * from './component-evolution.ts'
