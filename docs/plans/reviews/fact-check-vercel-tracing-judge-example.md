# Fact-check: the Vercel AI SDK tracing and judge example

This log checks the claims that `verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts` and its README section make on 2026-11-22 (todo T34), against the pinned `ai` 7.0.162, `@ai-sdk/otel` 1.0.162 and `@opentelemetry/sdk-trace` 2.12.1, and the run itself.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| T34-1 | `OpenTelemetry` from `@ai-sdk/otel` takes a `tracer` option, and `generateText` takes it per call through `telemetry: { integrations }` | ✅ | `@ai-sdk/otel`'s `index.d.ts`, `OpenTelemetryOptions.tracer`; `ai`'s `index.d.ts`, `TelemetryOptions.integrations`; the run passes |
| T34-2 | The agent span's name is `invoke_agent {modelId}` | ✅ | `docs/reference/vercel-ai-sdk/source/content/docs/03-ai-sdk-core/60-telemetry.mdx`, "Agent span names"; the run's span is `invoke_agent agent-model` |
| T34-3 | A tool loop's spans form one tree: the agent span, a `step N` span for each step, and a `chat {modelId}` span and an `execute_tool {name}` span under the steps | ✅ | The run: the example checks the names and every parent link; the docs say child span names are unchanged by `agentSpanName`, but do not list them, so the names rest on the run |
| T34-4 | Model-call spans and the agent span carry `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`, and the agent span's counts are the sum of its calls | ✅ | `60-telemetry.mdx` names `gen_ai.usage.input_tokens`; the example checks 100 and 20 on each call and 200 and 40 on the agent span |
| T34-5 | `InMemorySpanExporter`, `SimpleSpanProcessor` and `TracerProvider` from `@opentelemetry/sdk-trace` 2.12.1 hold finished spans in memory | ✅ | The package exports all three (checked by importing it); `getFinishedSpans()` returns the six spans the example reads. Published 2026-11-09, more than a week before this change |
| T34-7 | `@opentelemetry/sdk-trace-base` is deprecated in favour of `@opentelemetry/sdk-trace`, which is why the example uses the latter | ✅ | `npm view @opentelemetry/sdk-trace-base@2.7.1 deprecated` prints "Use @opentelemetry/sdk-trace package"; the new package exports `TracerProvider` where the old one exports `BasicTracerProvider`, and its peer range accepts the API 1.9.1 that `@ai-sdk/otel` uses |
| T34-6 | The judge is a scripted second model, so the example tests the parsing code, not a model's judgement | ✅ | The example's judge is a `scripted()` mock with its own model id; no provider is called |

**Totals:** 7 claims: 7 ✅, 0 ✏️, 0 ⚠️.
