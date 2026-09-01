import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  componentCanonicalSha256,
  ComponentLifecycleController,
  executeComponentActivationTransaction,
  type ComponentActivationPermit,
  type ComponentActivationPermitDecision,
  type ComponentActivationPermitExpectation,
  type ComponentActivationPermitVerifier,
  type ComponentDefinition,
  type ComponentInstaller,
  type ExecuteComponentActivationTransactionInput,
} from '../src/index.ts'

const digest = (label: string): string => createHash('sha256').update(label).digest('hex')

function definition(version: string, dependencies = ['session']): ComponentDefinition {
  return {
    component_id: 'scientific-component',
    logical_identity: 'scientific-retrodiction',
    source_sha256: digest(`source-${version}`),
    configuration_sha256: digest(`config-${version}`),
    dependency_ids: dependencies,
  }
}

class PermitVerifier implements ComponentActivationPermitVerifier {
  readonly identity_sha256 = digest('permit-verifier-identity')
  readonly source_sha256 = digest('permit-verifier-source')

  constructor(private readonly admitted = true) {}

  verify(
    permit: ComponentActivationPermit,
    expectation: ComponentActivationPermitExpectation,
  ): ComponentActivationPermitDecision {
    const decision: ComponentActivationPermitDecision = {
      schema: 'mykrobial.component-activation-permit-decision.v1',
      status: this.admitted ? 'admitted' : 'rejected',
      expectation_sha256: componentCanonicalSha256(expectation),
      permit_sha256: permit.permit_sha256,
      verifier_identity_sha256: this.identity_sha256,
      verifier_source_sha256: this.source_sha256,
      execution_authorized: this.admitted,
      decision_sha256: '0'.repeat(64),
    }
    decision.decision_sha256 = componentCanonicalSha256(decision)
    return decision
  }
}

function activationInput(
  controller: ComponentLifecycleController,
  overrides: Partial<ExecuteComponentActivationTransactionInput> = {},
): ExecuteComponentActivationTransactionInput {
  const before = controller.snapshot()
  const candidate = definition('two')
  const input = {
    transaction_id: 'transaction-component-two',
    plan_sha256: digest('reconfiguration-plan'),
    candidate_definition: candidate,
    candidate_installer: ((_definition, effects) => {
      effects.effect('candidate-effect', () => {})
    }) satisfies ComponentInstaller,
    rollback_installer: ((_definition, effects) => {
      effects.effect('prior-effect', () => {})
    }) satisfies ComponentInstaller,
    permit: {} as ComponentActivationPermit,
    permit_verifier: new PermitVerifier(),
    prediction_rehearsal_receipt_sha256: digest('prediction-rehearsal'),
    replay_receipt_sha256: digest('replay-receipt'),
    rollback_contract_sha256: digest('rollback-contract'),
    external_effect_boundary_sha256: digest('external-effect-boundary'),
    observed_at: '2030-01-01T00:00:00Z',
    health_check_ids: ['behavior-projection', 'effect-balance'],
    health_observation_count: 2,
    observe_health: () => ({ 'behavior-projection': true, 'effect-balance': true }),
    ...overrides,
  } satisfies ExecuteComponentActivationTransactionInput
  const expectation: ComponentActivationPermitExpectation = {
    transaction_id: input.transaction_id,
    plan_sha256: input.plan_sha256,
    target_component_id: before.definition.component_id,
    before_snapshot_sha256: componentCanonicalSha256(before),
    candidate_definition_sha256: componentCanonicalSha256(candidate),
    prediction_rehearsal_receipt_sha256: input.prediction_rehearsal_receipt_sha256,
    replay_receipt_sha256: input.replay_receipt_sha256,
    rollback_contract_sha256: input.rollback_contract_sha256,
    external_effect_boundary_sha256: input.external_effect_boundary_sha256,
    expires_at: '2030-01-01T01:00:00Z',
  }
  const permit: ComponentActivationPermit = {
    schema: 'mykrobial.component-activation-permit.v1',
    ...expectation,
    permit_sha256: '0'.repeat(64),
  }
  permit.permit_sha256 = componentCanonicalSha256(permit)
  input.permit = permit
  return input
}

test('effects dispose in exact reverse registration order', () => {
  const log: string[] = []
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], (_definition, effects) => {
    effects.effect('first', () => { log.push('first') })
    effects.effect('second', () => { log.push('second') })
    effects.effect('third', () => { log.push('third') })
  })
  assert.equal(controller.snapshot().state, 'active')
  controller.dispose()
  assert.deepEqual(log, ['third', 'second', 'first'])
  assert.deepEqual(controller.snapshot().active_effect_labels, [])
})

test('spatial dependency loss deactivates and return reactivates the component', () => {
  let mounts = 0
  let unmounts = 0
  const installer: ComponentInstaller = (_definition, effects) => {
    mounts += 1
    effects.effect('provider', () => { unmounts += 1 })
  }
  const controller = new ComponentLifecycleController(definition('one', ['session', 'projection']))
  assert.equal(controller.reconcile(['session'], installer).state, 'pending_dependencies')
  assert.equal(controller.reconcile(['session', 'projection'], installer).state, 'active')
  assert.equal(controller.reconcile(['session'], installer).state, 'pending_dependencies')
  assert.equal(unmounts, 1)
  assert.equal(controller.reconcile(['session', 'projection'], installer).state, 'active')
  assert.equal(mounts, 2)
})

test('failed activation cleans partial effects and records failure', () => {
  const cleanup: string[] = []
  const controller = new ComponentLifecycleController(definition('one'))
  assert.throws(() => controller.reconcile(['session'], (_definition, effects) => {
    effects.effect('partial', () => { cleanup.push('partial') })
    throw new Error('synthetic failure')
  }), /synthetic failure/)
  assert.deepEqual(cleanup, ['partial'])
  assert.equal(controller.snapshot().state, 'failed')
  assert.deepEqual(controller.snapshot().active_effect_labels, [])
})

test('failed replacement rolls back to the prior definition and remounts it', () => {
  const mounted: string[] = []
  const unmounted: string[] = []
  const stable: ComponentInstaller = (current, effects) => {
    mounted.push(current.source_sha256)
    effects.effect('stable', () => { unmounted.push(current.source_sha256) })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], stable)
  const prior = controller.snapshot().definition.source_sha256
  assert.throws(() => controller.replace(definition('two'), (_current, effects) => {
    effects.effect('new-partial', () => { unmounted.push('new-partial') })
    throw new Error('replacement failed')
  }), /replacement failed/)
  assert.equal(controller.snapshot().state, 'active')
  assert.equal(controller.snapshot().definition.source_sha256, prior)
  assert.equal(controller.snapshot().events.some(event => event.kind === 'rollback'), true)
  assert.equal(mounted.filter(value => value === prior).length, 2)
})

test('restart creates a new generation with no leaked effects', () => {
  let active = 0
  const installer: ComponentInstaller = (_definition, effects) => {
    active += 1
    effects.effect('one-effect', () => { active -= 1 })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], installer)
  assert.equal(active, 1)
  const restarted = controller.restart()
  assert.equal(restarted.generation, 1)
  assert.equal(restarted.state, 'active')
  assert.equal(active, 1)
})

test('dispose is idempotent and later reconciliation fails closed', () => {
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], (_definition, effects) => {
    effects.effect('effect', () => {})
  })
  const first = controller.dispose()
  const second = controller.dispose()
  assert.deepEqual(second, first)
  assert.throws(() => controller.reconcile(['session'], () => {}), /typed_blocker:component_disposed/)
})

test('admitted component activation commits only after the complete health horizon', () => {
  let active = 'none'
  const prior: ComponentInstaller = (_definition, effects) => {
    active = 'prior'
    effects.effect('prior-effect', () => { active = 'none' })
  }
  const candidate: ComponentInstaller = (_definition, effects) => {
    active = 'candidate'
    effects.effect('candidate-effect', () => { active = 'none' })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const receipt = executeComponentActivationTransaction(
    controller,
    activationInput(controller, {
      candidate_installer: candidate,
      rollback_installer: prior,
    }),
  )
  assert.equal(receipt.outcome, 'committed')
  assert.equal(receipt.blocker, null)
  assert.equal(receipt.planned_health_observation_count, 2)
  assert.equal(receipt.completed_health_observation_count, 2)
  assert.equal(receipt.health_observations.length, 4)
  assert.equal(receipt.health_observations.every(row => row.passed), true)
  assert.equal(receipt.component_effects_executed, true)
  assert.deepEqual(receipt.residual_effect_labels, [])
  assert.equal(receipt.environment_contamination_possible, false)
  assert.equal(receipt.promotion_authorized, false)
  assert.equal(receipt.trace_append_authorized, false)
  assert.equal(receipt.deployment_authorized, false)
  assert.equal(receipt.receipt_sha256, componentCanonicalSha256({
    ...receipt,
    receipt_sha256: '0'.repeat(64),
  }))
  assert.equal(active, 'candidate')
  assert.equal(controller.snapshot().definition.source_sha256, definition('two').source_sha256)
})

test('a failed component-local health observation rolls back the prior generation', () => {
  let active = 'none'
  const prior: ComponentInstaller = (_definition, effects) => {
    active = 'prior'
    effects.effect('prior-effect', () => { active = 'none' })
  }
  const candidate: ComponentInstaller = (_definition, effects) => {
    active = 'candidate'
    effects.effect('candidate-effect', () => { active = 'none' })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const receipt = executeComponentActivationTransaction(
    controller,
    activationInput(controller, {
      candidate_installer: candidate,
      rollback_installer: prior,
      observe_health: sequence => ({
        'behavior-projection': sequence === 0,
        'effect-balance': true,
      }),
    }),
  )
  assert.equal(receipt.outcome, 'rolled_back')
  assert.equal(receipt.blocker, 'typed_blocker:component_health_horizon_failed')
  assert.equal(receipt.planned_health_observation_count, 2)
  assert.equal(receipt.completed_health_observation_count, 2)
  assert.deepEqual(receipt.residual_effect_labels, [])
  assert.equal(receipt.environment_contamination_possible, false)
  assert.equal(receipt.health_observations.at(-2)?.passed, false)
  assert.equal(active, 'prior')
  assert.equal(controller.snapshot().definition.source_sha256, definition('one').source_sha256)
  assert.equal(controller.snapshot().events.some(event => event.kind === 'rollback'), true)
})

test('permit rejection occurs before component effects or lifecycle mutation', () => {
  let mounts = 0
  let unmounts = 0
  const prior: ComponentInstaller = (_definition, effects) => {
    mounts += 1
    effects.effect('prior-effect', () => { unmounts += 1 })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const before = controller.snapshot()
  assert.throws(
    () => executeComponentActivationTransaction(
      controller,
      activationInput(controller, { permit_verifier: new PermitVerifier(false) }),
    ),
    /typed_blocker:component_activation_permit_rejected/,
  )
  assert.equal(mounts, 1)
  assert.equal(unmounts, 0)
  assert.deepEqual(controller.snapshot(), before)
})

test('stale or open-shaped permits fail before component effects', () => {
  let mounts = 0
  let unmounts = 0
  const prior: ComponentInstaller = (_definition, effects) => {
    mounts += 1
    effects.effect('prior-effect', () => { unmounts += 1 })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const before = controller.snapshot()

  const stale = activationInput(controller)
  stale.permit.expires_at = '2029-12-31T23:59:59Z'
  stale.permit.permit_sha256 = '0'.repeat(64)
  stale.permit.permit_sha256 = componentCanonicalSha256(stale.permit)
  assert.throws(
    () => executeComponentActivationTransaction(controller, stale),
    /typed_blocker:component_activation_permit_stale/,
  )

  const open = activationInput(controller)
  open.permit = {
    ...open.permit,
    unexpected_authority: true,
  } as ComponentActivationPermit
  assert.throws(
    () => executeComponentActivationTransaction(controller, open),
    /typed_blocker:component_activation_permit_invalid/,
  )
  assert.equal(mounts, 1)
  assert.equal(unmounts, 0)
  assert.deepEqual(controller.snapshot(), before)
})

test('candidate activation failure returns a rollback receipt with the prior component active', () => {
  let active = 'none'
  const prior: ComponentInstaller = (_definition, effects) => {
    active = 'prior'
    effects.effect('prior-effect', () => { active = 'none' })
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const receipt = executeComponentActivationTransaction(
    controller,
    activationInput(controller, {
      candidate_installer: (_definition, effects) => {
        active = 'candidate-partial'
        effects.effect('candidate-partial', () => { active = 'none' })
        throw new Error('synthetic candidate activation failure')
      },
      rollback_installer: prior,
    }),
  )
  assert.equal(receipt.outcome, 'rolled_back')
  assert.equal(receipt.blocker, 'typed_blocker:component_candidate_activation_failed')
  assert.equal(receipt.candidate_snapshot_sha256, null)
  assert.deepEqual(receipt.residual_effect_labels, [])
  assert.equal(receipt.environment_contamination_possible, false)
  assert.equal(active, 'prior')
  assert.equal(controller.snapshot().definition.source_sha256, definition('one').source_sha256)
})

test('candidate cleanup failure stays failed and never remounts the prior component', () => {
  let priorMounts = 0
  let leakedCandidateEffect = false
  const prior: ComponentInstaller = (_definition, effects) => {
    priorMounts += 1
    effects.effect('prior-effect', () => {})
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const receipt = executeComponentActivationTransaction(
    controller,
    activationInput(controller, {
      candidate_installer: (_definition, effects) => {
        leakedCandidateEffect = true
        effects.effect('candidate-leaked-effect', () => {
          throw new Error('synthetic candidate disposer failure')
        })
        throw new Error('synthetic candidate activation failure')
      },
      rollback_installer: prior,
    }),
  )
  const final = controller.snapshot()
  assert.equal(receipt.outcome, 'rollback_failed')
  assert.equal(
    receipt.blocker,
    'typed_blocker:component_candidate_activation_cleanup_incomplete',
  )
  assert.deepEqual(receipt.residual_effect_labels, ['candidate-leaked-effect'])
  assert.equal(receipt.environment_contamination_possible, true)
  assert.equal(leakedCandidateEffect, true)
  assert.equal(priorMounts, 1)
  assert.equal(final.state, 'failed')
  assert.equal(final.definition.source_sha256, definition('two').source_sha256)
  assert.deepEqual(final.active_effect_labels, ['candidate-leaked-effect'])
})

test('health rollback cleanup failure exposes contamination and withholds prior remount', () => {
  let priorMounts = 0
  const prior: ComponentInstaller = (_definition, effects) => {
    priorMounts += 1
    effects.effect('prior-effect', () => {})
  }
  const controller = new ComponentLifecycleController(definition('one'))
  controller.reconcile(['session'], prior)
  const receipt = executeComponentActivationTransaction(
    controller,
    activationInput(controller, {
      candidate_installer: (_definition, effects) => {
        effects.effect('candidate-live-effect', () => {
          throw new Error('synthetic health-rollback disposer failure')
        })
      },
      rollback_installer: prior,
      observe_health: () => ({
        'behavior-projection': false,
        'effect-balance': true,
      }),
    }),
  )
  const final = controller.snapshot()
  assert.equal(receipt.outcome, 'rollback_failed')
  assert.equal(
    receipt.blocker,
    'typed_blocker:component_health_horizon_cleanup_incomplete',
  )
  assert.equal(receipt.environment_contamination_possible, true)
  assert.deepEqual(receipt.residual_effect_labels, ['candidate-live-effect'])
  assert.equal(priorMounts, 1)
  assert.equal(final.state, 'failed')
  assert.equal(final.definition.source_sha256, definition('two').source_sha256)
})
