import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  ComponentLifecycleController,
  type ComponentDefinition,
  type ComponentInstaller,
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
