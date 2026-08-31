# Mykrobial OmniRoute LLM adapter

This provider-side DeepSeek `LlmAdapter` delegates transport to `ctx.omniRouteTransport` and durable identity readback to `ctx.omniRouteReceiptSink`. CORDIS keeps it inactive until both services exist. The adapter buffers the terminal `finish` chunk until the requested/routed/served/provider receipt is exact, execution-verified, and durably handed to the sink.

The package owns no endpoint credentials, provider selection policy, promotion decision, Trace authority, or deployment. Its bundle row is disabled until a separately admitted transport, receipt sink, route policy, and authority reference are supplied.
