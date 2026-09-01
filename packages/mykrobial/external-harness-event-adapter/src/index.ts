import { createHash } from 'node:crypto'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA = /^[0-9a-f]{64}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+=-]{0,255}$/

export type ExternalHarnessEventKind =
  | 'message'
  | 'tool_requested'
  | 'tool_result'
  | 'sandbox_snapshotted'
  | 'thread_forked'
  | 'rebuild_and_restart_outcome'
  | 'usage'

export type TrajectoryKind =
  | 'observation'
  | 'result'
  | 'action_expectation'
  | 'action_result'
  | 'checkpoint'
  | 'experiment'
  | 'cost'

export interface ExternalArtifactRef {
  ref: string
  sha256: string
  bytes: number
  media_type: string
  storage_class: 'public' | 'restricted' | 'provider_opaque' | 'external'
}

export interface ExternalUsageRecord {
  input_tokens: number | null
  output_tokens: number | null
  cached_tokens: number | null
  monetary_usd: number | null
  energy_wh: number | null
  wall_ms: number | null
  human_minutes: number | null
  basis: 'provider_receipt' | 'meter_receipt' | 'measured_local' | 'declared_unverified' | 'unavailable'
}

export interface ExternalHarnessEventInput {
  schema: 'mykrobial.external-harness-event.v1'
  source_system: 'exo'
  source_event_id: string
  source_event_kind: ExternalHarnessEventKind
  source_sequence: number
  occurred_at: string
  source_artifact: ExternalArtifactRef
  source_event_sha256: string
  run_id: string
  task_capsule_id: string
  loadout_id: string
  component_ids: string[]
  primary_component_id: string
  branch_id: string
  component_generation: number
  previous_trajectory_event_sha256: string
  direction: 'inbound' | 'outbound' | 'internal' | null
  execution_outcome: 'succeeded' | 'failed' | 'unknown' | null
  usage: ExternalUsageRecord
  source_payload_contains_hidden_reasoning: false
  source_trust: 'untrusted_external_source'
}

export interface ExternalTrajectoryEvent {
  schema: 'mykrobial.harness.trajectory-event.v1'
  event_id: string
  run_id: string
  task_capsule_id: string
  loadout_id: string
  harness_generation: 'next_deepseek_cordis'
  sequence: number
  previous_event_sha256: string
  kind: TrajectoryKind
  source_component_id: string
  occurred_at: string
  temporal: {
    transaction_time: string
    valid_from: null
    valid_until: null
    valid_time_basis: 'not_asserted'
    supersedes_event_id: null
    parent_event_id: null
    branch_id: string
    component_generation: number
    duration_ms: number | null
    deadline_at: null
    causality_state: 'not_asserted'
  }
  payload_sha256: string
  payload_ref: ExternalArtifactRef
  component_ids: string[]
  cost: ExternalUsageRecord
  proof: {
    source: { state: 'candidate'; receipt_refs: ExternalArtifactRef[]; blocker: null }
    execution: { state: 'blocked'; receipt_refs: []; blocker: 'typed_blocker:external_harness_event_execution_unverified' }
    review: { state: 'unavailable'; receipt_refs: []; blocker: 'typed_blocker:external_harness_event_review_unavailable' }
    deployment: { state: 'unavailable'; receipt_refs: []; blocker: 'typed_blocker:external_harness_event_deployment_unavailable' }
  }
  event_sha256: string
}

export interface ExternalTraceV23Intent {
  schema: 'mykrobial.deepseek.trace-v2.3-intent.v1'
  target_schema: 'mykrobial.trace.v2.3.event.v1'
  target_schema_version: '2.3.0'
  trace_id: string
  session_id: string
  source_event_sha256: string
  source_event_sequence: number
  source_event_kind: TrajectoryKind
  scope: 'root_run'
  phase: 'progress'
  content_mode: 'metadata_only'
  status: 'candidate_report_only'
  blocker: 'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted'
  non_claims: [
    'not_trace_append',
    'not_hidden_chain_of_thought_access',
    'not_provider_execution',
    'not_external_state_rollback',
    'not_deployment',
  ]
}

export interface ExternalHarnessEventProjection {
  schema: 'mykrobial.external-harness-event-projection.v1'
  source_system: 'exo'
  source_event_kind: ExternalHarnessEventKind
  trajectory_event: ExternalTrajectoryEvent
  trace_v2_3_intent: ExternalTraceV23Intent
  loss_accounting: {
    mapping: string
    mapped_fields: string[]
    unavailable_fields: string[]
    dropped_fields: string[]
    metadata_projection_lossy: true
    raw_event_content_addressed: true
    hidden_reasoning_accessed: false
    external_state_rollback_covered: false
    loss_accounting_sha256: string
  }
  trajectory_append_authorized: false
  trace_append_authorized: false
  optimizer_execution_authorized: false
  component_application_authorized: false
  non_claims: [
    'not_external_harness_execution',
    'not_optimizer_execution',
    'not_component_application',
    'not_external_state_rollback',
    'not_trace_append',
    'not_promotion',
    'not_deployment',
  ]
  projection_sha256: string
}

export interface PrepareTerminalTaskContextRequestInput {
  request_id: string
  canonical_terminal_row_sha256: string
  terminal_family: 'answer_commit' | 'execution_timed_out'
  task_label_sha256: string
  session_id_sha256: string
  tenant_scope_sha256: string
  domain: string
  requested_receipt_ref: string
  served_receipt_ref: string
  source_generation: string
  visible_generation_sha256: string
  first_visible_event_id: string
  last_visible_event_id: string
  visible_event_count: number
  created_at: string
}

export interface TerminalTaskContextRequest {
  schema: 'mykrobial.external-harness.terminal-task-context-request.v1'
  request_id: string
  source_system: 'exo'
  source_event_kind: ExternalHarnessEventKind
  source_event_projection_sha256: string
  canonical_terminal_row_sha256: string
  terminal_family: 'answer_commit' | 'execution_timed_out'
  target_context_schema: 'mykrobial.trace.terminal_task_context_receipt.v1'
  target_binding_schema: 'mykrobial.trace.terminal_task_binding.v1'
  namespace: 'mykrobial.trace.terminal-task-context.v37'
  operation: 'bind_terminal_row_to_visible_task_range'
  task_label_sha256: string
  session_id_sha256: string
  tenant_scope_sha256: string
  domain: string
  requested_receipt_ref: string
  served_receipt_ref: string
  source_generation: string
  visible_generation_sha256: string
  first_visible_event_id: string
  last_visible_event_id: string
  visible_event_count: number
  created_at: string
  state: 'context_request_only_unissued'
  distinct_context_signer_and_verifier_required: true
  context_signature_authorized: false
  terminal_binding_emission_authorized: false
  trace_append_authorized: false
  historical_relabel_authorized: false
  task_inferred_from_message_or_event_order: false
  terminal_content_persisted: false
  non_claims: [
    'not_terminal_row_validation',
    'not_task_inference_from_message_or_event_order',
    'not_context_signature_or_verification',
    'not_terminal_binding_emission',
    'not_historical_relabel',
    'not_trace_append',
    'not_projection_execution',
    'not_evaluation_promotion_or_deployment',
  ]
  request_sha256: string
}

const INPUT_KEYS = [
  'schema', 'source_system', 'source_event_id', 'source_event_kind', 'source_sequence',
  'occurred_at', 'source_artifact', 'source_event_sha256', 'run_id', 'task_capsule_id',
  'loadout_id', 'component_ids', 'primary_component_id', 'branch_id',
  'component_generation', 'previous_trajectory_event_sha256', 'direction',
  'execution_outcome', 'usage', 'source_payload_contains_hidden_reasoning', 'source_trust',
] as const

const ARTIFACT_KEYS = ['ref', 'sha256', 'bytes', 'media_type', 'storage_class'] as const
const USAGE_KEYS = [
  'input_tokens', 'output_tokens', 'cached_tokens', 'monetary_usd', 'energy_wh',
  'wall_ms', 'human_minutes', 'basis',
] as const

const TERMINAL_CONTEXT_INPUT_KEYS = [
  'request_id', 'canonical_terminal_row_sha256', 'terminal_family',
  'task_label_sha256', 'session_id_sha256', 'tenant_scope_sha256', 'domain',
  'requested_receipt_ref', 'served_receipt_ref', 'source_generation',
  'visible_generation_sha256', 'first_visible_event_id', 'last_visible_event_id',
  'visible_event_count', 'created_at',
] as const

const UNAVAILABLE_FIELDS = [
  'causal_verification',
  'deadline_at',
  'deployment_receipt',
  'parent_event_id',
  'provider_identity_receipt',
  'source_event_previous_digest',
  'valid_time',
]

const DROPPED_FIELDS = ['hidden_reasoning', 'raw_payload_body', 'secret_material']

const MAPPING: Record<ExternalHarnessEventKind, string> = {
  message: 'message_direction_to_observation_or_result',
  tool_requested: 'tool_requested_to_action_expectation',
  tool_result: 'tool_result_to_action_result',
  sandbox_snapshotted: 'sandbox_snapshotted_to_checkpoint',
  thread_forked: 'thread_forked_to_experiment',
  rebuild_and_restart_outcome: 'rebuild_and_restart_outcome_to_result',
  usage: 'usage_record_to_cost',
}

const SOURCE_KINDS = Object.keys(MAPPING) as ExternalHarnessEventKind[]
const DIRECTIONS = ['inbound', 'outbound', 'internal'] as const
const EXECUTION_OUTCOMES = ['succeeded', 'failed', 'unknown'] as const
const COST_BASES = [
  'provider_receipt', 'meter_receipt', 'measured_local', 'declared_unverified', 'unavailable',
] as const

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('typed_blocker:external_event_nonfinite_number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => (
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
    )).join(',')}}`
  }
  throw new Error('typed_blocker:external_event_noncanonical_value')
}

export function externalEventCanonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function timestamp(value: string): string {
  if (typeof value !== 'string' || !UTC.test(value)) {
    throw new Error('typed_blocker:external_event_timestamp_invalid')
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().replace('.000Z', 'Z') !== value) {
    throw new Error('typed_blocker:external_event_timestamp_invalid')
  }
  return value
}

function identifier(value: string): string {
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new Error('typed_blocker:external_event_identity_invalid')
  }
  return value
}

function contextIdentifier(value: string): string {
  if (typeof value !== 'string' || !CONTEXT_ID.test(value)) {
    throw new Error('typed_blocker:terminal_task_context_identity_invalid')
  }
  return value
}

function digest(value: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) {
    throw new Error('typed_blocker:external_event_digest_invalid')
  }
  return value
}

function artifactRef(source: ExternalArtifactRef): ExternalArtifactRef {
  const value = structuredClone(source)
  if (!exactKeys(value, ARTIFACT_KEYS)
    || typeof value.ref !== 'string' || value.ref.length < 1 || value.ref.length > 2048
    || typeof value.sha256 !== 'string' || !SHA.test(value.sha256)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1
    || typeof value.media_type !== 'string' || value.media_type.length < 1 || value.media_type.length > 128
    || !['public', 'restricted', 'provider_opaque', 'external'].includes(value.storage_class)) {
    throw new Error('typed_blocker:external_event_artifact_invalid')
  }
  return value
}

function usageRecord(source: ExternalUsageRecord, eventKind: ExternalHarnessEventKind): ExternalUsageRecord {
  const value = structuredClone(source)
  if (!exactKeys(value, USAGE_KEYS)
    || !COST_BASES.includes(value.basis)) {
    throw new Error('typed_blocker:external_event_usage_invalid')
  }
  for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'wall_ms'] as const) {
    const item = value[key]
    if (item !== null && (!Number.isSafeInteger(item) || item < 0)) {
      throw new Error('typed_blocker:external_event_usage_invalid')
    }
  }
  for (const key of ['monetary_usd', 'energy_wh', 'human_minutes'] as const) {
    const item = value[key]
    if (item !== null && (typeof item !== 'number' || !Number.isFinite(item) || item < 0)) {
      throw new Error('typed_blocker:external_event_usage_invalid')
    }
  }
  const numeric = USAGE_KEYS.slice(0, 7).map(key => value[key as keyof ExternalUsageRecord])
  const hasValue = numeric.some(item => item !== null)
  if (eventKind === 'usage') {
    if (!hasValue || value.basis === 'unavailable') throw new Error('typed_blocker:external_event_usage_invalid')
  } else if (hasValue || value.basis !== 'unavailable') {
    throw new Error('typed_blocker:external_event_usage_unexpected')
  }
  return value
}

function trajectoryKind(value: ExternalHarnessEventInput): TrajectoryKind {
  if (value.source_event_kind === 'message') {
    if (value.direction === null) throw new Error('typed_blocker:external_event_direction_missing')
    return value.direction === 'outbound' ? 'result' : 'observation'
  }
  if (value.source_event_kind === 'tool_requested') return 'action_expectation'
  if (value.source_event_kind === 'tool_result') return 'action_result'
  if (value.source_event_kind === 'sandbox_snapshotted') return 'checkpoint'
  if (value.source_event_kind === 'thread_forked') return 'experiment'
  if (value.source_event_kind === 'rebuild_and_restart_outcome') return 'result'
  return 'cost'
}

export function projectExternalHarnessEvent(
  input: ExternalHarnessEventInput,
  traceId: string,
  sessionId: string,
): ExternalHarnessEventProjection {
  const value = structuredClone(input)
  if (!exactKeys(value, INPUT_KEYS)
    || value.schema !== 'mykrobial.external-harness-event.v1'
    || value.source_system !== 'exo'
    || !SOURCE_KINDS.includes(value.source_event_kind)
    || value.source_trust !== 'untrusted_external_source'
    || value.source_payload_contains_hidden_reasoning !== false
    || !Number.isSafeInteger(value.source_sequence) || value.source_sequence < 0
    || !Number.isSafeInteger(value.component_generation) || value.component_generation < 0
    || !Array.isArray(value.component_ids) || value.component_ids.length < 1
    || value.component_ids.length > 128 || new Set(value.component_ids).size !== value.component_ids.length) {
    throw new Error('typed_blocker:external_harness_event_invalid')
  }
  if (value.direction !== null && !DIRECTIONS.includes(value.direction)) {
    throw new Error('typed_blocker:external_event_direction_invalid')
  }
  if (value.execution_outcome !== null && !EXECUTION_OUTCOMES.includes(value.execution_outcome)) {
    throw new Error('typed_blocker:external_event_execution_outcome_invalid')
  }
  const sourceArtifact = artifactRef(value.source_artifact)
  identifier(value.source_event_id)
  if (digest(value.source_event_sha256) !== sourceArtifact.sha256) {
    throw new Error('typed_blocker:external_event_artifact_binding_invalid')
  }
  const componentIds = value.component_ids.map(identifier)
  if (!componentIds.includes(identifier(value.primary_component_id))) {
    throw new Error('typed_blocker:external_event_primary_component_invalid')
  }
  const occurredAt = timestamp(value.occurred_at)
  const cost = usageRecord(value.usage, value.source_event_kind)
  if (value.source_event_kind === 'rebuild_and_restart_outcome' && value.execution_outcome === null) {
    throw new Error('typed_blocker:external_event_execution_outcome_missing')
  }
  if (value.source_event_kind !== 'rebuild_and_restart_outcome' && value.execution_outcome !== null) {
    throw new Error('typed_blocker:external_event_execution_outcome_unexpected')
  }
  if (value.source_event_kind !== 'message' && value.direction !== null) {
    throw new Error('typed_blocker:external_event_direction_unexpected')
  }
  const kind = trajectoryKind(value)
  const eventBody = {
    schema: 'mykrobial.harness.trajectory-event.v1' as const,
    event_id: identifier(`external-${value.source_event_sha256.slice(0, 24)}`),
    run_id: identifier(value.run_id),
    task_capsule_id: identifier(value.task_capsule_id),
    loadout_id: identifier(value.loadout_id),
    harness_generation: 'next_deepseek_cordis' as const,
    sequence: value.source_sequence,
    previous_event_sha256: digest(value.previous_trajectory_event_sha256),
    kind,
    source_component_id: value.primary_component_id,
    occurred_at: occurredAt,
    temporal: {
      transaction_time: occurredAt,
      valid_from: null,
      valid_until: null,
      valid_time_basis: 'not_asserted' as const,
      supersedes_event_id: null,
      parent_event_id: null,
      branch_id: identifier(value.branch_id),
      component_generation: value.component_generation,
      duration_ms: value.source_event_kind === 'usage' ? cost.wall_ms : null,
      deadline_at: null,
      causality_state: 'not_asserted' as const,
    },
    payload_sha256: sourceArtifact.sha256,
    payload_ref: sourceArtifact,
    component_ids: componentIds,
    cost,
    proof: {
      source: { state: 'candidate' as const, receipt_refs: [sourceArtifact], blocker: null },
      execution: { state: 'blocked' as const, receipt_refs: [] as [], blocker: 'typed_blocker:external_harness_event_execution_unverified' as const },
      review: { state: 'unavailable' as const, receipt_refs: [] as [], blocker: 'typed_blocker:external_harness_event_review_unavailable' as const },
      deployment: { state: 'unavailable' as const, receipt_refs: [] as [], blocker: 'typed_blocker:external_harness_event_deployment_unavailable' as const },
    },
  }
  const trajectoryEvent: ExternalTrajectoryEvent = {
    ...eventBody,
    event_sha256: externalEventCanonicalSha256(eventBody),
  }
  const mappedFields = [
    'branch_id', 'component_generation', 'component_ids', 'loadout_id', 'occurred_at',
    'primary_component_id', 'raw_event_artifact', 'run_id', 'source_event_id',
    'source_event_kind', 'source_sequence', 'task_capsule_id',
  ]
  if (value.source_event_kind === 'message') mappedFields.push('direction')
  if (value.source_event_kind === 'rebuild_and_restart_outcome') mappedFields.push('execution_outcome')
  if (value.source_event_kind === 'usage') mappedFields.push('usage')
  mappedFields.sort()
  const lossBody = {
    mapping: MAPPING[value.source_event_kind],
    mapped_fields: mappedFields,
    unavailable_fields: [...UNAVAILABLE_FIELDS],
    dropped_fields: [...DROPPED_FIELDS],
    metadata_projection_lossy: true as const,
    raw_event_content_addressed: true as const,
    hidden_reasoning_accessed: false as const,
    external_state_rollback_covered: false as const,
  }
  const traceIntent: ExternalTraceV23Intent = {
    schema: 'mykrobial.deepseek.trace-v2.3-intent.v1',
    target_schema: 'mykrobial.trace.v2.3.event.v1',
    target_schema_version: '2.3.0',
    trace_id: identifier(traceId),
    session_id: identifier(sessionId),
    source_event_sha256: trajectoryEvent.event_sha256,
    source_event_sequence: trajectoryEvent.sequence,
    source_event_kind: trajectoryEvent.kind,
    scope: 'root_run',
    phase: 'progress',
    content_mode: 'metadata_only',
    status: 'candidate_report_only',
    blocker: 'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted',
    non_claims: [
      'not_trace_append',
      'not_hidden_chain_of_thought_access',
      'not_provider_execution',
      'not_external_state_rollback',
      'not_deployment',
    ],
  }
  const projectionBody = {
    schema: 'mykrobial.external-harness-event-projection.v1' as const,
    source_system: 'exo' as const,
    source_event_kind: value.source_event_kind,
    trajectory_event: trajectoryEvent,
    trace_v2_3_intent: traceIntent,
    loss_accounting: {
      ...lossBody,
      loss_accounting_sha256: externalEventCanonicalSha256(lossBody),
    },
    trajectory_append_authorized: false as const,
    trace_append_authorized: false as const,
    optimizer_execution_authorized: false as const,
    component_application_authorized: false as const,
    non_claims: [
      'not_external_harness_execution',
      'not_optimizer_execution',
      'not_component_application',
      'not_external_state_rollback',
      'not_trace_append',
      'not_promotion',
      'not_deployment',
    ] as ExternalHarnessEventProjection['non_claims'],
  }
  return {
    ...projectionBody,
    projection_sha256: externalEventCanonicalSha256(projectionBody),
  }
}

function validateExternalProjection(source: ExternalHarnessEventProjection): ExternalHarnessEventProjection {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new Error('typed_blocker:external_event_projection_invalid')
  }
  const value = structuredClone(source)
  const { projection_sha256: _projectionSha256, ...projectionCandidate } = value
  const { event_sha256: _eventSha256, ...eventCandidate } = value.trajectory_event
  const { loss_accounting_sha256: _lossSha256, ...lossCandidate } = value.loss_accounting
  if (value.schema !== 'mykrobial.external-harness-event-projection.v1'
    || value.source_system !== 'exo'
    || !SOURCE_KINDS.includes(value.source_event_kind)
    || value.trajectory_event.schema !== 'mykrobial.harness.trajectory-event.v1'
    || value.trajectory_event.event_sha256 !== externalEventCanonicalSha256(eventCandidate)
    || value.trace_v2_3_intent.source_event_sha256 !== value.trajectory_event.event_sha256
    || value.trace_v2_3_intent.status !== 'candidate_report_only'
    || value.loss_accounting.loss_accounting_sha256 !== externalEventCanonicalSha256(lossCandidate)
    || value.loss_accounting.hidden_reasoning_accessed !== false
    || value.loss_accounting.external_state_rollback_covered !== false
    || value.trajectory_append_authorized !== false
    || value.trace_append_authorized !== false
    || value.optimizer_execution_authorized !== false
    || value.component_application_authorized !== false
    || value.projection_sha256 !== externalEventCanonicalSha256(projectionCandidate)) {
    throw new Error('typed_blocker:external_event_projection_invalid')
  }
  return value
}

export function prepareTerminalTaskContextRequest(
  projection: ExternalHarnessEventProjection,
  input: PrepareTerminalTaskContextRequestInput,
): TerminalTaskContextRequest {
  const source = validateExternalProjection(projection)
  const value = structuredClone(input)
  if (!exactKeys(value, TERMINAL_CONTEXT_INPUT_KEYS)
    || source.source_event_kind === 'message'
    || !['answer_commit', 'execution_timed_out'].includes(value.terminal_family)
    || !Number.isSafeInteger(value.visible_event_count)
    || value.visible_event_count <= 0) {
    throw new Error('typed_blocker:terminal_task_context_request_invalid')
  }
  const body = {
    schema: 'mykrobial.external-harness.terminal-task-context-request.v1' as const,
    request_id: contextIdentifier(value.request_id),
    source_system: 'exo' as const,
    source_event_kind: source.source_event_kind,
    source_event_projection_sha256: source.projection_sha256,
    canonical_terminal_row_sha256: digest(value.canonical_terminal_row_sha256),
    terminal_family: value.terminal_family,
    target_context_schema: 'mykrobial.trace.terminal_task_context_receipt.v1' as const,
    target_binding_schema: 'mykrobial.trace.terminal_task_binding.v1' as const,
    namespace: 'mykrobial.trace.terminal-task-context.v37' as const,
    operation: 'bind_terminal_row_to_visible_task_range' as const,
    task_label_sha256: digest(value.task_label_sha256),
    session_id_sha256: digest(value.session_id_sha256),
    tenant_scope_sha256: digest(value.tenant_scope_sha256),
    domain: contextIdentifier(value.domain),
    requested_receipt_ref: digest(value.requested_receipt_ref),
    served_receipt_ref: digest(value.served_receipt_ref),
    source_generation: contextIdentifier(value.source_generation),
    visible_generation_sha256: digest(value.visible_generation_sha256),
    first_visible_event_id: contextIdentifier(value.first_visible_event_id),
    last_visible_event_id: contextIdentifier(value.last_visible_event_id),
    visible_event_count: value.visible_event_count,
    created_at: timestamp(value.created_at),
    state: 'context_request_only_unissued' as const,
    distinct_context_signer_and_verifier_required: true as const,
    context_signature_authorized: false as const,
    terminal_binding_emission_authorized: false as const,
    trace_append_authorized: false as const,
    historical_relabel_authorized: false as const,
    task_inferred_from_message_or_event_order: false as const,
    terminal_content_persisted: false as const,
    non_claims: [
      'not_terminal_row_validation',
      'not_task_inference_from_message_or_event_order',
      'not_context_signature_or_verification',
      'not_terminal_binding_emission',
      'not_historical_relabel',
      'not_trace_append',
      'not_projection_execution',
      'not_evaluation_promotion_or_deployment',
    ] as TerminalTaskContextRequest['non_claims'],
  }
  return {
    ...body,
    request_sha256: externalEventCanonicalSha256(body),
  }
}
