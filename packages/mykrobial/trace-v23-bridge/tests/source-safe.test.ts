import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256, toTraceV23Intent } from '@mykrobial/dsh-integration-projections'
import {
  bridgeScientificEvent,
  type MykrobialTraceV23Sink,
} from '../src/index.ts'

const event = {
  run_id: 'run-one',
  harness_generation: 'next_deepseek_cordis' as const,
  event_sequence: 4,
  event_sha256: 'a'.repeat(64),
  kind: 'prediction_mismatch',
}

test('valid queue receipt preserves the no-append claim', () => {
  const sink: MykrobialTraceV23Sink = {
    enqueue(intent) {
      return {
        schema: 'mykrobial.deepseek.trace-v2.3-enqueue-receipt.v1',
        state: 'queued',
        source_event_sha256: intent.source_event_sha256,
        intent_sha256: sha256(intent),
        queue_receipt_sha256: 'b'.repeat(64),
        blocker: null,
        trace_append_claimed: false,
      }
    },
  }
  const receipt = bridgeScientificEvent(sink, 'session-one', event)
  assert.equal(receipt.state, 'queued')
  assert.equal(receipt.trace_append_claimed, false)
})

test('sink throw becomes typed debt and cannot veto the durable source event', () => {
  const receipt = bridgeScientificEvent({
    enqueue() { throw new Error('transport unavailable') },
  }, 'session-one', event)
  assert.equal(receipt.state, 'blocked')
  assert.equal(receipt.blocker, 'typed_blocker:trace_v2_3_sink_enqueue_failed')
  assert.equal(receipt.trace_append_claimed, false)
})

test('forged enqueue receipt fails closed into a bounded blocker', () => {
  const receipt = bridgeScientificEvent({
    enqueue(intent) {
      const expected = toTraceV23Intent(event, 'trace-run-one', 'session-one')
      assert.deepEqual(intent, expected)
      return {
        schema: 'mykrobial.deepseek.trace-v2.3-enqueue-receipt.v1',
        state: 'queued',
        source_event_sha256: intent.source_event_sha256,
        intent_sha256: 'c'.repeat(64),
        queue_receipt_sha256: 'd'.repeat(64),
        blocker: null,
        trace_append_claimed: false,
      }
    },
  }, 'session-one', event)
  assert.equal(receipt.state, 'blocked')
  assert.equal(receipt.blocker, 'typed_blocker:trace_v2_3_enqueue_receipt_invalid')
})
