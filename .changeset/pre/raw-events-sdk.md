---
"@buildanagent/sdk": minor
---

Breaking Changes: `AgentEvent` and `AGENT_EVENT_TYPES` gain `raw`, so an exhaustive `switch` over `event.type` needs a `raw` case. `run()` and `continueRun()` gain `includeRaw` (default `false`): with it set, each model call asks the gateway for the provider's own events, and the run emits each as a `raw` event between `model_call_start` and `model_call_end`. The run's option alone decides, so `CallOptions` leaves `includeRaw` out. Raw events stay out of the transcript, the interceptors, the OpenTelemetry spans and recorded pairs, and a `StreamScript`'s raw events play only when the call sets `includeRaw`.
