/** Model-free CORDIS-shaped reversible component lifecycle reference. */
import { createHash } from 'node:crypto'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const SHA = /^[0-9a-f]{64}$/

export interface ComponentDefinition {
  component_id: string
  logical_identity: string
  source_sha256: string
  configuration_sha256: string
  dependency_ids: string[]
}

export type ComponentLifecycleState =
  | 'registered'
  | 'pending_dependencies'
  | 'active'
  | 'unloading'
  | 'inactive'
  | 'failed'
  | 'disposed'

export interface ComponentLifecycleEvent {
  schema: 'mykrobial.component-lifecycle-event.v1'
  sequence: number
  generation: number
  component_id: string
  kind: 'registered' | 'pending' | 'activated' | 'unloading' | 'inactive' | 'failed' | 'rollback' | 'disposed'
  reason: string
  definition_sha256: string
}

export interface ComponentSnapshot {
  schema: 'mykrobial.component-snapshot.v1'
  definition: ComponentDefinition
  state: ComponentLifecycleState
  generation: number
  available_dependency_ids: string[]
  active_effect_labels: string[]
  events: ComponentLifecycleEvent[]
}

export interface EffectRegistrar {
  effect(label: string, disposer: () => void): void
}

export type ComponentInstaller = (definition: ComponentDefinition, effects: EffectRegistrar) => void

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => (
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
    )).join(',')}}`
  }
  throw new Error('unsupported canonical value')
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}

function uniqueIds(values: readonly string[]): string[] {
  const result = [...values].sort()
  if (result.some(value => !ID.test(value)) || new Set(result).size !== result.length) {
    throw new Error('typed_blocker:component_dependency_identity_invalid')
  }
  return result
}

function validateDefinition(source: ComponentDefinition): ComponentDefinition {
  const value = structuredClone(source)
  if (!ID.test(value.component_id) || !ID.test(value.logical_identity)) {
    throw new Error('typed_blocker:component_identity_invalid')
  }
  if (!SHA.test(value.source_sha256) || !SHA.test(value.configuration_sha256)) {
    throw new Error('typed_blocker:component_source_or_configuration_invalid')
  }
  value.dependency_ids = uniqueIds(value.dependency_ids)
  return value
}

export class ComponentLifecycleController {
  private definition: ComponentDefinition
  private state: ComponentLifecycleState = 'registered'
  private generation = 0
  private readonly events: ComponentLifecycleEvent[] = []
  private available = new Set<string>()
  private effects: Array<{ label: string; dispose: () => void }> = []
  private installer: ComponentInstaller | null = null

  constructor(definition: ComponentDefinition) {
    this.definition = validateDefinition(definition)
    this.record('registered', 'component_registered')
  }

  reconcile(availableDependencyIds: readonly string[], installer: ComponentInstaller): ComponentSnapshot {
    this.assertNotDisposed()
    this.available = new Set(uniqueIds(availableDependencyIds))
    this.installer = installer
    const missing = this.definition.dependency_ids.filter(id => !this.available.has(id))
    if (missing.length > 0) {
      if (this.state === 'active') this.deactivate(`dependencies_lost:${missing.join(',')}`)
      this.state = 'pending_dependencies'
      this.record('pending', `dependencies_missing:${missing.join(',')}`)
      return this.snapshot()
    }
    if (this.state !== 'active') this.activate('dependencies_satisfied')
    return this.snapshot()
  }

  replace(nextDefinition: ComponentDefinition, installer: ComponentInstaller): ComponentSnapshot {
    this.assertNotDisposed()
    const previousDefinition = structuredClone(this.definition)
    const previousInstaller = this.installer
    if (this.state === 'active') this.deactivate('replacement_requested')
    this.definition = validateDefinition(nextDefinition)
    this.generation += 1
    this.installer = installer
    try {
      const missing = this.definition.dependency_ids.filter(id => !this.available.has(id))
      if (missing.length > 0) {
        this.state = 'pending_dependencies'
        this.record('pending', `replacement_dependencies_missing:${missing.join(',')}`)
        return this.snapshot()
      }
      this.activate('replacement_dependencies_satisfied')
      return this.snapshot()
    } catch (error: unknown) {
      this.definition = previousDefinition
      this.installer = previousInstaller
      this.generation += 1
      this.record('rollback', 'replacement_activation_failed')
      if (previousInstaller !== null) this.activate('rollback_previous_generation')
      throw error
    }
  }

  restart(): ComponentSnapshot {
    this.assertNotDisposed()
    if (this.installer === null) throw new Error('typed_blocker:component_installer_unavailable')
    if (this.state === 'active') this.deactivate('restart_requested')
    this.generation += 1
    return this.reconcile([...this.available], this.installer)
  }

  dispose(): ComponentSnapshot {
    if (this.state === 'disposed') return this.snapshot()
    if (this.state === 'active') this.deactivate('component_disposed')
    this.state = 'disposed'
    this.record('disposed', 'component_disposed')
    return this.snapshot()
  }

  snapshot(): ComponentSnapshot {
    return {
      schema: 'mykrobial.component-snapshot.v1',
      definition: structuredClone(this.definition),
      state: this.state,
      generation: this.generation,
      available_dependency_ids: [...this.available].sort(),
      active_effect_labels: this.effects.map(effect => effect.label),
      events: structuredClone(this.events),
    }
  }

  private activate(reason: string): void {
    if (this.installer === null) throw new Error('typed_blocker:component_installer_unavailable')
    const installed: Array<{ label: string; dispose: () => void }> = []
    try {
      this.installer(this.definition, {
        effect(label, disposer) {
          if (!ID.test(label) || typeof disposer !== 'function') {
            throw new Error('typed_blocker:component_effect_invalid')
          }
          installed.push({ label, dispose: disposer })
        },
      })
      this.effects = installed
      this.state = 'active'
      this.record('activated', reason)
    } catch (error: unknown) {
      for (const effect of installed.reverse()) {
        try {
          effect.dispose()
        } catch {
          // Preserve the activation failure; cleanup failure remains evidenced by failed state.
        }
      }
      this.effects = []
      this.state = 'failed'
      this.record('failed', 'activation_failed_and_rolled_back')
      throw error
    }
  }

  private deactivate(reason: string): void {
    this.state = 'unloading'
    this.record('unloading', reason)
    let cleanupFailed = false
    for (const effect of [...this.effects].reverse()) {
      try {
        effect.dispose()
      } catch {
        cleanupFailed = true
      }
    }
    this.effects = []
    this.state = cleanupFailed ? 'failed' : 'inactive'
    this.record(cleanupFailed ? 'failed' : 'inactive', cleanupFailed ? 'cleanup_failed' : reason)
    if (cleanupFailed) throw new Error('typed_blocker:component_cleanup_failed')
  }

  private record(kind: ComponentLifecycleEvent['kind'], reason: string): void {
    this.events.push({
      schema: 'mykrobial.component-lifecycle-event.v1',
      sequence: this.events.length,
      generation: this.generation,
      component_id: this.definition.component_id,
      kind,
      reason,
      definition_sha256: hash(this.definition),
    })
  }

  private assertNotDisposed(): void {
    if (this.state === 'disposed') throw new Error('typed_blocker:component_disposed')
  }
}
