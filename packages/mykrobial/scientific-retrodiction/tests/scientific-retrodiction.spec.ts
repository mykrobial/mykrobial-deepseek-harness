import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ScientificRetrodictionService, {
  canonicalJson,
  type Config,
  verifyCheckpointHash,
  verifyEventChain,
} from '../src/index.ts'

function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

async function harness(config: Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(ScientificRetrodictionService, config)
  const session = ctx.sessions.create(SessionId(`scientific-${Math.random()}`))
  return { ctx, fiber, session }
}

function startRequest(generation: 'current_production' | 'next_deepseek_cordis' = 'next_deepseek_cordis') {
  return {
    run_id: 'run-one',
    task_ref: 'task-one',
    harness_generation: generation,
    initial_observation_sha256: digest('observation-zero'),
    max_real_actions: 20,
    simulator_after_actions: 3,
    novelty_after_actions: 6,
    simulator_after_resets: 2,
  } as const
}

async function started() {
  const result = await harness()
  result.ctx.scientificRetrodiction.start(result.session, startRequest())
  return result
}

function propose(ctx: Context, session: Awaited<ReturnType<typeof harness>>['session'], kind: 'textual_hypothesis' | 'executable_simulator' = 'textual_hypothesis') {
  ctx.scientificRetrodiction.proposeHypothesis(session, {
    hypothesis_id: `hypothesis-${Object.keys(ctx.scientificRetrodiction.snapshot(session).hypotheses).length + 1}`,
    state_schema_sha256: digest(`state-${kind}`),
    mechanism_sha256: digest(`mechanism-${kind}`),
    goal_predicate_sha256: digest(`goal-${kind}`),
    mechanism_kind: kind,
  })
}

function certifyFirst(ctx: Context, session: Awaited<ReturnType<typeof harness>>['session']) {
  const state = ctx.scientificRetrodiction.snapshot(session)
  const id = Object.keys(state.hypotheses)[0]
  ctx.scientificRetrodiction.certifyHypothesis(session, {
    hypothesis_id: id,
    retrodictions: state.timeline.map(transition => ({
      transition_index: transition.transition_index,
      predicted_observation_sha256: transition.observed_observation_sha256,
    })),
  })
  return id
}

describe('ScientificRetrodictionService lifecycle', () => {
  it('does not activate without both required DeepSeek services', async () => {
    const ctx = new Context()
    await ctx.plugin(ScientificRetrodictionService)
    expect(ctx.get('scientificRetrodiction')).toBeUndefined()
  })

  it('registers one service and projection, then removes both on unload', async () => {
    const { ctx, fiber, session } = await started()
    expect(ctx.scientificRetrodiction.snapshot(session).run_id).toBe('run-one')
    expect(ctx.sessionProjections.stateOf(session, 'mykrobialScientific')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('scientificRetrodiction')).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(session, 'mykrobialScientific')).toBeUndefined()
  })

  it('records run initialization durably but excludes it from behavior events', async () => {
    const { ctx, session } = await started()
    expect(session.events.map(event => event.type)).toEqual(['mykrobial/scientific/start'])
    const behavior = ctx.scientificRetrodiction.behaviorProjection(session)
    expect(behavior.state.task_ref).toBe('task-one')
    expect(behavior.events).toEqual([])
  })
})

describe('RetroDICT-first scientific behavior', () => {
  it('certifies complete history before committing prediction-bearing actions', async () => {
    const { ctx, session } = await started()
    ctx.scientificRetrodiction.recordProbe(session, {
      action_sha256: digest('probe-action'),
      observed_observation_sha256: digest('observation-one'),
      purpose: 'distinguish movement from repainting',
    })
    propose(ctx, session)
    const hypothesisId = certifyFirst(ctx, session)
    const committed = ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: hypothesisId,
      actions: [
        { action_sha256: digest('action-one'), expected_observation_sha256: digest('observation-two') },
        { action_sha256: digest('action-two'), expected_observation_sha256: digest('observation-three') },
      ],
    })
    expect(committed.kind).toBe('actions_committed')
    expect(ctx.scientificRetrodiction.snapshot(session).plans['plan-1']!.state).toBe('active')
  })

  it('rejects incomplete, duplicated, or false complete-history certification', async () => {
    const { ctx, session } = await started()
    ctx.scientificRetrodiction.recordProbe(session, {
      action_sha256: digest('probe'),
      observed_observation_sha256: digest('observed'),
      purpose: 'learn one transition',
    })
    propose(ctx, session)
    expect(() => ctx.scientificRetrodiction.certifyHypothesis(session, {
      hypothesis_id: 'hypothesis-1',
      retrodictions: [],
    })).toThrow('typed_blocker:scientific_retrodiction_incomplete')
    expect(() => ctx.scientificRetrodiction.certifyHypothesis(session, {
      hypothesis_id: 'hypothesis-1',
      retrodictions: [{ transition_index: 0, predicted_observation_sha256: digest('wrong') }],
    })).toThrow('typed_blocker:scientific_retrodiction_mismatch')
  })

  it('rejects a stale certificate after any new real transition', async () => {
    const { ctx, session } = await started()
    propose(ctx, session)
    const hypothesisId = certifyFirst(ctx, session)
    ctx.scientificRetrodiction.recordProbe(session, {
      action_sha256: digest('new-action'),
      observed_observation_sha256: digest('new-observation'),
      purpose: 'new evidence after certification',
    })
    expect(() => ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: hypothesisId,
      actions: [{ action_sha256: digest('action'), expected_observation_sha256: digest('result') }],
    })).toThrow('typed_blocker:scientific_certificate_stale')
  })

  it('stops the plan at the first prediction mismatch and refuses retry', async () => {
    const { ctx, session } = await started()
    propose(ctx, session)
    const hypothesisId = certifyFirst(ctx, session)
    ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: hypothesisId,
      actions: [
        { action_sha256: digest('one'), expected_observation_sha256: digest('expected-one') },
        { action_sha256: digest('two'), expected_observation_sha256: digest('expected-two') },
      ],
    })
    const mismatch = ctx.scientificRetrodiction.recordActionResult(session, {
      plan_id: 'plan-1', action_index: 0, observed_observation_sha256: digest('surprise'),
    })
    expect(mismatch.kind).toBe('prediction_mismatch')
    expect(ctx.scientificRetrodiction.snapshot(session).plans['plan-1']).toMatchObject({
      state: 'invalidated_prediction_mismatch', next_action_index: 1,
    })
    expect(() => ctx.scientificRetrodiction.recordActionResult(session, {
      plan_id: 'plan-1', action_index: 1, observed_observation_sha256: digest('expected-two'),
    })).toThrow('typed_blocker:scientific_plan_not_executable')
  })

  it('marks a fully matched action queue complete', async () => {
    const { ctx, session } = await started()
    propose(ctx, session)
    const hypothesisId = certifyFirst(ctx, session)
    ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: hypothesisId,
      actions: [{ action_sha256: digest('one'), expected_observation_sha256: digest('expected') }],
    })
    const completed = ctx.scientificRetrodiction.recordActionResult(session, {
      plan_id: 'plan-1', action_index: 0, observed_observation_sha256: digest('expected'),
    })
    expect(completed.kind).toBe('plan_completed')
    expect(ctx.scientificRetrodiction.snapshot(session).plans['plan-1']!.state).toBe('completed')
  })

  it('requires a genuinely discriminating experiment over known hypotheses', async () => {
    const { ctx, session } = await started()
    propose(ctx, session)
    propose(ctx, session)
    expect(() => ctx.scientificRetrodiction.recordDiscriminatingProbe(session, {
      action_sha256: digest('probe'),
      predictions: { 'hypothesis-1': digest('same'), 'hypothesis-2': digest('same') },
      observed_observation_sha256: digest('same'),
    })).toThrow('typed_blocker:scientific_probe_not_discriminating')
    const probe = ctx.scientificRetrodiction.recordDiscriminatingProbe(session, {
      action_sha256: digest('probe'),
      predictions: { 'hypothesis-1': digest('a'), 'hypothesis-2': digest('b') },
      observed_observation_sha256: digest('b'),
    })
    expect(probe.kind).toBe('discriminating_probe_recorded')
    if (probe.kind !== 'discriminating_probe_recorded') throw new Error('expected discriminating probe')
    expect(probe.transition.supported_hypothesis_ids).toEqual(['hypothesis-2'])
    expect(probe.transition.falsified_hypothesis_ids).toEqual(['hypothesis-1'])
  })

  it('invalidates every active plan on reset', async () => {
    const { ctx, session } = await started()
    propose(ctx, session)
    const hypothesisId = certifyFirst(ctx, session)
    ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: hypothesisId,
      actions: [{ action_sha256: digest('one'), expected_observation_sha256: digest('expected') }],
    })
    const reset = ctx.scientificRetrodiction.recordReset(session, digest('after-reset'))
    expect(reset.kind).toBe('reset_recorded')
    expect(ctx.scientificRetrodiction.snapshot(session).plans['plan-1']!.state).toBe('invalidated_reset')
  })

  it('keeps cheap textual hypotheses before threshold and requires a simulator afterward', async () => {
    const { ctx, session } = await started()
    for (let index = 0; index < 3; index += 1) {
      ctx.scientificRetrodiction.recordProbe(session, {
        action_sha256: digest(`probe-${index}`),
        observed_observation_sha256: digest(`observation-${index}`),
        purpose: `bounded probe ${index}`,
      })
    }
    expect(ctx.scientificRetrodiction.escalationState(session)).toBe('build_verified_simulator')
    propose(ctx, session, 'textual_hypothesis')
    const textual = certifyFirst(ctx, session)
    expect(() => ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: textual,
      actions: [{ action_sha256: digest('blocked'), expected_observation_sha256: digest('blocked-result') }],
    })).toThrow('typed_blocker:scientific_simulator_required')
    propose(ctx, session, 'executable_simulator')
    const state = ctx.scientificRetrodiction.snapshot(session)
    ctx.scientificRetrodiction.certifyHypothesis(session, {
      hypothesis_id: 'hypothesis-2',
      retrodictions: state.timeline.map(row => ({
        transition_index: row.transition_index,
        predicted_observation_sha256: row.observed_observation_sha256,
      })),
    })
    expect(() => ctx.scientificRetrodiction.commitActions(session, {
      hypothesis_id: 'hypothesis-2',
      actions: [{ action_sha256: digest('allowed'), expected_observation_sha256: digest('allowed-result') }],
    })).not.toThrow()
  })

  it('enters novelty escape only at the later bound', async () => {
    const { ctx, session } = await started()
    for (let index = 0; index < 6; index += 1) {
      ctx.scientificRetrodiction.recordProbe(session, {
        action_sha256: digest(`novelty-probe-${index}`),
        observed_observation_sha256: digest(`novelty-observation-${index}`),
        purpose: `bounded novelty probe ${index}`,
      })
    }
    expect(ctx.scientificRetrodiction.escalationState(session)).toBe('novelty_escape')
  })

  it('enforces the real-action budget', async () => {
    const { ctx, session } = await harness()
    ctx.scientificRetrodiction.start(session, { ...startRequest(), max_real_actions: 1 })
    ctx.scientificRetrodiction.recordProbe(session, {
      action_sha256: digest('only-action'),
      observed_observation_sha256: digest('only-observation'),
      purpose: 'one admitted probe',
    })
    expect(() => ctx.scientificRetrodiction.recordReset(session, digest('denied-reset')))
      .toThrow('typed_blocker:scientific_action_budget_exhausted')
  })
})

describe('replay, checkpoint, and cross-generation parity', () => {
  it('exports and restores an exact checkpoint into a fresh DeepSeek session', async () => {
    const first = await started()
    first.ctx.scientificRetrodiction.recordProbe(first.session, {
      action_sha256: digest('probe'),
      observed_observation_sha256: digest('observed'),
      purpose: 'checkpoint probe',
    })
    propose(first.ctx, first.session)
    certifyFirst(first.ctx, first.session)
    const checkpoint = first.ctx.scientificRetrodiction.exportCheckpoint(first.session)
    expect(verifyCheckpointHash(checkpoint)).toBe(true)
    expect(verifyEventChain(checkpoint.events)).toBe(true)

    const second = await harness()
    second.ctx.scientificRetrodiction.restoreCheckpoint(second.session, checkpoint)
    expect(second.ctx.scientificRetrodiction.snapshot(second.session))
      .toEqual(first.ctx.scientificRetrodiction.snapshot(first.session))
    expect(second.ctx.scientificRetrodiction.behaviorProjection(second.session))
      .toEqual(first.ctx.scientificRetrodiction.behaviorProjection(first.session))
  })

  it('rejects tampered event chains and checkpoints', async () => {
    const { ctx, session } = await started()
    ctx.scientificRetrodiction.recordProbe(session, {
      action_sha256: digest('probe'),
      observed_observation_sha256: digest('observed'),
      purpose: 'tamper probe',
    })
    const checkpoint = ctx.scientificRetrodiction.exportCheckpoint(session)
    const tamperedEvent = structuredClone(checkpoint)
    tamperedEvent.events[0].previous_event_sha256 = digest('forged')
    expect(verifyEventChain(tamperedEvent.events)).toBe(false)
    const tamperedCheckpoint = structuredClone(checkpoint)
    tamperedCheckpoint.state.task_ref = 'forged-task'
    expect(verifyCheckpointHash(tamperedCheckpoint)).toBe(false)
  })

  it('projects equal behavior for the two harness generations', async () => {
    const runs = await Promise.all([
      harness(),
      harness(),
    ])
    runs[0].ctx.scientificRetrodiction.start(runs[0].session, startRequest('current_production'))
    runs[1].ctx.scientificRetrodiction.start(runs[1].session, startRequest('next_deepseek_cordis'))
    for (const run of runs) {
      run.ctx.scientificRetrodiction.recordProbe(run.session, {
        action_sha256: digest('shared-action'),
        observed_observation_sha256: digest('shared-observation'),
        purpose: 'shared parity transition',
      })
      propose(run.ctx, run.session)
      certifyFirst(run.ctx, run.session)
    }
    const current = runs[0].ctx.scientificRetrodiction.behaviorProjection(runs[0].session)
    const next = runs[1].ctx.scientificRetrodiction.behaviorProjection(runs[1].session)
    expect(canonicalJson(current)).toBe(canonicalJson(next))
  })
})
