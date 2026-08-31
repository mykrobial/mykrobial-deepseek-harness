# Mykrobial Trace V2.3 bridge

This observer projects each durable DeepSeek scientific event into a metadata-only Trace V2.3 intent and hands it to an injected RSI-owned sink. The source session event is already committed before observers run; sink failures become typed debt and cannot veto that append. The sink must be idempotent on the source event hash.

An enqueue receipt explicitly states `trace_append_claimed:false`. Queue acceptance is not a canonical Trace append, persistence readback, runtime activation, deployment, or promotion receipt.
