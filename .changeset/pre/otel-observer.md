---
"@buildanagent/sdk": minor
---

New: `@buildanagent/sdk/otel` exports `otelObserver()`, an observer that turns a run into OpenTelemetry GenAI spans: one `invoke_agent` span, a `chat` span for each model call and an `execute_tool` span for each tool call. Spans carry no content unless you pass `captureContent: true`, and go only to the tracer you pass. The observer takes the trace context through the `parentContext` option and the required `childContext` option, offers `flush()` for `waitUntil`, and offers `endRun()` to end the spans of a run that threw. The subpath also exports the attribute-name constants, `SEMCONV_GENAI_COMMIT` and the structural types for the tracer and the observer. `@opentelemetry/api` is not a dependency of the SDK.
