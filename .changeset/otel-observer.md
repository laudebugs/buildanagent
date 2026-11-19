---
"@buildanagent/sdk": minor
---

New: `@buildanagent/sdk/otel` exports `otelObserver()`, an observer that turns a run into OpenTelemetry GenAI spans: one `invoke_agent` span, a `chat` span for each model call and an `execute_tool` span for each tool call. Spans carry no content unless you pass `captureContent: true`, and go only to the tracer you pass. The observer takes the trace context through the `parentContext` and `childContext` options and offers `flush()` for `waitUntil`. The subpath also exports `GEN_AI_ATTRIBUTES`, `GEN_AI_CONTENT_ATTRIBUTES`, `GEN_AI_OPERATIONS` and `SEMCONV_GENAI_COMMIT`, and the types `TracerLike`, `SpanLike`, `SpanOptionsLike`, `AttributeValueLike`, `OtelObserver` and `OtelObserverOptions`. `@opentelemetry/api` is not a dependency of the SDK.
