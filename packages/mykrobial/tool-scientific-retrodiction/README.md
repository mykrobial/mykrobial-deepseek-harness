# Mykrobial RetroDICT tool consumer

This agent-scoped consumer registers one compact `retrodict` tool. The operation discriminator keeps the model-facing catalog small while preserving strict service-side validation and durable DeepSeek SessionEvents.

The tool does not execute a model, simulator, downloaded program, or environment action. It records the observation/action identities and expectations supplied by the owning agent. Real environment tools remain separately guarded and admitted.
