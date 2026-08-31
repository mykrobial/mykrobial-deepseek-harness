# Mykrobial scientific retrodiction

This package is the independently authored Next-Generation DeepSeek/CORDIS implementation of the shared `scientific-retrodiction-v1` behavior contract.

It is RetroDICT-first:

- append observations and actions to a durable DeepSeek SessionEvent timeline;
- keep hypotheses explicit;
- require complete-history certification before a hypothesis may plan;
- attach an expected observation digest to every committed action;
- invalidate the remaining plan after the first mismatch;
- persist a generation-neutral behavior projection and content-addressed checkpoint;
- require an executable simulator only after a configured action/reset threshold;
- enter novelty/unvisited-state exploration only after the later configured threshold.

Schema-derived mechanisms are limited to joint state/mechanism revision and discriminating probes. They do not create an always-on simulator or unbounded search path.

## Cordis seam

- Service Definition: `ScientificRetrodictionService` at `ctx.scientificRetrodiction`.
- Provider: the event-sourced service in `src/index.ts`.
- Consumer: `mykrobialScientific` session projection and the named Mykrobial RetroDICT preset.
- Dependencies: `sessions` and `sessionProjections`.
- Durable adapter events: `mykrobial/scientific/start` and `mykrobial/scientific/event`.
- Reversible lifecycle: service and projection registration are owned by the package fiber and disappear on unload.

## Proof boundary

This overlay is source code prepared against pinned public DeepSeek interfaces. It has not been copied into the acquired DeepSeek checkout, typechecked against the repository, built, mounted, or run. Dependency, build, service, model, runtime, and deployment claims remain unavailable until their separately admitted stages execute.
