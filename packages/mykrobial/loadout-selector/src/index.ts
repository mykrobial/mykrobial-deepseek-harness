/** Deterministic minimum-sufficient dynamic loadout planning. */
import { createHash } from 'node:crypto'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/

export type CostClass = 'zero' | 'low' | 'medium' | 'high' | 'extreme'
export type ScientificPosture =
  | 'retrodict_default'
  | 'retrodict_simulator_escalated'
  | 'retrodict_novelty_escape'

export interface OrganDescriptor {
  organ_id: string
  logical_identity: string
  capabilities: string[]
  dependency_ids: string[]
  cost_class: CostClass
  source_state: 'verified' | 'candidate' | 'unavailable'
  reversible_lifecycle_tested: boolean
  activation_admission: 'admitted' | 'blocked' | 'not_requested'
}

export interface TaskDiagnosis {
  diagnosis_id: string
  task_class: 'software' | 'mathematical_proof' | 'research' | 'business_operations' | 'arc_like' | 'general'
  required_capabilities: string[]
  uncertainty: number
  maximum_cost_score: number
}

export interface LoadoutPolicy {
  policy_id: string
  base_organ_ids: string[]
  simulator_capabilities: string[]
  novelty_capabilities: string[]
}

export interface LoadoutSelection {
  schema: 'mykrobial.deepseek.dynamic-loadout-selection.v1'
  selection_id: string
  diagnosis_id: string
  harness_generation: 'next_deepseek_cordis'
  profile_id: string
  scientific_posture: ScientificPosture
  selected_organ_ids: string[]
  newly_selected_organ_ids: string[]
  covered_capabilities: string[]
  unresolved_capabilities: string[]
  rejected_organs: Record<string, string>
  estimated_cost_score: number
  maximum_cost_score: number
  activation_state: 'planned_unactivated' | 'blocked'
  manifest_sha256: string
  non_claims: string[]
}

const COST: Record<CostClass, number> = {
  zero: 0,
  low: 1,
  medium: 3,
  high: 8,
  extreme: 21,
}

function identifier(value: string, blocker: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`typed_blocker:${blocker}`)
  return value
}

function uniqueIdentifiers(values: readonly string[], blocker: string): string[] {
  if (!Array.isArray(values)) throw new Error(`typed_blocker:${blocker}`)
  const normalized = values.map(value => identifier(value, blocker)).sort()
  if (new Set(normalized).size !== normalized.length) throw new Error(`typed_blocker:${blocker}`)
  return normalized
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite canonical number')
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
  throw new Error(`unsupported canonical value ${typeof value}`)
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalize(value)), 'utf8').digest('hex')
}

function validateDiagnosis(diagnosis: TaskDiagnosis): void {
  identifier(diagnosis.diagnosis_id, 'loadout_diagnosis_identity_invalid')
  uniqueIdentifiers(diagnosis.required_capabilities, 'loadout_required_capabilities_invalid')
  if (!Number.isFinite(diagnosis.uncertainty) || diagnosis.uncertainty < 0 || diagnosis.uncertainty > 1) {
    throw new Error('typed_blocker:loadout_uncertainty_invalid')
  }
  if (!Number.isSafeInteger(diagnosis.maximum_cost_score) || diagnosis.maximum_cost_score < 0) {
    throw new Error('typed_blocker:loadout_cost_budget_invalid')
  }
}

function eligible(organ: OrganDescriptor): string | null {
  if (organ.source_state !== 'verified') return 'typed_blocker:loadout_organ_source_unverified'
  if (!organ.reversible_lifecycle_tested) return 'typed_blocker:loadout_organ_lifecycle_unverified'
  if (organ.activation_admission !== 'admitted') return 'typed_blocker:loadout_organ_activation_unadmitted'
  return null
}

interface Catalog {
  byId: Map<string, OrganDescriptor>
  rejected: Record<string, string>
}

function catalogOf(organs: readonly OrganDescriptor[]): Catalog {
  const byId = new Map<string, OrganDescriptor>()
  const rejected: Record<string, string> = {}
  for (const raw of organs) {
    const organ = structuredClone(raw)
    identifier(organ.organ_id, 'loadout_organ_identity_invalid')
    identifier(organ.logical_identity, 'loadout_organ_logical_identity_invalid')
    organ.capabilities = uniqueIdentifiers(organ.capabilities, 'loadout_organ_capabilities_invalid')
    organ.dependency_ids = uniqueIdentifiers(organ.dependency_ids, 'loadout_organ_dependencies_invalid')
    if (byId.has(organ.organ_id)) throw new Error('typed_blocker:loadout_organ_identity_duplicate')
    if (!(organ.cost_class in COST)) throw new Error('typed_blocker:loadout_organ_cost_invalid')
    byId.set(organ.organ_id, organ)
    const reason = eligible(organ)
    if (reason !== null) rejected[organ.organ_id] = reason
  }
  for (const organ of byId.values()) {
    for (const dependency of organ.dependency_ids) {
      if (!byId.has(dependency)) rejected[organ.organ_id] = 'typed_blocker:loadout_organ_dependency_missing'
    }
  }
  return { byId, rejected }
}

function dependencyClosure(
  organId: string,
  catalog: Catalog,
  visiting = new Set<string>(),
): string[] | null {
  const organ = catalog.byId.get(organId)
  if (organ === undefined || catalog.rejected[organId] !== undefined || visiting.has(organId)) return null
  const nextVisiting = new Set(visiting).add(organId)
  const closure = new Set<string>([organId])
  for (const dependency of organ.dependency_ids) {
    const nested = dependencyClosure(dependency, catalog, nextVisiting)
    if (nested === null) return null
    for (const id of nested) closure.add(id)
  }
  return [...closure].sort()
}

function incrementalCost(ids: readonly string[], selected: ReadonlySet<string>, catalog: Catalog): number {
  return ids.reduce((total, id) => total + (selected.has(id) ? 0 : COST[catalog.byId.get(id)!.cost_class]), 0)
}

function chooseCapability(
  capability: string,
  selected: ReadonlySet<string>,
  catalog: Catalog,
): string[] | null {
  const candidates: Array<{ ids: string[]; score: number; organId: string }> = []
  for (const organ of catalog.byId.values()) {
    if (!organ.capabilities.includes(capability)) continue
    const ids = dependencyClosure(organ.organ_id, catalog)
    if (ids === null) continue
    candidates.push({
      ids,
      score: incrementalCost(ids, selected, catalog),
      organId: organ.organ_id,
    })
  }
  candidates.sort((left, right) => left.score - right.score
    || left.ids.length - right.ids.length
    || left.organId.localeCompare(right.organId))
  return candidates[0]?.ids ?? null
}

export function planDynamicLoadout(input: {
  diagnosis: TaskDiagnosis
  posture: ScientificPosture
  policy: LoadoutPolicy
  organs: readonly OrganDescriptor[]
  current_organ_ids?: readonly string[]
}): LoadoutSelection {
  validateDiagnosis(input.diagnosis)
  identifier(input.policy.policy_id, 'loadout_policy_identity_invalid')
  const base = uniqueIdentifiers(input.policy.base_organ_ids, 'loadout_base_organs_invalid')
  const simulator = uniqueIdentifiers(input.policy.simulator_capabilities, 'loadout_simulator_capabilities_invalid')
  const novelty = uniqueIdentifiers(input.policy.novelty_capabilities, 'loadout_novelty_capabilities_invalid')
  const catalog = catalogOf(input.organs)
  const current = new Set(uniqueIdentifiers(input.current_organ_ids ?? [], 'loadout_current_organs_invalid'))
  const selected = new Set<string>()
  const unresolved = new Set<string>()

  for (const id of base) {
    const closure = dependencyClosure(id, catalog)
    if (closure === null) {
      unresolved.add(`organ:${id}`)
      continue
    }
    for (const member of closure) selected.add(member)
  }

  const required = new Set(uniqueIdentifiers(
    input.diagnosis.required_capabilities,
    'loadout_required_capabilities_invalid',
  ))
  if (input.posture !== 'retrodict_default') for (const capability of simulator) required.add(capability)
  if (input.posture === 'retrodict_novelty_escape') for (const capability of novelty) required.add(capability)

  for (const capability of [...required].sort()) {
    if ([...selected].some(id => catalog.byId.get(id)?.capabilities.includes(capability))) continue
    const closure = chooseCapability(capability, selected, catalog)
    if (closure === null) {
      unresolved.add(capability)
      continue
    }
    for (const id of closure) selected.add(id)
  }

  const selectedIds = [...selected].sort()
  const newlySelected = selectedIds.filter(id => !current.has(id))
  const cost = incrementalCost(selectedIds, current, catalog)
  if (cost > input.diagnosis.maximum_cost_score) unresolved.add('cost_budget')
  const covered = [...required].filter(capability => selectedIds.some(
    id => catalog.byId.get(id)?.capabilities.includes(capability),
  )).sort()
  const unresolvedIds = [...unresolved].sort()
  const state: LoadoutSelection['activation_state'] = unresolvedIds.length === 0
    ? 'planned_unactivated'
    : 'blocked'
  const body = {
    schema: 'mykrobial.deepseek.dynamic-loadout-selection.v1' as const,
    selection_id: `loadout-${hash({ diagnosis: input.diagnosis, posture: input.posture, selectedIds }).slice(0, 24)}`,
    diagnosis_id: input.diagnosis.diagnosis_id,
    harness_generation: 'next_deepseek_cordis' as const,
    profile_id: `mykrobial-${input.posture.replaceAll('_', '-')}`,
    scientific_posture: input.posture,
    selected_organ_ids: selectedIds,
    newly_selected_organ_ids: newlySelected,
    covered_capabilities: covered,
    unresolved_capabilities: unresolvedIds,
    rejected_organs: Object.fromEntries(Object.entries(catalog.rejected).sort()),
    estimated_cost_score: cost,
    maximum_cost_score: input.diagnosis.maximum_cost_score,
    activation_state: state,
    non_claims: [
      'not_component_activation',
      'not_model_or_tool_execution',
      'not_authority_grant',
      'not_deployment',
    ],
  }
  return { ...body, manifest_sha256: hash(body) }
}
