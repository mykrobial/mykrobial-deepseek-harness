# Mykrobial component lifecycle reference

This model-free package makes the CORDIS spatiotemporal invariants executable before the admitted upstream checkout exists: dependencies control spatial activation; every installed effect carries an inverse; inverses run in reverse order; dependency loss unloads; dependency return remounts; restart creates a new generation; failed replacement rolls back to the prior definition; disposal is terminal and idempotent.

`executeComponentActivationTransaction` adds the component-local activation boundary used after a no-apply reconfiguration plan is separately admitted. It freezes the current snapshot, binds the candidate to Prediction–Rehearsal Helix, replay, rollback, and external-effect receipts, invokes a distinct permit verifier before touching effects, mounts only the candidate component, runs a finite ordered health horizon, and either commits or restores the prior generation with an explicit rollback event. Its receipt keeps optimizer, evaluation, promotion, Trace append, deployment, and fleet authority false. Failed disposer labels remain sticky in the failed snapshot. Every normal mutation path stays closed until `remediateResidualEffects` retries the retained disposers and returns a content-addressed receipt with an empty residual set.

`ComponentEvolutionGuardian` keeps each component's content-addressed mutation history outside the component state that an activation, rewind, or rebuild can replace. The guardian assigns the event sequence and previous-event digest, binds every event to the task capsule, loadout, component snapshot, shared trajectory event, and Trace v2.3 intent, bounds candidate retries and total history, and deterministically rehydrates its indexes from the complete event chain. A rewind or rebuild request produces only a closed `prepared_unexecuted` command against a known snapshot and the current history head. It does not mutate component state, erase failed attempts, verify external-state rollback, append Trace, or grant execution authority.

The public JSON validation for guardian events, snapshots, and commands lives in `contracts/mykrobial/component-guardian-runtime.v1.schema.json`. Exo's durable-history and snapshot/rewind mechanics inform this independent implementation; the existing external-harness adapter keeps Exo evidence quarantined and no Exo code or runtime is copied.

## Model Experience

The package does not call a model or add model-visible text. A separately admitted consumer may project content-addressed guardian metadata through OmniGent or bind it into an OmniRoute request; that consumer owns any token and KV-cache effects.

## Known Limitations and Deferred Work

This is a reference fixture, not a substitute for executing the actual CORDIS fiber and Loader tests. It does not implement durable storage, the permit issuer or verifier, candidate selection, optimizer or evaluator execution, external-state rollback, Trace append, deployment, or a component restart adapter. Synthetic permits and in-memory guardian replay prove only the runtime APIs.
