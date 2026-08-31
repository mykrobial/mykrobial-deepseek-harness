/** One compact model-facing command surface for the RetroDICT-first loadout. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  canonicalJson,
  type ScientificEventEnvelope,
} from '@mykrobial/dsh-scientific-retrodiction'

export const name = 'tool-mykrobial-scientific-retrodiction'
export const inject = ['tools', 'scientificRetrodiction']

const OPERATIONS = [
  'start',
  'state',
  'probe',
  'discriminating_probe',
  'reset',
  'propose',
  'certify',
  'commit',
  'result',
  'checkpoint',
] as const

function requiredString(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`retrodict operation requires ${field}`)
  }
  return value
}

function requiredInteger(value: number | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 0) {
    throw new Error(`retrodict operation requires non-negative integer ${field}`)
  }
  return value as number
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'retrodict',
    description: [
      'Operate the durable RetroDICT scientific loop for this exact agent session.',
      'Start once, inspect state, record cheap probes, propose a theory, certify it against EVERY recorded transition,',
      'then commit expectation-bearing actions and report each result. Stop after the first mismatch.',
      'Use discriminating_probe only when at least two live hypotheses predict different outcomes; it spends a real action.',
      'Do not propose an executable simulator before the state reports simulator escalation, and never treat a digest as execution proof.',
      'checkpoint returns a portable content-addressed replay candidate; it is not a runtime or deployment receipt.',
    ].join(' '),
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: [...OPERATIONS],
        description: 'The single scientific-loop operation to perform.',
      },
      run_id: { type: 'string', description: 'Stable run id; start only.' },
      task_ref: { type: 'string', description: 'Stable task reference; start only.' },
      initial_observation_sha256: { type: 'string', description: 'Initial observation digest; start only.' },
      max_real_actions: { type: 'integer', description: 'Hard live-action cap; start only.' },
      simulator_after_actions: { type: 'integer', description: 'Escalation threshold; start only.' },
      novelty_after_actions: { type: 'integer', description: 'Later novelty threshold; start only.' },
      simulator_after_resets: { type: 'integer', description: 'Reset escalation threshold; start only.' },
      action_sha256: { type: 'string', description: 'Action digest for probe.' },
      observed_observation_sha256: { type: 'string', description: 'Observed post-action digest.' },
      purpose: { type: 'string', description: 'Why a probe is worth its live-action cost.' },
      hypothesis_id: { type: 'string', description: 'Hypothesis identity.' },
      state_schema_sha256: { type: 'string', description: 'Grounded-state schema digest; propose only.' },
      mechanism_sha256: { type: 'string', description: 'Mechanism or simulator source digest; propose only.' },
      goal_predicate_sha256: { type: 'string', description: 'Goal-predicate digest; propose only.' },
      mechanism_kind: {
        type: 'string',
        enum: ['textual_hypothesis', 'executable_simulator'],
        description: 'Defaults to the cheap textual theory. Simulator is escalation-only.',
      },
      plan_id: { type: 'string', description: 'Committed plan identity; result only.' },
      action_index: { type: 'integer', description: 'Zero-based queued action index; result only.' },
      predictions: {
        type: 'array',
        description: 'Different hypothesis predictions for one discriminating probe.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hypothesis_id: { type: 'string', required: true },
            predicted_observation_sha256: { type: 'string', required: true },
          },
        },
      },
      retrodictions: {
        type: 'array',
        description: 'One prediction for every Timeline transition; certify only.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            transition_index: { type: 'integer', required: true },
            predicted_observation_sha256: { type: 'string', required: true },
          },
        },
      },
      actions: {
        type: 'array',
        description: 'Bounded committed queue; every action must include its expected observation.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action_sha256: { type: 'string', required: true },
            expected_observation_sha256: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: { type: 'string', required: true, enum: [...OPERATIONS] },
          eventKind: { type: 'string', required: true },
          escalationState: {
            type: 'string',
            required: true,
            enum: ['observe_and_retrodict', 'build_verified_simulator', 'novelty_escape'],
          },
          stateJson: { type: 'string', required: true },
          checkpointJson: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.eventKind.length === 0
          ? `RetroDICT ${value.operation}: ${value.escalationState}`
          : `RetroDICT ${value.operation} appended ${value.eventKind}; ${value.escalationState}.`,
      }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('retrodict requires an owning agent session')
      const session = exec.agent.session
      const service = ctx.scientificRetrodiction
      let event: ScientificEventEnvelope | undefined
      let checkpointJson = ''

      switch (args.operation) {
        case 'start':
          service.start(session, {
            run_id: requiredString(args.run_id, 'run_id'),
            task_ref: requiredString(args.task_ref, 'task_ref'),
            harness_generation: 'next_deepseek_cordis',
            initial_observation_sha256: requiredString(
              args.initial_observation_sha256,
              'initial_observation_sha256',
            ),
            max_real_actions: requiredInteger(args.max_real_actions, 'max_real_actions'),
            simulator_after_actions: args.simulator_after_actions,
            novelty_after_actions: args.novelty_after_actions,
            simulator_after_resets: args.simulator_after_resets,
          })
          break
        case 'state':
          service.snapshot(session)
          break
        case 'probe':
          event = service.recordProbe(session, {
            action_sha256: requiredString(args.action_sha256, 'action_sha256'),
            observed_observation_sha256: requiredString(
              args.observed_observation_sha256,
              'observed_observation_sha256',
            ),
            purpose: requiredString(args.purpose, 'purpose'),
          })
          break
        case 'discriminating_probe': {
          if (!Array.isArray(args.predictions)) {
            throw new Error('retrodict discriminating_probe requires predictions')
          }
          const predictions: Record<string, string> = {}
          for (const row of args.predictions) {
            const id = requiredString(row.hypothesis_id, 'predictions[].hypothesis_id')
            if (predictions[id] !== undefined) throw new Error(`duplicate prediction for ${id}`)
            predictions[id] = requiredString(
              row.predicted_observation_sha256,
              'predictions[].predicted_observation_sha256',
            )
          }
          event = service.recordDiscriminatingProbe(session, {
            action_sha256: requiredString(args.action_sha256, 'action_sha256'),
            predictions,
            observed_observation_sha256: requiredString(
              args.observed_observation_sha256,
              'observed_observation_sha256',
            ),
          })
          break
        }
        case 'reset':
          event = service.recordReset(
            session,
            requiredString(args.observed_observation_sha256, 'observed_observation_sha256'),
          )
          break
        case 'propose':
          event = service.proposeHypothesis(session, {
            hypothesis_id: requiredString(args.hypothesis_id, 'hypothesis_id'),
            state_schema_sha256: requiredString(args.state_schema_sha256, 'state_schema_sha256'),
            mechanism_sha256: requiredString(args.mechanism_sha256, 'mechanism_sha256'),
            goal_predicate_sha256: requiredString(args.goal_predicate_sha256, 'goal_predicate_sha256'),
            mechanism_kind: args.mechanism_kind ?? 'textual_hypothesis',
          })
          break
        case 'certify':
          if (!Array.isArray(args.retrodictions)) {
            throw new Error('retrodict certify requires retrodictions')
          }
          event = service.certifyHypothesis(session, {
            hypothesis_id: requiredString(args.hypothesis_id, 'hypothesis_id'),
            retrodictions: args.retrodictions.map((row: {
              transition_index: number
              predicted_observation_sha256: string
            }) => ({
              transition_index: requiredInteger(row.transition_index, 'retrodictions[].transition_index'),
              predicted_observation_sha256: requiredString(
                row.predicted_observation_sha256,
                'retrodictions[].predicted_observation_sha256',
              ),
            })),
          })
          break
        case 'commit':
          if (!Array.isArray(args.actions)) throw new Error('retrodict commit requires actions')
          event = service.commitActions(session, {
            hypothesis_id: requiredString(args.hypothesis_id, 'hypothesis_id'),
            actions: args.actions.map((row: {
              action_sha256: string
              expected_observation_sha256: string
            }) => ({
              action_sha256: requiredString(row.action_sha256, 'actions[].action_sha256'),
              expected_observation_sha256: requiredString(
                row.expected_observation_sha256,
                'actions[].expected_observation_sha256',
              ),
            })),
          })
          break
        case 'result':
          event = service.recordActionResult(session, {
            plan_id: requiredString(args.plan_id, 'plan_id'),
            action_index: requiredInteger(args.action_index, 'action_index'),
            observed_observation_sha256: requiredString(
              args.observed_observation_sha256,
              'observed_observation_sha256',
            ),
          })
          break
        case 'checkpoint':
          checkpointJson = canonicalJson(service.exportCheckpoint(session))
          break
      }

      return Promise.resolve({
        operation: args.operation,
        eventKind: event?.kind ?? '',
        escalationState: service.escalationState(session),
        stateJson: canonicalJson(service.snapshot(session)),
        checkpointJson,
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `RetroDICT: ${args.operation}`,
      kind: 'other',
      rawInput: args,
    }),
  }))
}
