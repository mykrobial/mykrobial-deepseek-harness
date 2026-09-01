# Mykrobial per-component recursive-improvement seam

This pure package makes every registered harness component independently addressable by experiment and replacement plans. It freezes component mutation proposals, matched `BASE`/`TRUE`/`SHAM` experiment capsules, untrusted external optimizer or promotion inputs, shared trajectory/Trace v2.3 intents, and CORDIS-shaped swap, replay, and rollback plans. It never executes an optimizer, evaluator, model, tool, lifecycle effect, replay, rollback, Trace append, training run, promotion, or deployment.

The mutation registry covers prompts, skill cards, ontology edges or functions, routers, workflows, memory, tools, model routes, model adapters, model weights, harness code, guardrails, UI projections, and loadouts. Each surface is independently versioned and swappable per task. `model_weights` is restricted to the `future_joint` plane and always retains a separate unverified training gate.

## Data flow

1. An external learning plane supplies a proposal input and content-addressed context.
2. `prepareComponentMutationProposal` checks its exact surface and plane, then returns a proposal-only artifact.
3. `prepareComponentExperimentCapsule` freezes task, loadout, source, evaluator, finite budget, and distinct `BASE`/`TRUE`/`SHAM` arms.
4. `projectComponentExperimentLifecycle` projects a lifecycle phase into the shared `mykrobial.harness.trajectory-event.v1` vocabulary and the existing metadata-only Trace v2.3 intent without appending either.
5. `acceptExternalComponentDecision` preserves an optimizer or promotion recommendation as untrusted input even when it names an authority receipt.
6. `prepareComponentReconfigurationPlan` describes a no-apply CORDIS lifecycle and loadout swap, replay, or rollback sequence while keeping application authority false.

## Ownership

This Next-Generation DeepSeek/CORDIS package owns the runtime-facing public seam only. The Current Production RSI lane owns optimizer implementations, evaluators, training, experiment execution, Pareto adjudication, causal-value readback, promotion, and control-plane policy. The two lanes meet at content-addressed proposal, capsule, event, replay, rollback, and decision artifacts.

Exo is quarantined research evidence. No Exo source, prompt, code, schema, or runtime behavior is copied or treated as implementation authority here.

## Model Experience

The package never adds model-visible text or calls a model. A separately admitted consumer may expose selected artifact metadata through OmniGent or use it to prepare an OmniRoute request.

#### KV Cache effect

None in this package. A later component or loadout change may alter model input and invalidate the affected request suffix, but that requires a separate admitted operation.

## Known Limitations and Deferred Work

- JSON schemas and pure constructors are source-only. No schema validator, experiment runner, optimizer, evaluator, lifecycle adapter, Trace sink, or UI is activated here.
- External decision receipt references remain unverified. A separate deterministic authority verifier must validate them before any application or promotion.
- Trace projection is metadata-only and retains `typed_blocker:mykrobial_trace_v2_3_schema_and_append_authority_unadmitted`.
- Model-weight proposals remain proposal-only until separate training, evaluator, canary, rollback, deployment, and promotion gates pass.
- Exo mechanism research may inform a later reviewed successor; this generation contains no Exo-derived implementation.
