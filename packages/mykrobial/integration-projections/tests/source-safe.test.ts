import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  activeAtBitemporalPoint,
  activeAtValidTime,
  deriveSupersededAt,
  intervalRelation,
  prepareOmniRouteRequest,
  projectOmniRouteReceipt,
  toMindWalkTimeline,
  toOmniGentScientificView,
  toTraceV23Intent,
  toTemporalUiRows,
} from '../src/index.ts'

const digest = (text: string): string => createHash('sha256').update(text).digest('hex')

test('Trace projection remains a metadata-only blocked intent', () => {
  const intent = toTraceV23Intent({
    run_id: 'run-one',
    harness_generation: 'next_deepseek_cordis',
    event_sequence: 3,
    event_sha256: digest('event'),
    kind: 'prediction_mismatch',
  }, 'trace-one', 'session-one')
  assert.equal(intent.target_schema, 'mykrobial.trace.v2.3.event.v1')
  assert.equal(intent.content_mode, 'metadata_only')
  assert.equal(intent.status, 'candidate_report_only')
  assert.match(intent.blocker, /^typed_blocker:/)
})

test('OmniRoute keeps requested, routed, served, and provider identities separate', () => {
  const request = prepareOmniRouteRequest({
    request_id: 'request-one',
    endpoint_ref: 'omniroute://inference/primary',
    requested_model: 'frontier-coding',
    message_sha256: digest('messages'),
    route_policy_sha256: digest('policy'),
    authority_ref_sha256: digest('authority'),
  })
  const projection = projectOmniRouteReceipt(request, {
    schema: 'mykrobial.omniroute-receipt.v1',
    request_id: 'request-one',
    requested_model: 'frontier-coding',
    routed_model: 'provider-family/coding',
    served_model: 'provider-model-revision',
    provider: 'provider-name',
    provider_completed: true,
    execution_verified: true,
    receipt_sha256: digest('route-receipt'),
  })
  assert.equal(projection.status, 'served_verified')
  assert.notEqual(projection.requested_model, projection.routed_model)
  assert.notEqual(projection.routed_model, projection.served_model)
})

test('OmniRoute rejects execution claims without an exact receipt', () => {
  const request = prepareOmniRouteRequest({
    request_id: 'request-one',
    endpoint_ref: 'omniroute://local/primary',
    requested_model: 'model-one',
    message_sha256: digest('messages'),
    route_policy_sha256: digest('policy'),
    authority_ref_sha256: digest('authority'),
  })
  assert.throws(() => projectOmniRouteReceipt(request, {
    schema: 'mykrobial.omniroute-receipt.v1',
    request_id: 'request-one',
    requested_model: 'model-one',
    routed_model: 'model-one',
    served_model: 'model-one',
    provider: 'local',
    provider_completed: true,
    execution_verified: true,
    receipt_sha256: null,
  }), /typed_blocker:omniroute_execution_receipt_incomplete/)
})

test('MindWalk export preserves order and never asserts causality', () => {
  const rows = toMindWalkTimeline([
    { seq: 1, time_ms: 1000, type: 'fs/read', event_sha256: digest('read'), resource_ref: 'src/a.ts', resource_sha256: digest('a') },
    { seq: 2, time_ms: 2000, type: 'fs/write-intent', event_sha256: digest('intent'), resource_ref: 'src/a.ts', resource_sha256: digest('a2') },
    { seq: 3, time_ms: 3000, type: 'fs/observed', event_sha256: digest('write'), resource_ref: 'src/a.ts', resource_sha256: digest('a2') },
  ])
  assert.deepEqual(rows.map(row => row.category), ['read', 'write_intent', 'write_observed'])
  assert.equal(rows.every(row => row.causality_claimed === false), true)
  assert.throws(() => toMindWalkTimeline([
    { seq: 2, time_ms: 2000, type: 'a', event_sha256: digest('a'), resource_ref: null, resource_sha256: null },
    { seq: 1, time_ms: 1000, type: 'b', event_sha256: digest('b'), resource_ref: null, resource_sha256: null },
  ]), /typed_blocker:mindwalk_event_order_invalid/)
})

test('Semantica-derived valid time stays distinct from transaction time', () => {
  const base = {
    valid_from: '2026-08-01T00:00:00Z',
    valid_until: '2026-09-01T00:00:00Z',
    valid_time_basis: 'producer_declared' as const,
    supersedes_event_id: null,
  }
  assert.equal(activeAtValidTime(base, '2026-08-01T00:00:00Z'), true)
  assert.equal(activeAtValidTime(base, '2026-09-01T00:00:00Z'), false)
  assert.equal(intervalRelation(base, {
    valid_from: '2026-09-01T00:00:00Z',
    valid_until: null,
    valid_time_basis: 'producer_declared',
    supersedes_event_id: null,
  }), 'meets')

  const events = [
    {
      event_id: 'event-one',
      sequence: 0,
      recorded_at: '2026-08-10T00:00:00Z',
      assertion: base,
    },
    {
      event_id: 'event-two',
      sequence: 1,
      recorded_at: '2026-08-20T00:00:00Z',
      assertion: {
        valid_from: '2026-08-15T00:00:00Z',
        valid_until: null,
        valid_time_basis: 'producer_declared' as const,
        supersedes_event_id: 'event-one',
      },
    },
  ]
  const superseded = deriveSupersededAt(events)
  assert.equal(superseded.get('event-one'), '2026-08-20T00:00:00Z')
  assert.equal(activeAtBitemporalPoint(
    events[0], superseded, '2026-08-12T00:00:00Z', '2026-08-15T00:00:00Z',
  ), true)
  assert.equal(activeAtBitemporalPoint(
    events[0], superseded, '2026-08-12T00:00:00Z', '2026-08-25T00:00:00Z',
  ), false)
  const rows = toTemporalUiRows(events)
  assert.equal(rows[0]?.superseded_at, '2026-08-20T00:00:00Z')
  assert.equal(rows[1]?.current_at_latest_transaction, true)
})

test('OmniGent view is hash-bound and does not inflate source authority', () => {
  const view = toOmniGentScientificView({
    schema: 'mykrobial.omnigent-scientific-view.v1',
    harness_generation: 'next_deepseek_cordis',
    loadout_id: 'scientific-retrodiction-v1',
    behavior_projection_sha256: digest('behavior'),
    component_manifest_sha256: digest('components'),
    route_projection_sha256: null,
    replay_state: 'available',
    rollback_state: 'blocked',
    authority_state: 'source_candidate',
  })
  assert.equal(view.authority_state, 'source_candidate')
})
