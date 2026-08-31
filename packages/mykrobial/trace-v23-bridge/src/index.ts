/** Fail-open DeepSeek scientific-event bridge to the RSI-owned Trace V2.3 sink. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@mykrobial/dsh-scientific-retrodiction'
import {
  sha256,
  toTraceV23Intent,
  type ScientificEnvelopeLike,
  type TraceV23Intent,
} from '@mykrobial/dsh-integration-projections'

export const name = 'mykrobial-trace-v23-bridge'
export const inject = ['mykrobialTraceV23Sink']

const DIGEST = /^[0-9a-f]{64}$/

export interface TraceV23EnqueueReceipt {
  schema: 'mykrobial.deepseek.trace-v2.3-enqueue-receipt.v1'
  state: 'queued' | 'blocked'
  source_event_sha256: string
  intent_sha256: string
  queue_receipt_sha256: string | null
  blocker: string | null
  trace_append_claimed: false
}

export interface MykrobialTraceV23Sink {
  enqueue(intent: TraceV23Intent): TraceV23EnqueueReceipt
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mykrobialTraceV23Sink: MykrobialTraceV23Sink
  }
}

function validateReceipt(intent: TraceV23Intent, receipt: TraceV23EnqueueReceipt): TraceV23EnqueueReceipt {
  if (receipt.schema !== 'mykrobial.deepseek.trace-v2.3-enqueue-receipt.v1'
    || receipt.source_event_sha256 !== intent.source_event_sha256
    || receipt.intent_sha256 !== sha256(intent)
    || receipt.trace_append_claimed !== false) {
    throw new Error('typed_blocker:trace_v2_3_enqueue_receipt_invalid')
  }
  if (receipt.state === 'queued') {
    if (receipt.blocker !== null || receipt.queue_receipt_sha256 === null
      || !DIGEST.test(receipt.queue_receipt_sha256)) {
      throw new Error('typed_blocker:trace_v2_3_enqueue_receipt_invalid')
    }
  } else if (receipt.queue_receipt_sha256 !== null
    || typeof receipt.blocker !== 'string'
    || !receipt.blocker.startsWith('typed_blocker:')) {
    throw new Error('typed_blocker:trace_v2_3_enqueue_receipt_invalid')
  }
  return structuredClone(receipt)
}

export function bridgeScientificEvent(
  sink: MykrobialTraceV23Sink,
  sessionId: string,
  source: ScientificEnvelopeLike,
): TraceV23EnqueueReceipt {
  const intent = toTraceV23Intent(source, `trace-${source.run_id}`, sessionId)
  try {
    return validateReceipt(intent, sink.enqueue(intent))
  } catch (error: unknown) {
    const blocker = error instanceof Error && error.message.startsWith('typed_blocker:')
      ? error.message
      : 'typed_blocker:trace_v2_3_sink_enqueue_failed'
    return {
      schema: 'mykrobial.deepseek.trace-v2.3-enqueue-receipt.v1',
      state: 'blocked',
      source_event_sha256: intent.source_event_sha256,
      intent_sha256: sha256(intent),
      queue_receipt_sha256: null,
      blocker,
      trace_append_claimed: false,
    }
  }
}

export function apply(ctx: Context): void {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'mykrobial/scientific/event') return
    bridgeScientificEvent(
      ctx.mykrobialTraceV23Sink,
      String(session.id),
      event.data as ScientificEnvelopeLike,
    )
  })
}
