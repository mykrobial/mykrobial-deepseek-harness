import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  OmniRouteAdapter,
  PROVIDER,
  type OmniRouteReceiptSink,
  type OmniRouteTransport,
} from '../src/index.ts'

const digest = (character: string): string => character.repeat(64)

function options(): GenerateOptions {
  return {
    provider: PROVIDER,
    model: 'requested-model',
    messages: [],
    sessionId: 'session-one',
  }
}

function receipt(requestId: string) {
  return {
    schema: 'mykrobial.omniroute-receipt.v1' as const,
    request_id: requestId,
    requested_model: 'requested-model',
    routed_model: 'routed-model',
    served_model: 'served-model',
    provider: 'provider-one',
    provider_completed: true,
    execution_verified: true,
    receipt_sha256: digest('a'),
  }
}

test('verified receipt is recorded before the terminal finish chunk is released', async () => {
  const order: string[] = []
  const transport: OmniRouteTransport = {
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    prepare: async request => ({
      stream: (async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', text: 'hello' }
        order.push('transport-finish')
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
      receipt: Promise.resolve(receipt(request.request_id)),
    }),
  }
  const sink: OmniRouteReceiptSink = {
    async record(_sessionId, projected) {
      assert.equal(projected.requested_model, 'requested-model')
      assert.equal(projected.routed_model, 'routed-model')
      assert.equal(projected.served_model, 'served-model')
      order.push('receipt-recorded')
    },
  }
  const adapter = new OmniRouteAdapter(transport, sink, {
    endpointRef: 'omniroute://test/primary',
    routePolicySha256: digest('b'),
    authorityRefSha256: digest('c'),
    displayName: 'Test OmniRoute',
  })
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream(options())) {
    chunks.push(chunk)
    if (chunk.type === 'finish') order.push('consumer-finish')
  }
  assert.deepEqual(chunks.map(chunk => chunk.type), ['text-delta', 'finish'])
  assert.deepEqual(order, ['transport-finish', 'receipt-recorded', 'consumer-finish'])
})

test('unverified served identity prevents the finish chunk from escaping', async () => {
  let requestId = ''
  const transport: OmniRouteTransport = {
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    prepare: async request => {
      requestId = request.request_id
      return {
        stream: (async function* (): AsyncIterable<StreamChunk> {
          yield { type: 'finish', reason: { kind: 'stop' } }
        })(),
        receipt: Promise.resolve({ ...receipt(request.request_id), execution_verified: false, receipt_sha256: null }),
      }
    },
  }
  const adapter = new OmniRouteAdapter(transport, { record: async () => {} }, {
    endpointRef: 'omniroute://test/primary',
    routePolicySha256: digest('b'),
    authorityRefSha256: digest('c'),
    displayName: 'Test OmniRoute',
  })
  const emitted: StreamChunk[] = []
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream(options())) emitted.push(chunk)
  }, /verified served identity/)
  assert.match(requestId, /^route-/)
  assert.deepEqual(emitted, [])
})

test('missing or duplicate finish chunks fail the provider protocol', async () => {
  const make = (chunks: StreamChunk[]): OmniRouteAdapter => new OmniRouteAdapter({
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    prepare: async request => ({
      stream: (async function* () { for (const chunk of chunks) yield chunk })(),
      receipt: Promise.resolve(receipt(request.request_id)),
    }),
  }, { record: async () => {} }, {
    endpointRef: 'omniroute://test/primary',
    routePolicySha256: digest('b'),
    authorityRefSha256: digest('c'),
    displayName: 'Test OmniRoute',
  })
  await assert.rejects(async () => {
    for await (const _chunk of make([]).stream(options())) {}
  }, /without finish/)
  await assert.rejects(async () => {
    for await (const _chunk of make([
      { type: 'finish', reason: { kind: 'stop' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]).stream(options())) {}
  }, /after finish/)
})
