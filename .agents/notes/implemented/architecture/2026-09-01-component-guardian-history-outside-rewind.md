# Agent Note: Keep component evolution history outside rewindable state

Status: implemented

English | [中文](2026-09-01-component-guardian-history-outside-rewind.zh.md)

## Problem

DeepSeek Harness can replace a Cordis component and restore a prior component generation, while the Mykrobial component RSI package can prepare component-specific experiments and reconfiguration plans. A component snapshot alone cannot preserve a trustworthy learning history because the same operation that rewinds the component can also erase the failed attempts, predictions, and evidence needed to avoid repeating a recursive loop.

The external Exo evidence demonstrates a useful separation: mutable execution can snapshot and rewind while canonical history remains outside that rewind. Copying Exo's runtime would create a second harness core and would bypass the existing DeepSeek session, CORDIS lifecycle, Mykrobial trajectory, Trace v2.3, and authority owners.

## Decision

[`ComponentEvolutionGuardian`](../../../../packages/mykrobial/component-lifecycle/src/index.ts) owns an append-only, content-addressed history for one component, task capsule, and loadout. It creates one deterministic baseline event, assigns every later sequence and previous-event digest, rejects duplicate event identities and regressed timestamps, and binds each mutation fact to component snapshot, trajectory-event, Trace v2.3 intent, and evidence digests.

The guardian derives known snapshot, candidate-attempt, and exact candidate-and-proposal association indexes from the event chain. An activation must name a proposal previously recorded for that candidate. The durable input path rejects boxed scalar aliases, sparse or accessor-backed arrays, and custom array properties before hashing. The guardian applies finite limits to total events and attempts for one candidate, and [`rehydrate`](../../../../packages/mykrobial/component-lifecycle/src/index.ts) reconstructs those indexes by replaying every event before accepting a serialized snapshot. An activation, rewind, or restart never removes prior guardian events.

The guardian prepares `rewind_component` and `rebuild_and_restart_component` commands only against a recorded snapshot and the current history head. These commands remain `prepared_unexecuted`, keep component application, restart, history rewrite, Trace append, and deployment authority false, and mark any external-state rollback receipt unverified. The existing component activation transaction remains the only component-effect executor and still requires its distinct permit verifier.

[`component-guardian-runtime.v1.schema.json`](../../../../contracts/mykrobial/component-guardian-runtime.v1.schema.json) closes the public event, snapshot, and command objects. [`external-harness-event-adapter`](../../../../packages/mykrobial/external-harness-event-adapter/README.md) remains the quarantined Exo evidence bridge; this implementation copies no Exo code, prompt, schema, or runtime and creates no parallel canonical event store.

## Alternatives considered

**Store evolution history inside the component snapshot.** Rejected because rewinding the component would erase the evidence that explains why a generation failed and could allow the same candidate loop to repeat without detection.

**Copy or run Exo as the self-improvement core.** Rejected because DeepSeek Harness and Cordis already own composition and lifecycle, while Mykrobial trajectory and Trace own shared evidence. A second core would split replay, authority, and rollback truth.

**Allow an optimizer to mutate a component directly.** Rejected because optimizer recommendations are untrusted inputs. The component activation transaction must verify a separate, exact permit before it touches effects.

**Record only whole-harness evolution.** Rejected because prompts, skills, tools, routes, adapters, memory, guardrails, UI projections, loadouts, and harness code need independent task-specific experiments and rollback histories.

## Consequences

Each registered component can retain its own bounded evolution lineage while remaining swappable through the existing CORDIS lifecycle. A failed or contaminated generation stays visible after a component rewind or rebuild, and deterministic rehydration rejects altered ordering, indexes, or hashes.

The guardian is not durable storage, an optimizer, an evaluator, a Trace sink, an authority verifier, or a restart adapter. Runtime integration must store the sealed snapshot outside component effects, append the corresponding shared trajectory and Trace events through their owners, and submit a prepared command to the separately admitted activation path.
