# B17: OTel `gen_ai.*` observer with content off

| Field | Value |
| --- | --- |
| ID | `B17` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B13](../done/B13-interceptors-observers.md), [B5](../done/B5-usage-cost-catalog.md) |
| Size | M |

## Goal

Project the event stream onto OTel GenAI spans through one built-in observer, with content attributes off by default and export only to a tracer the caller names.

## Context

- [agent-SDK guide §5](../../guides/agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item): telemetry is a projection of the same events
- [harness guide §13](../../guides/agent-harness.md#13-open-decisions-for-round-p): decision 7 pins the semantic-conventions commit

## Scope

**In scope**

- `otelObserver({ tracer, captureContent })` in `@buildanagent/sdk/otel`
- Spans for `invoke_agent`, each model call and `execute_tool`, with usage attributes summed per D3
- Content attributes (`gen_ai.tool.call.arguments`, results, messages) only with `captureContent: true`
- A structural `TracerLike` type, so `@opentelemetry/api` is not a runtime dependency
- Exported `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT = "d28355d"`, which the harness projection imports (harness need 10; HD7)

**Out of scope** (and which todo covers it)

- Exporters and the telemetry backend (P2)
- The cost attribute name (harness decision 7)

## Tasks

- [x] Keep attribute names in one constants file, exported as `GEN_AI_ATTRIBUTES` beside `SEMCONV_GENAI_COMMIT = "d28355d"`, the commit harness HD7 pins.
- [x] First confirm the in-memory span exporter's export name in `@opentelemetry/sdk-trace` 2.12.1. Then test with `@opentelemetry/sdk-trace` 2.12.1 and that exporter, as an exact-pinned dev dependency. *(Revised in plan review 2, 2026-11-19: npm marks every `@opentelemetry/sdk-trace-base` release deprecated in favour of `@opentelemetry/sdk-trace`, except 2.12.1, which wraps `@opentelemetry/sdk-trace` 2.12.1. `@opentelemetry/exporter-trace-otlp-http` 0.223.2 already depends on `@opentelemetry/sdk-trace` 2.12.1.)*
- [x] Take the trace context explicitly rather than from ambient `AsyncLocalStorage`, and expose `flush()` so a Worker can pass it to `waitUntil` (added 2026-11-18, [ADR 0033](../../decisions/0033-three-deployment-targets.md))

## Acceptance criteria

- [x] A scripted run with one tool call yields one agent span, one span per model call and one tool span, correctly nested
- [x] `gen_ai.usage.input_tokens` equals `totalInput()` for each call
- [x] No content attribute appears unless `captureContent` is true (a test checks every span's keys)
- [x] `@opentelemetry/api` is absent from `packages/sdk` runtime dependencies
- [x] `@buildanagent/sdk/otel` exports `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT`, and every span attribute name the observer writes comes from `GEN_AI_ATTRIBUTES` (a test)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/otel.test.ts`.

## Docs to update

`packages/sdk/README.md`: telemetry. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The GenAI conventions are at Development stability; the constants file isolates renames.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/sdk/otel` exports `otelObserver()`, which returns an `Observer` with `flush()` and `endRun()` methods, plus `GEN_AI_ATTRIBUTES`, `GEN_AI_CONTENT_ATTRIBUTES`, `GEN_AI_OPERATIONS`, `SEMCONV_GENAI_COMMIT` and the structural types `TracerLike`, `SpanLike`, `SpanOptionsLike`, `AttributeValueLike`, `OtelObserver` and `OtelObserverOptions`. The code is in `packages/sdk/src/otel/` (`attributes.ts`, `content.ts`, `observer.ts`). The package gains two exact-pinned dev dependencies, `@opentelemetry/sdk-trace` 2.12.1 and `@opentelemetry/api` 1.9.1 (the sdk's peer, which the tests also call), and no runtime dependency. The changeset is `.changeset/otel-observer.md`, a `minor` bump. Its claims are logged as rows B17-1 to B17-21 in [the fact-check log](../../plans/reviews/fact-check-otel-observer.md).

Decisions:

- The observer takes the trace context as options: `parentContext` for the run's span and `childContext(parent)` for the others. Building a child context needs `@opentelemetry/api`, so the caller supplies that function and the SDK imports nothing from OpenTelemetry. `childContext` is required (changed in code review): without it, an OpenTelemetry tracer would start each model and tool span in the active context, outside the run's trace.
- A run that throws sends no `run_end`, so `endRun(runId, error)` ends its open spans as failed and forgets it (added in code review).
- `flush()` calls an optional `forceFlush` option, so a Worker can pass `observer.flush()` to `waitUntil`.
- The run span is the in-process `invoke_agent` span (INTERNAL), a model call is a CLIENT `chat` span and a tool call is an INTERNAL `execute_tool` span, all children of the run span. Spans start and end at their events' timestamps.
- Input tokens use `totalInput(usage)` and output tokens `usage.output`, per D3 and the conventions; cache and reasoning counts are written only above zero, and unreported usage writes no token attributes. The run span carries the sums from `run_end`.
- Content (system instructions, messages, tool arguments and results, and error messages as status descriptions) is written only with `captureContent: true`, as JSON strings in the conventions' parts format where it is structured; image bytes are never written. Tool arguments are the input the tool ran with, after any `beforeToolCall` replacement.
- `gen_ai.response.model` is left out, because the gateway reports only the requested model (changed in code review).
- One observer keeps state per `runId`, so it can serve several runs. A run that ends with spans still open closes them with an error status.
- The cost attribute is left out, as the scope says.
- `vitest.config.ts` has Vitest bundle `@opentelemetry/api` and `sdk-trace`, because the api's ES build imports its own files without extensions and the tests run Node under the `module` condition (fact-check row B17-21).

Each criterion and the test that covers it, all in `packages/sdk/test/otel.test.ts`:

- One agent span, one span per model call and one tool span, nested: "a run with one tool call yields one agent span, one span per model call and one tool span, nested".
- `gen_ai.usage.input_tokens` equals `totalInput()`: "each model call's input_tokens equals totalInput() of its usage, and the agent span sums the calls".
- No content unless `captureContent`: "no content attribute appears on any span unless captureContent is true", with "captureContent: true records the prompt, the messages and the tool's arguments and result" as its counterpart.
- No runtime `@opentelemetry/api`: "@opentelemetry/api is not a runtime dependency, and no source file imports it".
- Exported names, all from `GEN_AI_ATTRIBUTES`: "every attribute name the observer writes comes from GEN_AI_ATTRIBUTES, content and failures included" and "the package exports the pinned convention commit".
- Explicit trace context and `flush()`: "the caller's trace context reaches the run's span, and flush() flushes the exporter".
- Offline checks: `pnpm check`, `pnpm typecheck` and `pnpm test` pass from the repo root.
