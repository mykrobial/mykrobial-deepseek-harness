/** Pure boundary projections for Trace, OmniRoute, Semantica, MindWalk, and OmniGent. */
import { createHash } from 'node:crypto'

const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const OMNIROUTE = /^omniroute:\/\/[A-Za-z0-9._/-]{1,160}$/
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite canonical number')
    return value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) output[key] = normalize(child)
    }
    return output
  }
  throw new Error(`unsupported canonical value ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function identifier(value: string, field: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`typed_blocker:${field}_invalid`)
  return value
}

function digest(value: string, field: string): string {
  if (!SHA256.test(value)) throw new Error(`typed_blocker:${field}_invalid`)
  return value
}

function timestamp(value: string, field: string): number {
  if (!UTC_TIMESTAMP.test(value)) throw new Error(`typed_blocker:${field}_invalid`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error(`typed_blocker:${field}_invalid`)
  return milliseconds
}

export type AllenIntervalRelation =
  | 'before'
  | 'meets'
  | 'overlaps'
  | 'starts'
  | 'during'
  | 'finishes'
  | 'equal'
  | 'finished_by'
  | 'contains'
  | 'started_by'
  | 'overlapped_by'
  | 'met_by'
  | 'after'

export interface TemporalAssertion {
  valid_from: string | null
  valid_until: string | null
  valid_time_basis: 'not_asserted' | 'producer_declared'
  supersedes_event_id: string | null
}

export interface BitemporalEvent {
  event_id: string
  sequence: number
  recorded_at: string
  assertion: TemporalAssertion
}

export interface TemporalUiRow {
  schema: 'mykrobial.temporal-ui-row.v1'
  event_id: string
  sequence: number
  transaction_time: string
  valid_time_start: string | null
  valid_time_end: string | null
  valid_time_basis: 'not_asserted' | 'producer_declared'
  superseded_at: string | null
  current_at_latest_transaction: boolean
}

interface IntervalBounds {
  start: number
  end: number
}

function assertionBounds(assertion: TemporalAssertion): IntervalBounds {
  if (assertion.valid_time_basis !== 'producer_declared' || assertion.valid_from === null) {
    throw new Error('typed_blocker:temporal_assertion_not_declared')
  }
  const start = timestamp(assertion.valid_from, 'temporal_valid_from')
  const end = assertion.valid_until === null
    ? Number.POSITIVE_INFINITY
    : timestamp(assertion.valid_until, 'temporal_valid_until')
  if (end <= start) throw new Error('typed_blocker:temporal_assertion_window_invalid')
  return { start, end }
}

export function validateTemporalAssertion(assertion: TemporalAssertion): TemporalAssertion {
  if (assertion.valid_time_basis === 'not_asserted') {
    if (assertion.valid_from !== null || assertion.valid_until !== null) {
      throw new Error('typed_blocker:temporal_not_asserted_must_have_null_validity')
    }
  } else {
    assertionBounds(assertion)
  }
  if (assertion.supersedes_event_id !== null) {
    identifier(assertion.supersedes_event_id, 'temporal_superseded_event_identity')
  }
  return structuredClone(assertion)
}

/** The 13 Allen interval relations, with open end represented only in memory. */
export function intervalRelation(left: TemporalAssertion, right: TemporalAssertion): AllenIntervalRelation {
  const a = assertionBounds(left)
  const b = assertionBounds(right)
  if (a.end < b.start) return 'before'
  if (a.end === b.start) return 'meets'
  if (a.start > b.end) return 'after'
  if (a.start === b.end) return 'met_by'
  if (a.start === b.start && a.end === b.end) return 'equal'
  if (a.start === b.start && a.end < b.end) return 'starts'
  if (a.start === b.start && a.end > b.end) return 'started_by'
  if (a.end === b.end && a.start > b.start) return 'finishes'
  if (a.end === b.end && a.start < b.start) return 'finished_by'
  if (b.start < a.start && a.end < b.end) return 'during'
  if (a.start < b.start && b.end < a.end) return 'contains'
  if (a.start < b.start && b.start < a.end && a.end < b.end) return 'overlaps'
  if (b.start < a.start && a.start < b.end && b.end < a.end) return 'overlapped_by'
  throw new Error('typed_blocker:temporal_interval_relation_unresolved')
}

export function activeAtValidTime(assertion: TemporalAssertion, at: string): boolean {
  if (assertion.valid_time_basis !== 'producer_declared') return false
  const bounds = assertionBounds(assertion)
  const point = timestamp(at, 'temporal_valid_query')
  return bounds.start <= point && point < bounds.end
}

/**
 * Derive forward supersession without mutating history. The earliest later
 * transaction that names an event ends that event's transaction-time currency.
 */
export function deriveSupersededAt(events: readonly BitemporalEvent[]): Map<string, string> {
  const seen = new Map<string, BitemporalEvent>()
  const superseded = new Map<string, string>()
  let previousSequence = -1
  let previousRecorded = Number.NEGATIVE_INFINITY
  for (const source of events) {
    const event = structuredClone(source)
    identifier(event.event_id, 'temporal_event_identity')
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
      throw new Error('typed_blocker:temporal_event_sequence_invalid')
    }
    const recorded = timestamp(event.recorded_at, 'temporal_recorded_at')
    if (recorded < previousRecorded) throw new Error('typed_blocker:temporal_recorded_at_nonmonotonic')
    if (seen.has(event.event_id)) throw new Error('typed_blocker:temporal_event_identity_duplicate')
    validateTemporalAssertion(event.assertion)
    const target = event.assertion.supersedes_event_id
    if (target !== null) {
      if (target === event.event_id) throw new Error('typed_blocker:temporal_event_self_supersession')
      if (!seen.has(target)) throw new Error('typed_blocker:temporal_supersession_target_not_prior')
      if (!superseded.has(target)) superseded.set(target, event.recorded_at)
    }
    seen.set(event.event_id, event)
    previousSequence = event.sequence
    previousRecorded = recorded
  }
  return superseded
}

export function activeAtTransactionTime(
  event: BitemporalEvent,
  supersededAt: ReadonlyMap<string, string>,
  at: string,
): boolean {
  const point = timestamp(at, 'temporal_transaction_query')
  if (timestamp(event.recorded_at, 'temporal_recorded_at') > point) return false
  const superseded = supersededAt.get(event.event_id)
  return superseded === undefined || point < timestamp(superseded, 'temporal_superseded_at')
}

export function activeAtBitemporalPoint(
  event: BitemporalEvent,
  supersededAt: ReadonlyMap<string, string>,
  validAt: string,
  transactionAt: string,
): boolean {
  return activeAtValidTime(event.assertion, validAt)
    && activeAtTransactionTime(event, supersededAt, transactionAt)
}

export function toTemporalUiRows(events: readonly BitemporalEvent[]): TemporalUiRow[] {
  const superseded = deriveSupersededAt(events)
  return events.map(event => ({
    schema: 'mykrobial.temporal-ui-row.v1',
    event_id: event.event_id,
    sequence: event.sequence,
    transaction_time: event.recorded_at,
    valid_time_start: event.assertion.valid_from,
    valid_time_end: event.assertion.valid_until,
    valid_time_basis: event.assertion.valid_time_basis,
    superseded_at: superseded.get(event.event_id) ?? null,
    current_at_latest_transaction: !superseded.has(event.event_id),
  }))
}

export interface ScientificEnvelopeLike {
  run_id: string
  harness_generation: 'current_production' | 'next_deepseek_cordis'
  event_sequence: number
  event_sha256: string
  kind: string
}

export interface TraceV23Intent {
  schema: 'mykrobial.deepseek.trace-v2.3-intent.v1'
  target_schema: 'mykrobial.trace.v2.3.event.v1'
  target_schema_version: '2.3.0'
  trace_id: string
  session_id: string
  source_event_sha256: string
  source_event_sequence: number
  source_event_kind: string
  scope: 'root_run'
  phase: 'progress'
  content_mode: 'metadata_only'
  status: 'candidate_report_only'
  blocker: 'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted'
  non_claims: string[]
}

/**
 * Produce an append intent without manufacturing Trace authority, runtime
 * proof, plaintext reasoning, or a canonical Trace event.
 */
export function toTraceV23Intent(
  event: ScientificEnvelopeLike,
  traceId: string,
  sessionId: string,
): TraceV23Intent {
  if (!Number.isSafeInteger(event.event_sequence) || event.event_sequence < 0) {
    throw new Error('typed_blocker:trace_source_sequence_invalid')
  }
  return {
    schema: 'mykrobial.deepseek.trace-v2.3-intent.v1',
    target_schema: 'mykrobial.trace.v2.3.event.v1',
    target_schema_version: '2.3.0',
    trace_id: identifier(traceId, 'trace_identity'),
    session_id: identifier(sessionId, 'session_identity'),
    source_event_sha256: digest(event.event_sha256, 'trace_source_event_digest'),
    source_event_sequence: event.event_sequence,
    source_event_kind: identifier(event.kind, 'trace_source_event_kind'),
    scope: 'root_run',
    phase: 'progress',
    content_mode: 'metadata_only',
    status: 'candidate_report_only',
    blocker: 'typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted',
    non_claims: [
      'not_trace_append',
      'not_hidden_chain_of_thought_access',
      'not_provider_execution',
      'not_deployment',
    ],
  }
}

export interface OmniRouteRequest {
  schema: 'mykrobial.deepseek.omniroute-request.v1'
  request_id: string
  endpoint_ref: string
  requested_model: string
  message_sha256: string
  route_policy_sha256: string
  authority_ref_sha256: string
  status: 'prepared_unexecuted'
}

export interface OmniRouteReceipt {
  schema: 'mykrobial.omniroute-receipt.v1'
  request_id: string
  requested_model: string
  routed_model: string
  served_model: string
  provider: string
  provider_completed: boolean
  execution_verified: boolean
  receipt_sha256: string | null
}

export interface VerifiedRouteProjection extends Omit<OmniRouteReceipt, 'schema'> {
  schema: 'mykrobial.deepseek.omniroute-projection.v1'
  request_matches: true
  identity_chain_complete: boolean
  status: 'served_verified' | 'served_unverified' | 'incomplete'
}

export function prepareOmniRouteRequest(input: {
  request_id: string
  endpoint_ref: string
  requested_model: string
  message_sha256: string
  route_policy_sha256: string
  authority_ref_sha256: string
}): OmniRouteRequest {
  if (!OMNIROUTE.test(input.endpoint_ref)) throw new Error('typed_blocker:omniroute_endpoint_invalid')
  return {
    schema: 'mykrobial.deepseek.omniroute-request.v1',
    request_id: identifier(input.request_id, 'omniroute_request_identity'),
    endpoint_ref: input.endpoint_ref,
    requested_model: identifier(input.requested_model, 'omniroute_requested_model'),
    message_sha256: digest(input.message_sha256, 'omniroute_message_digest'),
    route_policy_sha256: digest(input.route_policy_sha256, 'omniroute_policy_digest'),
    authority_ref_sha256: digest(input.authority_ref_sha256, 'omniroute_authority_digest'),
    status: 'prepared_unexecuted',
  }
}

/** Preserve requested, routed, served, and provider identities as four facts. */
export function projectOmniRouteReceipt(
  request: OmniRouteRequest,
  receipt: OmniRouteReceipt,
): VerifiedRouteProjection {
  if (receipt.schema !== 'mykrobial.omniroute-receipt.v1'
    || receipt.request_id !== request.request_id
    || receipt.requested_model !== request.requested_model) {
    throw new Error('typed_blocker:omniroute_receipt_request_mismatch')
  }
  identifier(receipt.routed_model, 'omniroute_routed_model')
  identifier(receipt.served_model, 'omniroute_served_model')
  identifier(receipt.provider, 'omniroute_provider')
  const identityComplete = receipt.routed_model.length > 0
    && receipt.served_model.length > 0
    && receipt.provider.length > 0
  if (receipt.execution_verified && (!receipt.provider_completed || receipt.receipt_sha256 === null)) {
    throw new Error('typed_blocker:omniroute_execution_receipt_incomplete')
  }
  if (receipt.receipt_sha256 !== null) digest(receipt.receipt_sha256, 'omniroute_receipt_digest')
  return {
    ...structuredClone(receipt),
    schema: 'mykrobial.deepseek.omniroute-projection.v1',
    request_matches: true,
    identity_chain_complete: identityComplete,
    status: !identityComplete || !receipt.provider_completed
      ? 'incomplete'
      : receipt.execution_verified
        ? 'served_verified'
        : 'served_unverified',
  }
}

export interface DeepSeekObservedEvent {
  seq: number
  time_ms: number
  type: string
  event_sha256: string
  resource_ref: string | null
  resource_sha256: string | null
}

export interface MindWalkTimelineRow {
  schema: 'mykrobial.mindwalk-timeline-row.v1'
  sequence: number
  transaction_time_ms: number
  category: 'read' | 'write_intent' | 'write_observed' | 'tool' | 'scientific' | 'session'
  source_event_type: string
  source_event_sha256: string
  resource_ref: string | null
  resource_sha256: string | null
  causality_claimed: false
}

/** Read-only temporal visualization export; never a source-of-truth rewrite. */
export function toMindWalkTimeline(events: readonly DeepSeekObservedEvent[]): MindWalkTimelineRow[] {
  let previous = -1
  return events.map(event => {
    if (!Number.isSafeInteger(event.seq) || event.seq <= previous) {
      throw new Error('typed_blocker:mindwalk_event_order_invalid')
    }
    previous = event.seq
    if (!Number.isSafeInteger(event.time_ms) || event.time_ms < 0) {
      throw new Error('typed_blocker:mindwalk_event_time_invalid')
    }
    digest(event.event_sha256, 'mindwalk_source_event_digest')
    if (event.resource_sha256 !== null) digest(event.resource_sha256, 'mindwalk_resource_digest')
    const category = event.type === 'fs/read' || event.type === 'fs/observed:read'
      ? 'read'
      : event.type.includes('write-intent') || event.type.includes('edit-intent')
        ? 'write_intent'
        : event.type.includes('fs/observed')
          ? 'write_observed'
          : event.type.startsWith('tool/')
            ? 'tool'
            : event.type.startsWith('mykrobial/scientific/')
              ? 'scientific'
              : 'session'
    return {
      schema: 'mykrobial.mindwalk-timeline-row.v1',
      sequence: event.seq,
      transaction_time_ms: event.time_ms,
      category,
      source_event_type: event.type,
      source_event_sha256: event.event_sha256,
      resource_ref: event.resource_ref,
      resource_sha256: event.resource_sha256,
      causality_claimed: false,
    }
  })
}

export interface OmniGentScientificView {
  schema: 'mykrobial.omnigent-scientific-view.v1'
  harness_generation: 'current_production' | 'next_deepseek_cordis'
  loadout_id: string
  behavior_projection_sha256: string
  component_manifest_sha256: string
  route_projection_sha256: string | null
  replay_state: 'available' | 'blocked'
  rollback_state: 'available' | 'blocked'
  authority_state: 'source_candidate' | 'runtime_verified' | 'deployed_verified'
}

export function toOmniGentScientificView(input: OmniGentScientificView): OmniGentScientificView {
  identifier(input.loadout_id, 'omnigent_loadout_identity')
  digest(input.behavior_projection_sha256, 'omnigent_behavior_digest')
  digest(input.component_manifest_sha256, 'omnigent_component_digest')
  if (input.route_projection_sha256 !== null) {
    digest(input.route_projection_sha256, 'omnigent_route_digest')
  }
  return structuredClone(input)
}
