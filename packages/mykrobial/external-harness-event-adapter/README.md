# External harness event adapter

This pure package turns a quarantined external-harness event into the existing
Mykrobial trajectory-event and metadata-only Trace v2.3 intent shapes. It is a
bridge into the DeepSeek/CORDIS runtime—not a second core, event store, optimizer,
or authority controller.

The first source profile is `exo`, based on the public Exo repository at commit
`5bcb939de8b9be01cacced6ba908159c0c6b28a1`. No Exo code is copied or executed.
The adapter maps only public event mechanics:

- messages → observation or result;
- tool requests → action expectation;
- tool results → action result;
- sandbox snapshots → checkpoint;
- conversation forks → experiment;
- deferred rebuild outcomes → result; and
- usage records → cost.

Every projection retains a content-addressed reference to the raw external event
and an explicit loss ledger. The metadata projection drops raw payload bodies,
secrets, and hidden reasoning; marks unavailable chain, provider, valid-time,
deadline, causal, and deployment evidence; never claims sandbox rewind rolled
back external state; and keeps both trajectory and Trace append authority false.

This package does not clone, install, build, test, run, or control Exo. It does
not execute an optimizer, evaluator, model, tool, component change, replay,
rollback, Trace append, promotion, or deployment.

`prepareTerminalTaskContextRequest` supplies the public context needed by the
Current Production V37 terminal-task binding emitter: task/session/tenant hashes,
domain, requested/served receipt references, source generation, and an exact
visible event range. It accepts an explicit canonical terminal-row hash and
terminal family; it never classifies a terminal row, signs or verifies the
context, emits a binding, infers a task from a message or event order, or
retroactively relabels historical events.

`prepareTerminalTaskAuthorityHostRequestV38` lifts that request into the exact
unsigned V38 subject and `authority__delegate` scope. It binds the operation-
profile receipt and accepted V37 source/review identities, publishes the exact
callback input, owner, nonclaim, and blocker vocabularies, and leaves enrollment
authentication, nonce reservation, signing, verification, admission, execution,
Trace, promotion, deployment, and fleet convergence outside this package.
