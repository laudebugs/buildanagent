# B17: OTel `gen_ai.*` observer with content off

| Field | Value |
| --- | --- |
| ID | `B17` |
| Status | `ongoing` |
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

- [ ] Keep attribute names in one constants file, exported as `GEN_AI_ATTRIBUTES` beside `SEMCONV_GENAI_COMMIT = "d28355d"`, the commit harness HD7 pins.
- [ ] First confirm the in-memory span exporter's export name in `@opentelemetry/sdk-trace` 2.12.1. Then test with `@opentelemetry/sdk-trace` 2.12.1 and that exporter, as an exact-pinned dev dependency. *(Revised in plan review 2, 2026-11-19: npm marks every `@opentelemetry/sdk-trace-base` release deprecated in favour of `@opentelemetry/sdk-trace`, except 2.12.1, which wraps `@opentelemetry/sdk-trace` 2.12.1. `@opentelemetry/exporter-trace-otlp-http` 0.223.2 already depends on `@opentelemetry/sdk-trace` 2.12.1.)*
- [ ] Take the trace context explicitly rather than from ambient `AsyncLocalStorage`, and expose `flush()` so a Worker can pass it to `waitUntil` (added 2026-11-18, [ADR 0033](../../decisions/0033-three-deployment-targets.md))

## Acceptance criteria

- [ ] A scripted run with one tool call yields one agent span, one span per model call and one tool span, correctly nested
- [ ] `gen_ai.usage.input_tokens` equals `totalInput()` for each call
- [ ] No content attribute appears unless `captureContent` is true (a test checks every span's keys)
- [ ] `@opentelemetry/api` is absent from `packages/sdk` runtime dependencies
- [ ] `@buildanagent/sdk/otel` exports `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT`, and every span attribute name the observer writes comes from `GEN_AI_ATTRIBUTES` (a test)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/otel.test.ts`.

## Docs to update

`packages/sdk/README.md`: telemetry. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The GenAI conventions are at Development stability; the constants file isolates renames.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
