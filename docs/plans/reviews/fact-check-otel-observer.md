# Fact-check: the OTel GenAI observer (B17)

This log checks the claims that the `@buildanagent/sdk/otel` code, its README section and its changeset make about the OpenTelemetry GenAI semantic conventions and the OpenTelemetry packages. Claims were checked on 2026-11-19, as of November 2026. Convention claims come from `open-telemetry/semantic-conventions-genai` checked out at commit `d28355d` (`d28355d28cbe9ff158ecf22d85f9e078e43f7b20`, committed 2026-11-18 03:11 UTC), the commit that [harness decision HD7](../build-harness.md) pins. Package claims come from the installed `@opentelemetry/api` 1.9.1 and `@opentelemetry/sdk-trace` 2.12.1 and from `npm view`.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified, or our own inference.

## Span names, kinds and operations

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| B17-1 | `gen_ai.operation.name` has the well-known values `invoke_agent`, `chat` and `execute_tool` | `attributes.ts` | ✅ | `docs/registry/attributes/gen-ai.md`, well-known values table of `gen_ai.operation.name` at `d28355d`; every value is at Development stability |
| B17-2 | An in-process agent invocation is an INTERNAL span named `{gen_ai.operation.name} {gen_ai.agent.name}` when the agent has a name | `observer.ts` run span | ✅ | `docs/gen-ai/gen-ai-agent-spans.md`, "Invoke agent internal span": span name and "Span kind SHOULD be `INTERNAL`". The remote-agent span (`client-invoke-agent.md`) is CLIENT, so the SDK, which runs the loop in process, uses the internal one |
| B17-3 | The model-call span is named `{gen_ai.operation.name} {gen_ai.request.model}` and is CLIENT, though it MAY be INTERNAL for in-process models | `observer.ts` model span | ✅ | `docs/gen-ai/client-inference.md`, "Span: `gen_ai.client.inference`": "Span name SHOULD be `{gen_ai.operation.name} {gen_ai.request.model}`" and the span-kind paragraph. The SDK calls a provider over HTTP, so it keeps CLIENT |
| B17-4 | The tool span is named `execute_tool {gen_ai.tool.name}` and is INTERNAL | `observer.ts` tool span | ✅ | `docs/gen-ai/execute-tool.md`, "Span name SHOULD be `execute_tool {gen_ai.tool.name}`" and "Span kind SHOULD be `INTERNAL`" |
| B17-5 | `gen_ai.provider.name` and `gen_ai.request.model` are Required on the model-call span, and a custom provider value is allowed when no well-known one applies | `observer.ts` | ✅ | `client-inference.md` attribute table; `registry/attributes/gen-ai.md`: "If one of them applies, then the respective value MUST be used; otherwise, a custom value MAY be used", with `anthropic` and `openai` among the well-known values |

## Attributes and usage

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| B17-6 | `gen_ai.usage.input_tokens` SHOULD include cached tokens, and `cache_read.input_tokens` and `cache_write.input_tokens` SHOULD be included in it | `setUsage()`, README | ✅ | `client-inference.md`, notes [23], [24] and [28]. This matches `totalInput()`, which sums uncached input, cache reads and both cache-write classes |
| B17-7 | `gen_ai.usage.output_tokens` SHOULD include reasoning tokens, and `gen_ai.usage.reasoning.output_tokens` is a separate attribute included in it | `setUsage()`, README | ✅ | `client-inference.md`, notes [29] and [30]. The SDK's `usage.output` already counts reasoning ([D3](../build-sdk.md)) |
| B17-8 | The cache, reasoning and audio usage attributes are Recommended "when available and non-zero" | `setUsage()` | ✅ | `client-inference.md` attribute table, requirement-level column. The observer therefore writes cache and reasoning counts only above zero |
| B17-9 | `gen_ai.response.finish_reasons` is a string array, and an interrupted generation reports `interrupted` when the provider gives no reason | `FINISH_REASONS` | ✅ | `client-inference.md`, note [18]. The mapping of `stop`, `length`, `tool_calls` and `error` to the same words is our choice, as the conventions leave values open |
| B17-10 | `error.type` is Conditionally Required when the operation ended in an error, and SHOULD match the provider's error code | `failed()` | ✅ | `client-inference.md`, `error.type` row and note [3]. We write the HTTP status when the provider gave one and our error `kind` otherwise; `tool_error` for a tool's error result is our own low-cardinality value (⚠️ the conventions name no tool-error value) |
| B17-11 | `gen_ai.tool.name` is Required, `gen_ai.tool.call.id` Conditionally Required, `gen_ai.tool.type` Recommended with the example `function`, and a client-side function tool is type `function` | `observer.ts` tool span | ✅ | `execute-tool.md` attribute table and the tool-type note ("Function: A tool executed on the client-side") |
| B17-12 | `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` are Opt-In | `observer.ts`, README | ✅ | `execute-tool.md` attribute table, requirement level `Opt-In` |
| B17-13 | `gen_ai.system_instructions`, `gen_ai.input.messages` and `gen_ai.output.messages` are Opt-In | `observer.ts`, README | ✅ | `client-inference.md` attribute table, requirement level `Opt-In` |
| B17-14 | Message content is an array of `{ role, parts }` with part types `text`, `reasoning`, `tool_call` (`id`, `name`, `arguments`), `tool_call_response` (`id`, `response`) and `blob` (`modality`, `mime_type`), and roles include `system`, `user`, `assistant` and `tool` | `content.ts` | ✅ | `model/gen-ai/gen-ai-input-messages.json` and `gen-ai-output-messages.json` at `d28355d`: `$defs` for each part and the `Role` enum. System instructions are an array of text parts in `gen-ai-system-instructions.json` |
| B17-15 | `any`-typed content attributes may be recorded as JSON strings on a span | `content.ts`, README | ⚠️ | The conventions type these attributes `any`; an OpenTelemetry span attribute cannot hold an object, so we serialize to JSON. That a JSON string is acceptable is our inference from the `any` type; the conventions' spans pages were not found to say it either way |
| B17-16 | The GenAI conventions are at Development stability | README, `attributes.ts` | ✅ | Every span and attribute row at `d28355d` carries the Development badge, except `error.type` and `server.*`, which are Stable |

## OpenTelemetry packages

| # | Claim | Where | Verdict | Source and reason |
| --- | --- | --- | --- | --- |
| B17-17 | `@opentelemetry/sdk-trace` 2.12.1 exports `TracerProvider`, `SimpleSpanProcessor` (which takes `{ exporter }`) and `InMemorySpanExporter` | `test/otel.test.ts` | ✅ | `build/src/index.d.ts` of the installed package; the first version of the test passed the exporter positionally and failed type-checking |
| B17-18 | `@opentelemetry/sdk-trace` 2.12.1 was published on 2026-11-09, `@opentelemetry/api` 1.9.1 on 2026-03-25, so both are over a week old | `package.json` | ✅ | `npm view <pkg> time` on 2026-11-19, against the [version rule](../../../AGENTS.md#coding-standards) |
| B17-19 | `sdk-trace` 2.12.1 peer-depends on `@opentelemetry/api` `>=1.3.0 <1.10.0` | `package.json` | ✅ | `npm view @opentelemetry/sdk-trace@2.12.1 peerDependencies`; 1.9.1 satisfies it |
| B17-20 | `SpanKind.INTERNAL` is 0 and `CLIENT` is 2; `SpanStatusCode.ERROR` is 2 | `observer.ts` | ✅ | `build/src/trace/span_kind.d.ts` and `status.d.ts` of `@opentelemetry/api` 1.9.1 |
| B17-21 | `@opentelemetry/api` 1.9.1's ES build imports its own files without extensions, so Node's loader rejects it under the `module` condition that the test config sets | `vitest.config.ts` comment | ⚠️ | Observed, not read from the package's docs: loading `sdk-trace` in a test failed with "Cannot find module .../esm/baggage/utils". Bundling both packages through Vitest's dependency optimizer fixed it |
