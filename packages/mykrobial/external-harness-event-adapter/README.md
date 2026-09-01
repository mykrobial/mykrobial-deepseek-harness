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
