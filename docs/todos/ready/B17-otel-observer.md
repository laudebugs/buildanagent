# B17: OTel `gen_ai.*` observer with content off

| Field | Value |
| --- | --- |
| ID | `B17` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-the-shipping-surface) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B13](B13-interceptors-observers.md), [B5](B5-usage-cost-catalog.md) |
| Size | M |

## Goal

Project the event stream onto OTel GenAI spans through one built-in observer, with content attributes off by default and export only to a tracer the caller names.

## Context

- [agent-SDK guide §5](../../guides/agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item): telemetry is a projection of the same events
- [harness guide §13](../../guides/agent-harness.md#13-open-decisions-for-round-p): decision 7 pins the semantic-conventions commit

## Scope

**In scope**

- `otelObserver({ tracer, captureContent })` in `@agent-speak/sdk/otel`
- Spans for `invoke_agent`, each model call and `execute_tool`, with usage attributes summed per D3
- Content attributes (`gen_ai.tool.call.arguments`, results, messages) only with `captureContent: true`
- A structural `TracerLike` type, so `@opentelemetry/api` is not a runtime dependency

**Out of scope** (and which todo covers it)

- Exporters and the telemetry backend (P2)
- The cost attribute name (harness decision 7)

## Tasks

- [ ] Keep attribute names in one constants file, stamped with the conventions commit used; update it when P2 pins one.
- [ ] Test with `@opentelemetry/sdk-trace-base` 2.12.0 and an in-memory exporter, as an exact-pinned dev dependency.

## Acceptance criteria

- [ ] A scripted run with one tool call yields one agent span, one span per model call and one tool span, correctly nested
- [ ] `gen_ai.usage.input_tokens` equals `totalInput()` for each call
- [ ] No content attribute appears unless `captureContent` is true (a test checks every span's keys)
- [ ] `@opentelemetry/api` is absent from `packages/sdk` runtime dependencies
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/otel.test.ts`.

## Docs to update

`packages/sdk/README.md`: telemetry. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The GenAI conventions are at Development stability; the constants file isolates renames.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
