import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  externalEventCanonicalSha256,
  projectExternalHarnessEvent,
  type ExternalHarnessEventInput,
  type ExternalHarnessEventKind,
} from '../src/index.ts'

const digest = (label: string): string => createHash('sha256').update(label).digest('hex')

const unavailableUsage = {
  input_tokens: null,
  output_tokens: null,
  cached_tokens: null,
  monetary_usd: null,
  energy_wh: null,
  wall_ms: null,
  human_minutes: null,
  basis: 'unavailable' as const,
}

function fixture(
  source_event_kind: ExternalHarnessEventKind,
  overrides: Partial<ExternalHarnessEventInput> = {},
): ExternalHarnessEventInput {
  const raw = digest(`raw-${source_event_kind}`)
  const direction = source_event_kind === 'message' ? 'inbound' as const : null
  const executionOutcome = source_event_kind === 'rebuild_and_restart_outcome'
    ? 'succeeded' as const
    : null
  const usage = source_event_kind === 'usage'
    ? {
        input_tokens: 100,
        output_tokens: 25,
        cached_tokens: 20,
        monetary_usd: 0.0125,
        energy_wh: null,
        wall_ms: 900,
        human_minutes: 0,
        basis: 'provider_receipt' as const,
      }
    : unavailableUsage
  return {
    schema: 'mykrobial.external-harness-event.v1',
    source_system: 'exo',
    source_event_id: `event-${source_event_kind}`,
    source_event_kind,
    source_sequence: 7,
    occurred_at: '2030-01-01T00:00:00Z',
    source_artifact: {
      ref: `exo://conversation/event-${source_event_kind}`,
      sha256: raw,
      bytes: 512,
      media_type: 'application/json',
      storage_class: 'external',
    },
    source_event_sha256: raw,
    run_id: 'run-external-event',
    task_capsule_id: 'task-external-event',
    loadout_id: 'loadout-retrodict',
    component_ids: ['component-external-adapter', 'component-retrodict'],
    primary_component_id: 'component-external-adapter',
    branch_id: 'branch-main',
    component_generation: 3,
    previous_trajectory_event_sha256: digest('previous-trajectory-event'),
    direction,
    execution_outcome: executionOutcome,
    usage,
    source_payload_contains_hidden_reasoning: false,
    source_trust: 'untrusted_external_source',
    ...overrides,
  }
}

test('all seven Exo-style event classes map into the shared trajectory vocabulary', () => {
  const expected = {
    message: 'observation',
    tool_requested: 'action_expectation',
    tool_result: 'action_result',
    sandbox_snapshotted: 'checkpoint',
    thread_forked: 'experiment',
    rebuild_and_restart_outcome: 'result',
    usage: 'cost',
  }
  for (const [kind, trajectoryKind] of Object.entries(expected)) {
    const projection = projectExternalHarnessEvent(
      fixture(kind as ExternalHarnessEventKind),
      'trace-external-event',
      'session-external-event',
    )
    assert.equal(projection.trajectory_event.kind, trajectoryKind)
    assert.equal(projection.trajectory_event.payload_sha256, projection.trajectory_event.payload_ref.sha256)
    assert.equal(projection.trace_v2_3_intent.source_event_sha256, projection.trajectory_event.event_sha256)
    assert.equal(projection.trace_v2_3_intent.content_mode, 'metadata_only')
    assert.equal(projection.trace_append_authorized, false)
    assert.equal(projection.optimizer_execution_authorized, false)
    assert.equal(projection.component_application_authorized, false)
  }
})

test('outbound messages map to result while inbound and internal map to observation', () => {
  for (const [direction, kind] of [
    ['inbound', 'observation'],
    ['internal', 'observation'],
    ['outbound', 'result'],
  ] as const) {
    const projection = projectExternalHarnessEvent(
      fixture('message', { direction }),
      'trace-direction',
      'session-direction',
    )
    assert.equal(projection.trajectory_event.kind, kind)
  }
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('message', { direction: null }),
      'trace-direction',
      'session-direction',
    ),
    /typed_blocker:external_event_direction_missing/,
  )
})

test('usage becomes exact cost evidence while non-usage cannot smuggle cost', () => {
  const usage = projectExternalHarnessEvent(
    fixture('usage'),
    'trace-usage',
    'session-usage',
  )
  assert.deepEqual(usage.trajectory_event.cost, fixture('usage').usage)
  assert.equal(usage.trajectory_event.temporal.duration_ms, 900)
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('tool_result', { usage: fixture('usage').usage }),
      'trace-usage',
      'session-usage',
    ),
    /typed_blocker:external_event_usage_unexpected/,
  )
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('usage', { usage: unavailableUsage }),
      'trace-usage',
      'session-usage',
    ),
    /typed_blocker:external_event_usage_invalid/,
  )
})

test('raw event hash and closed source object fail closed before projection', () => {
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('tool_result', { source_event_sha256: digest('forged') }),
      'trace-binding',
      'session-binding',
    ),
    /typed_blocker:external_event_artifact_binding_invalid/,
  )
  const open = {
    ...fixture('tool_result'),
    unexpected_authority: true,
  } as ExternalHarnessEventInput
  assert.throws(
    () => projectExternalHarnessEvent(open, 'trace-binding', 'session-binding'),
    /typed_blocker:external_harness_event_invalid/,
  )
  const hidden = {
    ...fixture('tool_result'),
    source_payload_contains_hidden_reasoning: true,
  } as unknown as ExternalHarnessEventInput
  assert.throws(
    () => projectExternalHarnessEvent(hidden, 'trace-binding', 'session-binding'),
    /typed_blocker:external_harness_event_invalid/,
  )
  const unknownKind = {
    ...fixture('tool_result'),
    source_event_kind: 'unknown_external_kind',
  } as unknown as ExternalHarnessEventInput
  assert.throws(
    () => projectExternalHarnessEvent(unknownKind, 'trace-binding', 'session-binding'),
    /typed_blocker:external_harness_event_invalid/,
  )
  const badBasis = fixture('usage')
  badBasis.usage = { ...badBasis.usage, basis: 'invented' as 'provider_receipt' }
  assert.throws(
    () => projectExternalHarnessEvent(badBasis, 'trace-binding', 'session-binding'),
    /typed_blocker:external_event_usage_invalid/,
  )
})

test('every identity surface rejects non-string runtime aliases', () => {
  const aliases = [true, 7, null, { value: 'id' }, ['id']]
  const inputFields = [
    'source_event_id', 'run_id', 'task_capsule_id', 'loadout_id',
    'primary_component_id', 'branch_id',
  ] as const
  for (const field of inputFields) {
    for (const alias of aliases) {
      const input = fixture('tool_result') as unknown as Record<string, unknown>
      input[field] = alias
      assert.throws(
        () => projectExternalHarnessEvent(
          input as unknown as ExternalHarnessEventInput,
          'trace-identity',
          'session-identity',
        ),
        /typed_blocker:external_event_identity_invalid|typed_blocker:external_event_primary_component_invalid/,
      )
    }
  }
  for (const alias of aliases) {
    const input = fixture('tool_result') as unknown as Record<string, unknown>
    input.component_ids = [alias]
    input.primary_component_id = alias
    assert.throws(
      () => projectExternalHarnessEvent(
        input as unknown as ExternalHarnessEventInput,
        'trace-identity',
        'session-identity',
      ),
      /typed_blocker:external_event_identity_invalid/,
    )
    assert.throws(
      () => projectExternalHarnessEvent(
        fixture('tool_result'),
        alias as unknown as string,
        'session-identity',
      ),
      /typed_blocker:external_event_identity_invalid/,
    )
    assert.throws(
      () => projectExternalHarnessEvent(
        fixture('tool_result'),
        'trace-identity',
        alias as unknown as string,
      ),
      /typed_blocker:external_event_identity_invalid/,
    )
  }
})

test('digest and timestamp surfaces reject coercible non-string aliases', () => {
  const badDigest = fixture('tool_result') as unknown as Record<string, unknown>
  badDigest.previous_trajectory_event_sha256 = true
  assert.throws(
    () => projectExternalHarnessEvent(
      badDigest as unknown as ExternalHarnessEventInput,
      'trace-type',
      'session-type',
    ),
    /typed_blocker:external_event_digest_invalid/,
  )
  const badTime = fixture('tool_result') as unknown as Record<string, unknown>
  badTime.occurred_at = 20300101
  assert.throws(
    () => projectExternalHarnessEvent(
      badTime as unknown as ExternalHarnessEventInput,
      'trace-type',
      'session-type',
    ),
    /typed_blocker:external_event_timestamp_invalid/,
  )
})

test('loss accounting is explicit self-bound and never claims external rollback', () => {
  const projection = projectExternalHarnessEvent(
    fixture('sandbox_snapshotted'),
    'trace-loss',
    'session-loss',
  )
  assert.equal(projection.loss_accounting.metadata_projection_lossy, true)
  assert.equal(projection.loss_accounting.raw_event_content_addressed, true)
  assert.equal(projection.loss_accounting.hidden_reasoning_accessed, false)
  assert.equal(projection.loss_accounting.external_state_rollback_covered, false)
  assert.deepEqual(projection.loss_accounting.dropped_fields, [
    'hidden_reasoning', 'raw_payload_body', 'secret_material',
  ])
  assert.equal(
    projection.loss_accounting.loss_accounting_sha256,
    externalEventCanonicalSha256(
      Object.fromEntries(
        Object.entries(projection.loss_accounting)
          .filter(([key]) => key !== 'loss_accounting_sha256'),
      ),
    ),
  )
  assert.equal(
    projection.projection_sha256,
    externalEventCanonicalSha256(
      Object.fromEntries(
        Object.entries(projection).filter(([key]) => key !== 'projection_sha256'),
      ),
    ),
  )
})

test('rebuild outcomes and field-specific values cannot appear on the wrong event class', () => {
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('rebuild_and_restart_outcome', { execution_outcome: null }),
      'trace-outcome',
      'session-outcome',
    ),
    /typed_blocker:external_event_execution_outcome_missing/,
  )
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('tool_requested', { execution_outcome: 'succeeded' }),
      'trace-outcome',
      'session-outcome',
    ),
    /typed_blocker:external_event_execution_outcome_unexpected/,
  )
  assert.throws(
    () => projectExternalHarnessEvent(
      fixture('tool_requested', { direction: 'internal' }),
      'trace-outcome',
      'session-outcome',
    ),
    /typed_blocker:external_event_direction_unexpected/,
  )
})

test('projection is deterministic and input remains unmodified', () => {
  const input = fixture('thread_forked')
  const before = structuredClone(input)
  const first = projectExternalHarnessEvent(input, 'trace-deterministic', 'session-deterministic')
  const second = projectExternalHarnessEvent(input, 'trace-deterministic', 'session-deterministic')
  assert.deepEqual(input, before)
  assert.deepEqual(first, second)
  assert.equal(first.projection_sha256, second.projection_sha256)
})
