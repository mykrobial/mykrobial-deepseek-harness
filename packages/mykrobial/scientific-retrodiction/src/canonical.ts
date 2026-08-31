import { createHash } from 'node:crypto'
import type { ScientificCheckpoint, ScientificEventEnvelope, ScientificEventPayload, ScientificRunState } from './types.ts'

const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const EVENT_HASH_DOMAIN = 'mykrobial.scientific-run-event.v1\0'
const TIMELINE_HASH_DOMAIN = 'mykrobial.scientific-timeline.v1\0'
const CHECKPOINT_HASH_DOMAIN = 'mykrobial.scientific-run-checkpoint.v1\0'

export class ScientificContractError extends Error {
  readonly blocker: string

  constructor(blocker: string) {
    super(blocker)
    this.name = 'ScientificContractError'
    this.blocker = blocker
  }
}

export function fail(blocker: string): never {
  throw new ScientificContractError(blocker)
}

export function requireSha256(value: unknown, blocker: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(blocker)
  return value
}

export function requireIdentifier(value: unknown, blocker: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(blocker)
  return value
}

export function requireText(value: unknown, blocker: string, maximumBytes: number): string {
  if (typeof value !== 'string' || value.trim().length === 0
    || new TextEncoder().encode(value).byteLength > maximumBytes) fail(blocker)
  return value.trim()
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number')
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
  throw new TypeError(`unsupported canonical value: ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function sha256Domain(domain: string, value: unknown): string {
  return createHash('sha256').update(domain, 'utf8').update(canonicalJson(value), 'utf8').digest('hex')
}

export function timelineSha256(state: ScientificRunState): string {
  return sha256Domain(TIMELINE_HASH_DOMAIN, state.timeline)
}

export function eventBody(envelope: ScientificEventEnvelope): Omit<ScientificEventEnvelope, 'event_sha256'> {
  const { event_sha256: _ignored, ...body } = envelope
  return body
}

export function buildEvent(
  state: ScientificRunState,
  events: readonly ScientificEventEnvelope[],
  payload: ScientificEventPayload,
): ScientificEventEnvelope {
  const body = {
    schema: 'mykrobial.scientific-run-event.v1' as const,
    run_id: state.run_id,
    harness_generation: state.harness_generation,
    loadout_id: state.loadout_id,
    event_sequence: events.length,
    previous_event_sha256: events.at(-1)?.event_sha256 ?? null,
    ...structuredClone(payload),
  }
  return { ...body, event_sha256: sha256Domain(EVENT_HASH_DOMAIN, body) } as ScientificEventEnvelope
}

export function verifyEventChain(events: unknown): events is ScientificEventEnvelope[] {
  if (!Array.isArray(events)) return false
  let previous: string | null = null
  for (const [sequence, value] of events.entries()) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const event = value as ScientificEventEnvelope
    if (event.schema !== 'mykrobial.scientific-run-event.v1'
      || event.event_sequence !== sequence
      || event.previous_event_sha256 !== previous
      || !SHA256.test(event.event_sha256)) return false
    if (sha256Domain(EVENT_HASH_DOMAIN, eventBody(event)) !== event.event_sha256) return false
    previous = event.event_sha256
  }
  return true
}

export const CHECKPOINT_NON_CLAIMS = [
  'not_cryptographic_authenticity',
  'not_provider_model_or_tool_execution',
  'not_trace_append',
  'not_runtime_adoption',
] as const

export function checkpointBody(checkpoint: ScientificCheckpoint): Omit<ScientificCheckpoint, 'checkpoint_sha256'> {
  const { checkpoint_sha256: _ignored, ...body } = checkpoint
  return body
}

export function buildCheckpoint(state: ScientificRunState, events: ScientificEventEnvelope[]): ScientificCheckpoint {
  const body = {
    schema: 'mykrobial.scientific-run-checkpoint.v1' as const,
    state: structuredClone(state),
    events: structuredClone(events),
    non_claims: [...CHECKPOINT_NON_CLAIMS],
  }
  return { ...body, checkpoint_sha256: sha256Domain(CHECKPOINT_HASH_DOMAIN, body) }
}

export function verifyCheckpointHash(checkpoint: ScientificCheckpoint): boolean {
  return checkpoint.schema === 'mykrobial.scientific-run-checkpoint.v1'
    && canonicalJson(checkpoint.non_claims) === canonicalJson(CHECKPOINT_NON_CLAIMS)
    && SHA256.test(checkpoint.checkpoint_sha256)
    && checkpoint.checkpoint_sha256 === sha256Domain(CHECKPOINT_HASH_DOMAIN, checkpointBody(checkpoint))
}
