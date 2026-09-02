import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  componentCanonicalSha256,
  ComponentEvolutionGuardian,
  type AppendComponentGuardianEventInput,
  type ComponentGuardianConfig,
  type ComponentGuardianEventKind,
  validateComponentGuardianCommand,
} from '../src/index.ts'

const digest = (label: string): string => createHash('sha256').update(label).digest('hex')

function config(overrides: Partial<ComponentGuardianConfig> = {}): ComponentGuardianConfig {
  return {
    guardian_id: 'guardian-scientific-retrodiction',
    component_id: 'scientific-retrodiction',
    task_capsule_id: 'task-guardian-fixture',
    loadout_id: 'loadout-retrodict',
    baseline_snapshot_sha256: digest('snapshot-baseline'),
    baseline_definition_sha256: digest('definition-baseline'),
    baseline_trajectory_event_sha256: digest('trajectory-baseline'),
    baseline_trace_v23_intent_sha256: digest('trace-baseline'),
    created_at: '2030-01-01T00:00:00Z',
    max_events: 8,
    max_candidate_attempts: 2,
    ...overrides,
  }
}

function event(
  kind: Exclude<ComponentGuardianEventKind, 'baseline_registered'>,
  sequence: number,
  overrides: Partial<AppendComponentGuardianEventInput> = {},
): AppendComponentGuardianEventInput {
  const candidate = digest('candidate-one')
  const proposal = digest('proposal-one')
  const activationKinds = new Set<ComponentGuardianEventKind>([
    'activation_committed',
    'activation_rolled_back',
    'activation_contaminated',
  ])
  return {
    event_id: `guardian-event-${sequence}`,
    kind,
    occurred_at: `2030-01-01T00:00:0${sequence}Z`,
    component_snapshot_sha256: kind === 'mutation_proposed'
      ? digest('snapshot-baseline')
      : digest(`snapshot-${sequence}`),
    candidate_definition_sha256: kind === 'mutation_proposed' || activationKinds.has(kind)
      ? candidate
      : null,
    mutation_proposal_sha256: kind === 'mutation_proposed' || activationKinds.has(kind)
      ? proposal
      : null,
    activation_receipt_sha256: activationKinds.has(kind) || kind === 'restart_observed'
      ? digest(`activation-${sequence}`)
      : null,
    trajectory_event_sha256: digest(`trajectory-${sequence}`),
    trace_v23_intent_sha256: digest(`trace-${sequence}`),
    evidence_sha256: digest(`evidence-${sequence}`),
    ...overrides,
  }
}

function proposedGuardian(): ComponentEvolutionGuardian {
  const guardian = new ComponentEvolutionGuardian(config())
  guardian.append(event('mutation_proposed', 1))
  return guardian
}

function readPath(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const key of path) current = (current as Record<string, unknown>)[key]
  return current
}

function replacePath(root: unknown, path: readonly string[], value: unknown): void {
  let parent = root as Record<string, unknown>
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>
  parent[path[path.length - 1]!] = value
}

function withAuthorityPrototype(value: unknown[]): unknown[] {
  const prototype = Object.create(Array.prototype) as Record<string, unknown>
  Object.defineProperty(prototype, 'apply_authorized', { value: true, enumerable: true })
  Object.setPrototypeOf(value, prototype)
  return value
}

function asAuthoritySubclass(value: unknown[]): unknown[] {
  class AuthorityArray extends Array<unknown> {}
  Object.defineProperty(AuthorityArray.prototype, 'apply_authorized', {
    value: true,
    enumerable: true,
  })
  return new AuthorityArray(...value)
}

function transparentProxy(value: unknown[], reads: { count: number }): unknown[] {
  return new Proxy(value, {
    get(target, property, receiver) {
      reads.count += 1
      return Reflect.get(target, property, receiver)
    },
  })
}

function withAuthoritySymbol<T extends object>(value: T): T {
  Object.defineProperty(value, Symbol('apply_authorized'), {
    value: true,
    enumerable: true,
  })
  return value
}

test('guardian starts with one sealed append-only baseline event', () => {
  const guardian = new ComponentEvolutionGuardian(config())
  const snapshot = guardian.snapshot()
  assert.equal(snapshot.events.length, 1)
  assert.equal(snapshot.events[0]!.kind, 'baseline_registered')
  assert.equal(snapshot.events[0]!.sequence, 0)
  assert.equal(snapshot.events[0]!.previous_event_sha256, '0'.repeat(64))
  assert.equal(snapshot.events[0]!.history_rewrite_authorized, false)
  assert.equal(snapshot.events[0]!.component_application_authorized, false)
  assert.equal(snapshot.events[0]!.trace_append_authorized, false)
  assert.equal(snapshot.events[0]!.event_sha256, componentCanonicalSha256({
    ...snapshot.events[0],
    event_sha256: '0'.repeat(64),
  }))
  assert.equal(snapshot.snapshot_sha256, componentCanonicalSha256({
    ...snapshot,
    snapshot_sha256: '0'.repeat(64),
  }))
})

test('proposal and activation facts form a causal hash chain that rehydrates exactly', () => {
  const guardian = proposedGuardian()
  guardian.append(event('activation_committed', 2))
  const snapshot = guardian.snapshot()
  assert.equal(snapshot.events.length, 3)
  assert.equal(snapshot.events[1]!.previous_event_sha256, snapshot.events[0]!.event_sha256)
  assert.equal(snapshot.events[2]!.previous_event_sha256, snapshot.events[1]!.event_sha256)
  assert.equal(snapshot.events[2]!.kind, 'activation_committed')
  assert.equal(snapshot.candidate_attempts[0]!.attempt_count, 1)
  assert.deepEqual(snapshot.proposal_bindings, [{
    candidate_definition_sha256: digest('candidate-one'),
    mutation_proposal_sha256: digest('proposal-one'),
    attempt_count: 1,
  }])
  assert.deepEqual(ComponentEvolutionGuardian.rehydrate(snapshot).snapshot(), snapshot)
})

test('rewind preparation never rewinds guardian history or claims external rollback', () => {
  const guardian = proposedGuardian()
  guardian.append(event('activation_committed', 2))
  const before = guardian.snapshot()
  const command = guardian.prepareCommand({
    operation: 'rewind_component',
    target_snapshot_sha256: digest('snapshot-baseline'),
    reconfiguration_plan_sha256: digest('reconfiguration-plan'),
    external_state_rollback_receipt_sha256: null,
    requested_at: '2030-01-01T00:00:03Z',
  })
  assert.equal(command.state, 'prepared_unexecuted')
  assert.equal(command.apply_authorized, false)
  assert.equal(command.history_rewrite_authorized, false)
  assert.equal(command.external_state_rollback_verified, false)
  assert.ok(command.blockers.includes('typed_blocker:external_state_rollback_receipt_missing'))
  assert.deepEqual(validateComponentGuardianCommand(command), command)
  assert.deepEqual(guardian.snapshot(), before)
})

test('fixed rebuild and restart can target only the current component snapshot', () => {
  const guardian = proposedGuardian()
  guardian.append(event('activation_committed', 2))
  assert.throws(() => guardian.prepareCommand({
    operation: 'rebuild_and_restart_component',
    target_snapshot_sha256: digest('snapshot-baseline'),
    reconfiguration_plan_sha256: digest('reconfiguration-plan'),
    external_state_rollback_receipt_sha256: digest('external-rollback'),
    requested_at: '2030-01-01T00:00:03Z',
  }), /typed_blocker:component_guardian_restart_target_not_current/)
  const command = guardian.prepareCommand({
    operation: 'rebuild_and_restart_component',
    target_snapshot_sha256: digest('snapshot-2'),
    reconfiguration_plan_sha256: digest('reconfiguration-plan'),
    external_state_rollback_receipt_sha256: digest('external-rollback'),
    requested_at: '2030-01-01T00:00:03Z',
  })
  assert.equal(command.restart_authorized, false)
  assert.equal(command.external_state_rollback_receipt_sha256, digest('external-rollback'))
  assert.equal(command.external_state_rollback_verified, false)
})

test('candidate attempt and total event budgets stop recursive loops', () => {
  const guardian = new ComponentEvolutionGuardian(config({ max_candidate_attempts: 2, max_events: 4 }))
  guardian.append(event('mutation_proposed', 1))
  guardian.append(event('mutation_proposed', 2, { event_id: 'guardian-event-proposal-two' }))
  assert.throws(() => guardian.append(event('mutation_proposed', 3, {
    event_id: 'guardian-event-proposal-three',
  })), /typed_blocker:component_guardian_candidate_attempt_budget_exhausted/)
  guardian.append(event('snapshot_captured', 3))
  assert.throws(() => guardian.append(event('snapshot_captured', 4)),
    /typed_blocker:component_guardian_event_budget_exhausted/)
})

test('guardian rejects duplicate identities and regressed event time', () => {
  const guardian = new ComponentEvolutionGuardian(config())
  guardian.append(event('snapshot_captured', 2, { event_id: 'guardian-event-stable' }))
  assert.throws(() => guardian.append(event('snapshot_captured', 3, {
    event_id: 'guardian-event-stable',
  })), /typed_blocker:component_guardian_event_replayed/)
  assert.throws(() => guardian.append(event('snapshot_captured', 1, {
    event_id: 'guardian-event-regressed',
  })), /typed_blocker:component_guardian_event_time_regressed/)
})

test('mutation and activation events must bind known state and one prior proposal', () => {
  const guardian = new ComponentEvolutionGuardian(config())
  assert.throws(() => guardian.append(event('mutation_proposed', 1, {
    component_snapshot_sha256: digest('unknown-snapshot'),
  })), /typed_blocker:component_guardian_mutation_proposal_invalid/)
  assert.throws(() => guardian.append(event('activation_committed', 1)),
    /typed_blocker:component_guardian_activation_event_invalid/)
  guardian.append(event('mutation_proposed', 1))
  assert.throws(() => guardian.append(event('activation_committed', 2, {
    mutation_proposal_sha256: digest('never-recorded-proposal'),
  })), /typed_blocker:component_guardian_activation_event_invalid/)
  assert.throws(() => guardian.append(event('activation_committed', 2, {
    candidate_definition_sha256: digest('never-proposed-candidate'),
  })), /typed_blocker:component_guardian_activation_event_invalid/)
})

test('closed inputs reject getters, extras, and non-string digest aliases', () => {
  const extraConfig = { ...config(), extra_authority: true } as ComponentGuardianConfig
  assert.throws(() => new ComponentEvolutionGuardian(extraConfig),
    /typed_blocker:component_guardian_config_invalid/)
  const getterConfig = config() as unknown as Record<string, unknown>
  Object.defineProperty(getterConfig, 'guardian_id', { enumerable: true, get: () => 'guardian-getter' })
  assert.throws(() => new ComponentEvolutionGuardian(getterConfig as unknown as ComponentGuardianConfig),
    /typed_blocker:component_guardian_config_invalid/)
  const boxedTimestamp = {
    ...config(),
    created_at: new String('2030-01-01T00:00:00Z'),
  } as unknown as ComponentGuardianConfig
  assert.throws(() => new ComponentEvolutionGuardian(boxedTimestamp),
    /typed_blocker:component_guardian_created_at_invalid/)
  const guardian = new ComponentEvolutionGuardian(config())
  assert.throws(() => guardian.append(event('snapshot_captured', 1, {
    evidence_sha256: true as unknown as string,
  })), /typed_blocker:component_guardian_event_digest_invalid/)
})

test('all persisted arrays reject custom prototypes subclasses and proxies before reads', () => {
  const snapshot = proposedGuardian().snapshot()
  const snapshotRows = [
    { path: ['events'], blocker: /typed_blocker:component_guardian_events_invalid/ },
    {
      path: ['known_snapshot_sha256s'],
      blocker: /typed_blocker:component_guardian_known_snapshots_invalid/,
    },
    {
      path: ['candidate_attempts'],
      blocker: /typed_blocker:component_guardian_candidate_attempts_invalid/,
    },
    {
      path: ['proposal_bindings'],
      blocker: /typed_blocker:component_guardian_proposal_bindings_invalid/,
    },
    {
      path: ['events', '0', 'non_claims'],
      blocker: /typed_blocker:component_guardian_event_non_claims_invalid/,
    },
  ] as const
  for (const row of snapshotRows) {
    const custom = structuredClone(snapshot)
    replacePath(custom, row.path, withAuthorityPrototype(readPath(custom, row.path) as unknown[]))
    assert.throws(() => ComponentEvolutionGuardian.rehydrate(custom), row.blocker)

    const subclass = structuredClone(snapshot)
    replacePath(subclass, row.path, asAuthoritySubclass(readPath(subclass, row.path) as unknown[]))
    assert.throws(() => ComponentEvolutionGuardian.rehydrate(subclass), row.blocker)

    const proxied = structuredClone(snapshot)
    const reads = { count: 0 }
    replacePath(proxied, row.path, transparentProxy(readPath(proxied, row.path) as unknown[], reads))
    assert.throws(() => ComponentEvolutionGuardian.rehydrate(proxied), row.blocker)
    assert.equal(reads.count, 0)
  }

  const guardian = proposedGuardian()
  const command = guardian.prepareCommand({
    operation: 'rewind_component',
    target_snapshot_sha256: digest('snapshot-baseline'),
    reconfiguration_plan_sha256: digest('reconfiguration-plan'),
    external_state_rollback_receipt_sha256: null,
    requested_at: '2030-01-01T00:00:03Z',
  })
  const commandRows = [
    { path: ['blockers'], blocker: /typed_blocker:component_guardian_command_blockers_invalid/ },
    { path: ['non_claims'], blocker: /typed_blocker:component_guardian_command_non_claims_invalid/ },
  ] as const
  for (const row of commandRows) {
    const custom = structuredClone(command)
    replacePath(custom, row.path, withAuthorityPrototype(readPath(custom, row.path) as unknown[]))
    assert.throws(() => validateComponentGuardianCommand(custom), row.blocker)

    const subclass = structuredClone(command)
    replacePath(subclass, row.path, asAuthoritySubclass(readPath(subclass, row.path) as unknown[]))
    assert.throws(() => validateComponentGuardianCommand(subclass), row.blocker)

    const proxied = structuredClone(command)
    const reads = { count: 0 }
    replacePath(proxied, row.path, transparentProxy(readPath(proxied, row.path) as unknown[], reads))
    assert.throws(() => validateComponentGuardianCommand(proxied), row.blocker)
    assert.equal(reads.count, 0)
  }
})

test('all guardian record surfaces reject symbol keys and public proxy aliases', () => {
  assert.throws(() => new ComponentEvolutionGuardian(withAuthoritySymbol(config())),
    /typed_blocker:component_guardian_config_invalid/)
  const configReads = { count: 0 }
  const proxiedConfig = new Proxy(config(), {
    get(target, property, receiver) {
      configReads.count += 1
      return Reflect.get(target, property, receiver)
    },
  })
  assert.throws(() => new ComponentEvolutionGuardian(proxiedConfig),
    /typed_blocker:component_guardian_config_invalid/)
  assert.equal(configReads.count, 0)

  const guardian = proposedGuardian()
  assert.throws(() => guardian.append(withAuthoritySymbol(event('snapshot_captured', 2))),
    /typed_blocker:component_guardian_append_input_invalid/)
  const appendReads = { count: 0 }
  const proxiedAppend = new Proxy(event('snapshot_captured', 2), {
    get(target, property, receiver) {
      appendReads.count += 1
      return Reflect.get(target, property, receiver)
    },
  })
  assert.throws(() => guardian.append(proxiedAppend),
    /typed_blocker:component_guardian_append_input_invalid/)
  assert.equal(appendReads.count, 0)

  const snapshot = guardian.snapshot()
  const snapshotRows = [
    { path: [] as string[], blocker: /typed_blocker:component_guardian_snapshot_invalid/ },
    { path: ['events', '0'], blocker: /typed_blocker:component_guardian_event_invalid/ },
    {
      path: ['candidate_attempts', '0'],
      blocker: /typed_blocker:component_guardian_candidate_attempts_invalid/,
    },
    {
      path: ['proposal_bindings', '0'],
      blocker: /typed_blocker:component_guardian_proposal_bindings_invalid/,
    },
  ]
  for (const row of snapshotRows) {
    const candidate = structuredClone(snapshot)
    const target = row.path.length === 0 ? candidate : readPath(candidate, row.path)
    withAuthoritySymbol(target as object)
    assert.throws(() => ComponentEvolutionGuardian.rehydrate(candidate), row.blocker)
  }

  const command = guardian.prepareCommand({
    operation: 'rewind_component',
    target_snapshot_sha256: digest('snapshot-baseline'),
    reconfiguration_plan_sha256: digest('reconfiguration-plan'),
    external_state_rollback_receipt_sha256: null,
    requested_at: '2030-01-01T00:00:03Z',
  })
  assert.throws(() => validateComponentGuardianCommand(
    withAuthoritySymbol(structuredClone(command)),
  ), /typed_blocker:component_guardian_command_invalid/)

  const snapshotReads = { count: 0 }
  const proxiedSnapshot = new Proxy(snapshot, {
    get(target, property, receiver) {
      snapshotReads.count += 1
      return Reflect.get(target, property, receiver)
    },
  })
  assert.throws(() => ComponentEvolutionGuardian.rehydrate(proxiedSnapshot),
    /typed_blocker:component_guardian_snapshot_invalid/)
  assert.equal(snapshotReads.count, 0)

  const commandReads = { count: 0 }
  const proxiedCommand = new Proxy(command, {
    get(target, property, receiver) {
      commandReads.count += 1
      return Reflect.get(target, property, receiver)
    },
  })
  assert.throws(() => validateComponentGuardianCommand(proxiedCommand),
    /typed_blocker:component_guardian_command_invalid/)
  assert.equal(commandReads.count, 0)
})

test('snapshot and command tampering fail deterministic readback', () => {
  const guardian = proposedGuardian()
  guardian.append(event('activation_rolled_back', 2))
  const snapshot = guardian.snapshot()
  const forgedSnapshot = structuredClone(snapshot)
  forgedSnapshot.events[1]!.previous_event_sha256 = digest('forged-previous')
  assert.throws(() => ComponentEvolutionGuardian.rehydrate(forgedSnapshot),
    /typed_blocker:component_guardian_snapshot_mismatch/)
  const forgedBinding = structuredClone(snapshot)
  forgedBinding.proposal_bindings[0]!.mutation_proposal_sha256 = digest('forged-proposal')
  forgedBinding.snapshot_sha256 = componentCanonicalSha256({
    ...forgedBinding,
    snapshot_sha256: '0'.repeat(64),
  })
  assert.throws(() => ComponentEvolutionGuardian.rehydrate(forgedBinding),
    /typed_blocker:component_guardian_snapshot_mismatch/)
  const arrayProperty = structuredClone(snapshot)
  Object.defineProperty(arrayProperty.events, 'apply_authorized', {
    value: true,
    enumerable: true,
  })
  assert.throws(() => ComponentEvolutionGuardian.rehydrate(arrayProperty),
    /typed_blocker:component_guardian_events_invalid/)
  const nestedArrayProperty = structuredClone(snapshot)
  Object.defineProperty(nestedArrayProperty.events[0]!.non_claims, 'deployment_authorized', {
    value: true,
    enumerable: false,
  })
  assert.throws(() => ComponentEvolutionGuardian.rehydrate(nestedArrayProperty),
    /typed_blocker:component_guardian_event_non_claims_invalid/)

  const command = guardian.prepareCommand({
    operation: 'rewind_component',
    target_snapshot_sha256: digest('snapshot-baseline'),
    reconfiguration_plan_sha256: digest('reconfiguration-plan'),
    external_state_rollback_receipt_sha256: null,
    requested_at: '2030-01-01T00:00:03Z',
  })
  const forgedCommand = { ...command, apply_authorized: true } as unknown as typeof command
  assert.throws(() => validateComponentGuardianCommand(forgedCommand),
    /typed_blocker:component_guardian_command_invalid/)
  const arraySmuggledCommand = structuredClone(command)
  Object.defineProperty(arraySmuggledCommand.blockers, 'apply_authorized', {
    value: true,
    enumerable: true,
  })
  assert.equal(arraySmuggledCommand.command_sha256, command.command_sha256)
  assert.throws(() => validateComponentGuardianCommand(arraySmuggledCommand),
    /typed_blocker:component_guardian_command_blockers_invalid/)
  const forgedIdentity = {
    ...command,
    command_id: 'component-guardian-forged',
    command_sha256: '0'.repeat(64),
  }
  forgedIdentity.command_sha256 = componentCanonicalSha256(forgedIdentity)
  assert.throws(() => validateComponentGuardianCommand(forgedIdentity),
    /typed_blocker:component_guardian_command_invalid/)
  const scalarAlias = {
    ...command,
    guardian_id: 7,
    command_sha256: '0'.repeat(64),
  } as unknown as typeof command
  scalarAlias.command_sha256 = componentCanonicalSha256(scalarAlias)
  assert.throws(() => validateComponentGuardianCommand(scalarAlias),
    /typed_blocker:component_guardian_command_invalid/)
  const overBudget = {
    ...command,
    history_event_count: 4097,
  }
  const {
    command_id: _overBudgetCommandId,
    command_sha256: _overBudgetCommandSha256,
    ...overBudgetIdentity
  } = overBudget
  overBudget.command_id = `component-guardian-${componentCanonicalSha256(overBudgetIdentity).slice(0, 24)}`
  overBudget.command_sha256 = '0'.repeat(64)
  overBudget.command_sha256 = componentCanonicalSha256(overBudget)
  assert.throws(() => validateComponentGuardianCommand(overBudget),
    /typed_blocker:component_guardian_command_invalid/)
})

test('restart outcome is a new fact and cannot erase prior failed attempts', () => {
  const guardian = proposedGuardian()
  guardian.append(event('activation_contaminated', 2))
  guardian.append(event('restart_observed', 3))
  const snapshot = guardian.snapshot()
  assert.deepEqual(snapshot.events.map(row => row.kind), [
    'baseline_registered',
    'mutation_proposed',
    'activation_contaminated',
    'restart_observed',
  ])
  assert.equal(snapshot.events[3]!.history_rewrite_authorized, false)
  assert.equal(snapshot.events[3]!.deployment_authorized, false)
})

test('public guardian JSON validation closes every persisted object', () => {
  const schema = JSON.parse(readFileSync(new URL(
    '../../../../contracts/mykrobial/component-guardian-runtime.v1.schema.json',
    import.meta.url,
  ), 'utf8')) as {
    $defs: Record<string, { additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown> }>
    oneOf: Array<{ $ref: string }>
  }
  for (const definition of ['event', 'candidateAttempt', 'proposalBinding', 'snapshot', 'command']) {
    assert.equal(schema.$defs[definition]!.additionalProperties, false)
  }
  assert.deepEqual(schema.oneOf.map(row => row.$ref), [
    '#/$defs/event',
    '#/$defs/snapshot',
    '#/$defs/command',
  ])
  for (const definition of ['event', 'snapshot', 'command']) {
    const row = schema.$defs[definition]!
    assert.deepEqual([...row.required!].sort(), Object.keys(row.properties!).sort())
  }
})
