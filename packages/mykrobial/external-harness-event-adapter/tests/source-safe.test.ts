import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  externalEventCanonicalSha256,
  prepareTerminalTaskAuthorityHostRequestV38,
  prepareTerminalTaskContextRequest,
  projectExternalHarnessEvent,
  type ExternalHarnessEventInput,
  type ExternalHarnessEventKind,
  type PrepareTerminalTaskContextRequestInput,
  type TerminalTaskContextRequest,
  type TerminalTaskAuthorityHostRequestV38,
  validateTerminalTaskAuthorityHostRequestV38,
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

function terminalContext(
  overrides: Partial<PrepareTerminalTaskContextRequestInput> = {},
): PrepareTerminalTaskContextRequestInput {
  return {
    request_id: 'terminal-context-request-one',
    canonical_terminal_row_sha256: digest('canonical-terminal-row'),
    terminal_family: 'answer_commit',
    task_label_sha256: digest('task-label'),
    session_id_sha256: digest('session-label'),
    tenant_scope_sha256: digest('tenant-scope'),
    domain: 'engineering',
    requested_receipt_ref: digest('requested-receipt'),
    served_receipt_ref: digest('served-receipt'),
    source_generation: 'next-deepseek-cordis-v1',
    visible_generation_sha256: digest('visible-generation'),
    first_visible_event_id: 'visible-event-001',
    last_visible_event_id: 'visible-event-004',
    visible_event_count: 4,
    created_at: '2030-01-01T00:01:00Z',
    ...overrides,
  }
}

function resealProjection(
  source: ReturnType<typeof projectExternalHarnessEvent>,
): ReturnType<typeof projectExternalHarnessEvent> {
  const value = structuredClone(source)
  value.trajectory_event.event_sha256 = externalEventCanonicalSha256(
    Object.fromEntries(
      Object.entries(value.trajectory_event).filter(([key]) => key !== 'event_sha256'),
    ),
  )
  value.trace_v2_3_intent.source_event_sha256 = value.trajectory_event.event_sha256
  value.loss_accounting.loss_accounting_sha256 = externalEventCanonicalSha256(
    Object.fromEntries(
      Object.entries(value.loss_accounting).filter(([key]) => key !== 'loss_accounting_sha256'),
    ),
  )
  value.projection_sha256 = externalEventCanonicalSha256(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'projection_sha256')),
  )
  return value
}

test('terminal context request carries the exact V37 public context without issuing it', () => {
  const projection = projectExternalHarnessEvent(
    fixture('rebuild_and_restart_outcome'),
    'trace-terminal-context',
    'session-terminal-context',
  )
  const request = prepareTerminalTaskContextRequest(projection, terminalContext())
  assert.equal(request.target_context_schema, 'mykrobial.trace.terminal_task_context_receipt.v1')
  assert.equal(request.target_binding_schema, 'mykrobial.trace.terminal_task_binding.v1')
  assert.equal(request.namespace, 'mykrobial.trace.terminal-task-context.v37')
  assert.equal(request.operation, 'bind_terminal_row_to_visible_task_range')
  assert.equal(request.task_label_sha256, digest('task-label'))
  assert.equal(request.session_id_sha256, digest('session-label'))
  assert.equal(request.tenant_scope_sha256, digest('tenant-scope'))
  assert.equal(request.visible_event_count, 4)
  assert.equal(request.distinct_context_signer_and_verifier_required, true)
  assert.equal(request.context_signature_authorized, false)
  assert.equal(request.terminal_binding_emission_authorized, false)
  assert.equal(request.trace_append_authorized, false)
  assert.equal(request.historical_relabel_authorized, false)
  assert.equal(request.task_inferred_from_message_or_event_order, false)
  assert.equal(request.terminal_content_persisted, false)
  assert.equal(
    request.request_sha256,
    externalEventCanonicalSha256(
      Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'request_sha256')),
    ),
  )
})

test('terminal context request never infers a terminal task from a message projection', () => {
  const message = projectExternalHarnessEvent(
    fixture('message'),
    'trace-terminal-message',
    'session-terminal-message',
  )
  assert.throws(
    () => prepareTerminalTaskContextRequest(message, terminalContext()),
    /typed_blocker:terminal_task_context_request_invalid/,
  )
})

test('terminal context range count and closed request reject aliases and extras', () => {
  const projection = projectExternalHarnessEvent(
    fixture('tool_result'),
    'trace-terminal-range',
    'session-terminal-range',
  )
  for (const count of [0, -1, 1.5, true, null]) {
    assert.throws(
      () => prepareTerminalTaskContextRequest(
        projection,
        terminalContext({ visible_event_count: count as unknown as number }),
      ),
      /typed_blocker:terminal_task_context_request_invalid/,
    )
  }
  const open = {
    ...terminalContext(),
    signature: 'forbidden-at-request-stage',
  } as unknown as PrepareTerminalTaskContextRequestInput
  assert.throws(
    () => prepareTerminalTaskContextRequest(projection, open),
    /typed_blocker:terminal_task_context_request_invalid/,
  )
  assert.throws(
    () => prepareTerminalTaskContextRequest(
      projection,
      null as unknown as PrepareTerminalTaskContextRequestInput,
    ),
    /typed_blocker:terminal_task_context_request_invalid/,
  )
  assert.throws(
    () => prepareTerminalTaskContextRequest(
      null as unknown as ReturnType<typeof projectExternalHarnessEvent>,
      terminalContext(),
    ),
    /typed_blocker:external_event_projection_invalid/,
  )
})

test('all V37 digest and identifier fields are exact and projection-bound', () => {
  const projection = projectExternalHarnessEvent(
    fixture('thread_forked'),
    'trace-terminal-bind',
    'session-terminal-bind',
  )
  const digestFields = [
    'canonical_terminal_row_sha256', 'task_label_sha256', 'session_id_sha256',
    'tenant_scope_sha256', 'requested_receipt_ref', 'served_receipt_ref',
    'visible_generation_sha256',
  ] as const
  for (const field of digestFields) {
    assert.throws(
      () => prepareTerminalTaskContextRequest(
        projection,
        terminalContext({ [field]: true } as unknown as Partial<PrepareTerminalTaskContextRequestInput>),
      ),
      /typed_blocker:external_event_digest_invalid/,
    )
  }
  const identifierFields = [
    'request_id', 'domain', 'source_generation', 'first_visible_event_id',
    'last_visible_event_id',
  ] as const
  for (const field of identifierFields) {
    assert.throws(
      () => prepareTerminalTaskContextRequest(
        projection,
        terminalContext({ [field]: 7 } as unknown as Partial<PrepareTerminalTaskContextRequestInput>),
      ),
      /typed_blocker:terminal_task_context_identity_invalid/,
    )
  }
  const forged = structuredClone(projection)
  forged.trace_append_authorized = true as false
  assert.throws(
    () => prepareTerminalTaskContextRequest(forged, terminalContext()),
    /typed_blocker:external_event_projection_invalid/,
  )
})

test('rehashed projection extras and altered nonclaims cannot authorize a context request', () => {
  const baseline = projectExternalHarnessEvent(
    fixture('tool_result'),
    'trace-terminal-closure',
    'session-terminal-closure',
  )
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    value => { value.unexpected = true },
    value => {
      (value.trajectory_event as unknown as Record<string, unknown>).unexpected = true
    },
    value => {
      const event = value.trajectory_event as unknown as Record<string, unknown>
      const temporal = event.temporal as Record<string, unknown>
      temporal.unexpected = true
    },
    value => {
      const event = value.trajectory_event as unknown as Record<string, unknown>
      const proof = event.proof as Record<string, unknown>
      const execution = proof.execution as Record<string, unknown>
      execution.unexpected = true
    },
    value => {
      (value.trace_v2_3_intent as unknown as Record<string, unknown>).unexpected = true
    },
    value => {
      (value.loss_accounting as unknown as Record<string, unknown>).unexpected = true
    },
    value => {
      value.non_claims = ['not_trace_append']
    },
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(baseline) as unknown as Record<string, unknown>
    mutate(candidate)
    const resealed = resealProjection(
      candidate as unknown as ReturnType<typeof projectExternalHarnessEvent>,
    )
    assert.throws(
      () => prepareTerminalTaskContextRequest(resealed, terminalContext()),
      /typed_blocker:external_event_projection_invalid/,
    )
  }
})

test('both canonical terminal families are explicit request inputs, never derived outputs', () => {
  const projection = projectExternalHarnessEvent(
    fixture('rebuild_and_restart_outcome'),
    'trace-terminal-family',
    'session-terminal-family',
  )
  for (const family of ['answer_commit', 'execution_timed_out'] as const) {
    const request = prepareTerminalTaskContextRequest(
      projection,
      terminalContext({ terminal_family: family }),
    )
    assert.equal(request.terminal_family, family)
    assert.equal(request.state, 'context_request_only_unissued')
  }
})

function validTerminalContextRequest(): TerminalTaskContextRequest {
  const projection = projectExternalHarnessEvent(
    fixture('rebuild_and_restart_outcome'),
    'trace-v38-host',
    'session-v38-host',
  )
  return prepareTerminalTaskContextRequest(projection, terminalContext())
}

function resealContextRequest(source: TerminalTaskContextRequest): TerminalTaskContextRequest {
  const value = structuredClone(source)
  value.request_sha256 = externalEventCanonicalSha256(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'request_sha256')),
  )
  return value
}

function resealV38HostRequest(
  source: TerminalTaskAuthorityHostRequestV38,
): TerminalTaskAuthorityHostRequestV38 {
  const value = structuredClone(source)
  value.request_sha256 = externalEventCanonicalSha256(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'request_sha256')),
  )
  return value
}

test('V38 host request binds the unsigned subject, exact scope and callback vocabulary', () => {
  const context = validTerminalContextRequest()
  const request = prepareTerminalTaskAuthorityHostRequestV38(context, {
    operation_profile_receipt_sha256: digest('operation-profile-receipt'),
    requested_ttl_seconds: 600,
  })
  assert.equal(request.subject.schema, 'mykrobial.trace.terminal_task_context_subject.v38')
  assert.equal(request.subject.state, 'unsigned_unapproved')
  assert.equal(request.subject.terminal_row_sha256, context.canonical_terminal_row_sha256)
  assert.equal(request.subject.task_label_sha256, context.task_label_sha256)
  assert.equal(request.subject.session_id_sha256, context.session_id_sha256)
  assert.equal(request.subject.tenant_scope_sha256, context.tenant_scope_sha256)
  assert.equal(request.subject.visible_event_count, context.visible_event_count)
  assert.equal(request.subject.operation_profile_receipt_sha256, digest('operation-profile-receipt'))
  assert.equal(request.subject.requested_ttl_seconds, 600)
  assert.equal(request.subject.signature_present, false)
  assert.equal(request.subject.authority_effect, 'none_until_delegate_commit')
  assert.equal(
    request.subject.subject_sha256,
    externalEventCanonicalSha256(
      Object.fromEntries(
        Object.entries(request.subject).filter(([key]) => key !== 'subject_sha256'),
      ),
    ),
  )
  assert.equal(request.scope.context_subject_sha256, request.subject.subject_sha256)
  assert.equal(request.scope.operation_profile_receipt_sha256, request.subject.operation_profile_receipt_sha256)
  assert.equal(
    request.authority_delegate_contract.adapter,
    'named_agents/adapters/authority_delegate.py::prepare_authority_delegate_request',
  )
  assert.equal(request.authority_delegate_contract.automation_owner_agent_id, 'agent:mykrobial-security')
  assert.equal(request.authority_delegate_contract.ready_nonclaims.length, 8)
  assert.equal(request.authority_delegate_contract.blocked_nonclaims.length, 7)
  assert.equal(request.authority_delegate_contract.canonical_blockers.length, 13)
  assert.equal(request.authority.authority_delegate_request_built, false)
  assert.equal(request.authority.nonce_reserved, false)
  assert.equal(request.authority.operation_admitted, false)
  assert.equal(
    request.request_sha256,
    externalEventCanonicalSha256(
      Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'request_sha256')),
    ),
  )
})

test('V38 host request contains no content, enrollment, nonce or signature payload', () => {
  const request = prepareTerminalTaskAuthorityHostRequestV38(validTerminalContextRequest(), {
    operation_profile_receipt_sha256: digest('operation-profile-receipt'),
    requested_ttl_seconds: 300,
  })
  const raw = JSON.stringify(request)
  for (const forbidden of [
    'answer_text', 'message_content', 'raw_task_label', 'signature_value',
    'requester_enrollment":', 'request_nonce":', 'private_key',
  ]) {
    assert.equal(raw.includes(forbidden), false)
  }
})

test('V38 host request rejects profile and TTL aliases before building a subject', () => {
  const context = validTerminalContextRequest()
  for (const ttl of [0, -1, 901, 1.5, true, null]) {
    assert.throws(
      () => prepareTerminalTaskAuthorityHostRequestV38(context, {
        operation_profile_receipt_sha256: digest('operation-profile-receipt'),
        requested_ttl_seconds: ttl as unknown as number,
      }),
      /typed_blocker:terminal_task_authority_host_request_invalid/,
    )
  }
  assert.throws(
    () => prepareTerminalTaskAuthorityHostRequestV38(context, {
      operation_profile_receipt_sha256: true as unknown as string,
      requested_ttl_seconds: 300,
    }),
    /typed_blocker:external_event_digest_invalid/,
  )
})

test('V38 host request rejects resealed context extras, altered nonclaims and authority flags', () => {
  const base = validTerminalContextRequest()
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    value => { value.unexpected = true },
    value => { value.non_claims = ['forged_acceptance'] },
    value => { value.context_signature_authorized = true },
    value => { value.historical_relabel_authorized = true },
  ]
  for (const mutate of mutations) {
    const value = structuredClone(base) as unknown as Record<string, unknown>
    mutate(value)
    const resealed = resealContextRequest(value as unknown as TerminalTaskContextRequest)
    assert.throws(
      () => prepareTerminalTaskAuthorityHostRequestV38(resealed, {
        operation_profile_receipt_sha256: digest('operation-profile-receipt'),
        requested_ttl_seconds: 300,
      }),
      /typed_blocker:terminal_task_context_request_invalid/,
    )
  }
})

test('V38 host request pins the accepted V37 source and review identities', () => {
  const request = prepareTerminalTaskAuthorityHostRequestV38(validTerminalContextRequest(), {
    operation_profile_receipt_sha256: digest('operation-profile-receipt'),
    requested_ttl_seconds: 300,
  })
  assert.deepEqual(request.subject.v37_source, {
    pull_request: 'https://github.com/mykrobial/mykrobial-harness/pull/670',
    merge_commit: '661f1cd7680a97413eb0d47a0cd19c14bc62ea36',
    source_review_sha256: '0fbc0f742d195786d3c84b023978cc4627921e1a4d9af85b644142dff98f8906',
    source_sha256: '41b69284cf397beb787471bd8951cdd99b532b1f9c7ff5317a19c458147c9bc9',
    contract_sha256: 'b97a77d986717181d59f2fcbd566ebca65e26fe2e3ef93551c601b56ac73a376',
  })
})

test('V38 canonical blocker vocabulary is exact ordered and reseal-resistant', () => {
  const baseline = prepareTerminalTaskAuthorityHostRequestV38(validTerminalContextRequest(), {
    operation_profile_receipt_sha256: digest('operation-profile-receipt'),
    requested_ttl_seconds: 300,
  })
  const mutations: Array<(value: TerminalTaskAuthorityHostRequestV38) => void> = [
    value => {
      value.authority_delegate_contract.canonical_blockers = Array.from(
        { length: 13 },
        (_, index) => `typed_blocker:authority_delegate_forged_${String(index).padStart(2, '0')}`,
      ) as TerminalTaskAuthorityHostRequestV38['authority_delegate_contract']['canonical_blockers']
    },
    value => {
      value.authority_delegate_contract.canonical_blockers = value.authority_delegate_contract
        .canonical_blockers.slice(0, -1) as TerminalTaskAuthorityHostRequestV38['authority_delegate_contract']['canonical_blockers']
    },
    value => {
      const blockers = value.authority_delegate_contract.canonical_blockers as unknown as string[]
      blockers[3] = 'typed_blocker:authority_delegate_forged_substitution'
    },
    value => {
      const blockers = value.authority_delegate_contract.canonical_blockers as unknown as string[]
      const first = blockers[0]!
      blockers[0] = blockers[1]!
      blockers[1] = first
    },
  ]
  for (const mutate of mutations) {
    const value = structuredClone(baseline)
    mutate(value)
    assert.throws(
      () => validateTerminalTaskAuthorityHostRequestV38(resealV38HostRequest(value)),
      /typed_blocker:terminal_task_authority_host_request_invalid/,
    )
  }
  assert.deepEqual(validateTerminalTaskAuthorityHostRequestV38(baseline), baseline)
})
