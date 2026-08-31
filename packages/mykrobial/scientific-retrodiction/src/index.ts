/** DeepSeek/CORDIS provider for the shared RetroDICT-first scientific loadout. */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z as zod, type ZodType } from 'zod'
import {
  buildCheckpoint,
  buildEvent,
  canonicalJson,
  requireIdentifier,
  requireSha256,
  verifyCheckpointHash,
  verifyEventChain,
} from './canonical.ts'
import {
  planActionResult,
  planCertification,
  planCommitActions,
  planDiscriminatingProbe,
  planHypothesis,
  planProbe,
  planReset,
} from './commands.ts'
import {
  applyScientificProjection,
  behaviorProjection,
  escalationState,
  initialScientificProjectionState,
  projectionIsConsistent,
  replayScientificEvents,
  startFromState,
} from './fold.ts'
import type {
  CertifyHypothesisRequest,
  CommitActionsRequest,
  ProposeHypothesisRequest,
  RecordActionResultRequest,
  RecordDiscriminatingProbeRequest,
  RecordProbeRequest,
  ScientificBehaviorProjection,
  ScientificCheckpoint,
  ScientificEventEnvelope,
  ScientificEventPayload,
  ScientificProjectionState,
  ScientificRunState,
  ScientificStart,
  StartScientificRunRequest,
} from './types.ts'
import { assertScientificRunState } from './validation.ts'

export * from './types.ts'
export {
  ScientificContractError,
  canonicalJson,
  verifyEventChain,
  verifyCheckpointHash,
} from './canonical.ts'
export { behaviorProjection, escalationState } from './fold.ts'
export { assertScientificRunState, scientificRunStateIsValid } from './validation.ts'
export {
  certifySimulator,
  searchCertifiedSimulator,
  type ScientificSimulator,
  type SimulatorSearchBudget,
  type SimulatorSearchResult,
} from './simulator.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scientificRetrodiction: ScientificRetrodictionService
  }
}

function isProjectionState(value: unknown): value is ScientificProjectionState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!Object.hasOwn(record, 'current') || !Object.hasOwn(record, 'events') || !Object.hasOwn(record, 'failure')) return false
  if (record.failure !== null && typeof record.failure !== 'string') return false
  if (!verifyEventChain(record.events)) return false
  if (record.current === null) return (record.events as unknown[]).length === 0
  if (typeof record.current !== 'object' || Array.isArray(record.current)) return false
  const current = record.current as Record<string, unknown>
  return current.schema === 'mykrobial.scientific-run.v1'
    && typeof current.run_id === 'string'
    && typeof current.task_ref === 'string'
    && (current.harness_generation === 'current_production' || current.harness_generation === 'next_deepseek_cordis')
    && current.loadout_id === 'scientific-retrodiction-v1'
    && Array.isArray(current.timeline)
    && typeof current.hypotheses === 'object'
    && typeof current.plans === 'object'
    && projectionIsConsistent(record as unknown as ScientificProjectionState)
}

const projectionStateSchema: ZodType<ScientificProjectionState> = zod.custom<ScientificProjectionState>(
  isProjectionState,
  { message: 'invalid scientific projection state' },
)
const behaviorProjectionSchema: ZodType<ScientificBehaviorProjection | null> = zod.custom<ScientificBehaviorProjection | null>(
  value => value === null || (
    typeof value === 'object'
    && value !== null
    && (value as Record<string, unknown>).schema === 'mykrobial.scientific-behavior-projection.v1'
  ),
  { message: 'invalid scientific behavior projection' },
)

export const scientificProjectionDefinition = {
  key: 'mykrobialScientific',
  stateSchema: projectionStateSchema,
  init: initialScientificProjectionState,
  apply: applyScientificProjection,
  wire: {
    viewSchema: behaviorProjectionSchema,
    view: state => state.current === null || state.failure !== null
      ? null
      : behaviorProjection(state.current, state.events),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'mykrobialScientific', ScientificProjectionState>

export interface Config {
  maxRealActionsCap?: number
  maxSimulatorThreshold?: number
  maxNoveltyThreshold?: number
  maxResetThreshold?: number
}

interface ResolvedConfig {
  maxRealActionsCap: number
  maxSimulatorThreshold: number
  maxNoveltyThreshold: number
  maxResetThreshold: number
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function projection(ctx: Context, session: Session): ScientificProjectionState {
  const value = ctx.sessionProjections.stateOf(session, 'mykrobialScientific')
  if (value === undefined) throw new Error('scientific projection is not registered')
  if (value.failure !== null) throw new Error(value.failure)
  return value
}

function detached<T>(value: T): T {
  return structuredClone(value)
}

export class ScientificRetrodictionService extends Service {
  static inject = ['sessions', 'sessionProjections']

  static Config: z<Config> = z.object({
    maxRealActionsCap: z.number().default(1_000_000),
    maxSimulatorThreshold: z.number().default(1_000_000),
    maxNoveltyThreshold: z.number().default(1_000_000),
    maxResetThreshold: z.number().default(1_000),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'scientificRetrodiction')
    this.resolved = {
      maxRealActionsCap: positiveSafeInteger(config.maxRealActionsCap ?? 1_000_000, 'maxRealActionsCap'),
      maxSimulatorThreshold: positiveSafeInteger(
        config.maxSimulatorThreshold ?? 1_000_000,
        'maxSimulatorThreshold',
      ),
      maxNoveltyThreshold: positiveSafeInteger(
        config.maxNoveltyThreshold ?? 1_000_000,
        'maxNoveltyThreshold',
      ),
      maxResetThreshold: positiveSafeInteger(config.maxResetThreshold ?? 1_000, 'maxResetThreshold'),
    }
    ctx.sessionProjections.register(scientificProjectionDefinition)
  }

  start(session: Session, request: StartScientificRunRequest): ScientificRunState {
    const state = projection(this.ctx, session)
    if (state.current !== null) throw new Error('scientific run already started for this session')
    if (request.harness_generation !== 'current_production'
      && request.harness_generation !== 'next_deepseek_cordis') {
      throw new Error('harness_generation is not recognized')
    }
    const simulator = positiveSafeInteger(request.simulator_after_actions ?? 300, 'simulator_after_actions')
    const novelty = positiveSafeInteger(request.novelty_after_actions ?? 600, 'novelty_after_actions')
    const resets = positiveSafeInteger(request.simulator_after_resets ?? 2, 'simulator_after_resets')
    const maxActions = positiveSafeInteger(request.max_real_actions, 'max_real_actions')
    if (maxActions > this.resolved.maxRealActionsCap
      || simulator > this.resolved.maxSimulatorThreshold
      || novelty > this.resolved.maxNoveltyThreshold
      || resets > this.resolved.maxResetThreshold
      || novelty <= simulator) throw new Error('scientific run exceeds configured budget policy')
    const start: ScientificStart = {
      schema: 'mykrobial.scientific-run-start.v1',
      run_id: requireIdentifier(request.run_id, 'typed_blocker:scientific_run_identity_invalid'),
      task_ref: requireIdentifier(request.task_ref, 'typed_blocker:scientific_task_ref_invalid'),
      harness_generation: request.harness_generation,
      loadout_id: 'scientific-retrodiction-v1',
      initial_observation_sha256: requireSha256(
        request.initial_observation_sha256,
        'typed_blocker:scientific_observation_digest_invalid',
      ),
      max_real_actions: maxActions,
      escalation_policy: {
        simulator_after_actions: simulator,
        novelty_after_actions: novelty,
        simulator_after_resets: resets,
      },
    }
    session.append('mykrobial/scientific/start', start)
    return this.snapshot(session)
  }

  private append(session: Session, payload: ScientificEventPayload): ScientificEventEnvelope {
    const projected = projection(this.ctx, session)
    if (projected.current === null) throw new Error('scientific run has not started')
    const envelope = buildEvent(projected.current, projected.events, payload)
    session.append('mykrobial/scientific/event', envelope)
    return detached(envelope)
  }

  recordProbe(session: Session, request: RecordProbeRequest): ScientificEventEnvelope {
    return this.append(session, planProbe(this.requireRun(session), request))
  }

  recordDiscriminatingProbe(
    session: Session,
    request: RecordDiscriminatingProbeRequest,
  ): ScientificEventEnvelope {
    return this.append(session, planDiscriminatingProbe(this.requireRun(session), request))
  }

  recordReset(session: Session, observedObservationSha256: string): ScientificEventEnvelope {
    return this.append(session, planReset(this.requireRun(session), observedObservationSha256))
  }

  proposeHypothesis(session: Session, request: ProposeHypothesisRequest): ScientificEventEnvelope {
    return this.append(session, planHypothesis(this.requireRun(session), request))
  }

  certifyHypothesis(session: Session, request: CertifyHypothesisRequest): ScientificEventEnvelope {
    return this.append(session, planCertification(this.requireRun(session), request))
  }

  commitActions(session: Session, request: CommitActionsRequest): ScientificEventEnvelope {
    return this.append(session, planCommitActions(this.requireRun(session), request))
  }

  recordActionResult(session: Session, request: RecordActionResultRequest): ScientificEventEnvelope {
    return this.append(session, planActionResult(this.requireRun(session), request))
  }

  snapshot(session: Session): ScientificRunState {
    return detached(this.requireRun(session))
  }

  events(session: Session): ScientificEventEnvelope[] {
    return detached(projection(this.ctx, session).events)
  }

  behaviorProjection(session: Session): ScientificBehaviorProjection {
    const state = projection(this.ctx, session)
    if (state.current === null) throw new Error('scientific run has not started')
    return behaviorProjection(state.current, state.events)
  }

  escalationState(session: Session): ReturnType<typeof escalationState> {
    return escalationState(this.requireRun(session))
  }

  exportCheckpoint(session: Session): ScientificCheckpoint {
    const projected = projection(this.ctx, session)
    if (projected.current === null) throw new Error('scientific run has not started')
    return buildCheckpoint(projected.current, projected.events)
  }

  restoreCheckpoint(session: Session, checkpoint: ScientificCheckpoint): ScientificRunState {
    const current = projection(this.ctx, session)
    if (current.current !== null || current.events.length !== 0) {
      throw new Error('checkpoint restore requires an empty scientific projection')
    }
    if (!verifyCheckpointHash(checkpoint) || !verifyEventChain(checkpoint.events)) {
      throw new Error('typed_blocker:scientific_checkpoint_invalid')
    }
    const state = checkpoint.state
    assertScientificRunState(state)
    if (state.max_real_actions > this.resolved.maxRealActionsCap
      || state.escalation_policy.simulator_after_actions > this.resolved.maxSimulatorThreshold
      || state.escalation_policy.novelty_after_actions > this.resolved.maxNoveltyThreshold
      || state.escalation_policy.simulator_after_resets > this.resolved.maxResetThreshold
      || state.escalation_policy.novelty_after_actions <= state.escalation_policy.simulator_after_actions) {
      throw new Error('typed_blocker:scientific_checkpoint_budget_policy_invalid')
    }
    const start = startFromState(state)
    const replayed = replayScientificEvents(start, checkpoint.events)
    assertScientificRunState(replayed)
    if (canonicalJson(replayed) !== canonicalJson(state)) {
      throw new Error('typed_blocker:scientific_checkpoint_replay_mismatch')
    }
    session.append('mykrobial/scientific/start', start)
    for (const event of checkpoint.events) session.append('mykrobial/scientific/event', detached(event))
    const restored = projection(this.ctx, session)
    if (!projectionIsConsistent(restored) || restored.current === null
      || canonicalJson(restored.current) !== canonicalJson(state)) {
      throw new Error('typed_blocker:scientific_checkpoint_replay_mismatch')
    }
    return detached(restored.current)
  }

  private requireRun(session: Session): ScientificRunState {
    const state = projection(this.ctx, session).current
    if (state === null) throw new Error('scientific run has not started')
    return state
  }
}

export default ScientificRetrodictionService
