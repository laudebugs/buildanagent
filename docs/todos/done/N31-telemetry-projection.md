# N31: Telemetry projection from the log, with the budget meter

| Field | Value |
| --- | --- |
| ID | `N31` |
| Status | `done` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N7](../done/N7-rebuild-resume-replay.md), [N13](../done/N13-signed-approvals.md), [B17](B17-otel-observer.md) |
| Size | M |

## Goal

Project OTel `gen_ai.*` spans from stored entries, with an approval-wait span, content off by default, the pinned convention commit and our cost attributes, so telemetry can be rebuilt from any log.

## Context

- [HD7](../../plans/build-harness.md#hd7-pin-semconv-genai-d28355d-and-name-cost-in-our-own-namespace-with-sdk-d3): the decision and its evidence
- [ADR 0017](../../decisions/0017-telemetry-convention-pin-and-cost-attributes.md): the decision records
- [harness guide §9](../../guides/agent-harness.md#9-telemetry-should-be-a-projection-of-the-log-with-content-off-by-default-and-cost-recorded-on-every-entry): span tree, approval wait, content levels, OTLP only
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): need 10

## Scope

**In scope**

- `projectSpans(entries, { tracer, content, toolArguments })`: `invoke_agent` → turn → model call → `execute_tool`, plus `approval_wait` from `approval_requested` to `approval_resolved`
- `GEN_AI_ATTRIBUTES` and `SEMCONV_GENAI_COMMIT` imported from `@buildanagent/sdk/otel` (B17), plus a module for our own `buildanagent.*` names
- `hashAttributes: { key, names }`: HMAC-SHA-256 over each named attribute's value before export (agent AH12)
- `gen_ai.usage.input_tokens` as `totalInput(usage)`; `buildanagent.cost.usd` omitted when `Cost.total` is `null`
- Content levels `none` (default), `attributes`, `refs`; tool arguments gated apart
- The session budget meter and the `budget_warning` event (HD9)

**Out of scope** (and which todo covers it)

- Exporter wiring (the CLI's `--otlp-endpoint`, N30)

## Tasks

- [x] First confirm the in-memory span exporter's export name in `@opentelemetry/sdk-trace` 2.12.1. Then test with that exporter as an exact-pinned dev dependency. *(Revised in plan review 2, 2026-11-19: `@opentelemetry/sdk-trace-base` is deprecated in favour of `@opentelemetry/sdk-trace`, the line the OTLP exporter 0.223.2 already pulls.)*
- [x] Import the SDK's attribute module; define no `gen_ai.*` name in the harness.

## Acceptance criteria

- [x] A recorded capstone session projects to the expected span tree, checked against a fixture
- [x] The approval-wait span's duration equals the gap between the two approval entries
- [x] With default options no span attribute contains message or tool-argument text
- [x] A session with an unknown price has spans with `buildanagent.cost.basis = "unknown"` and no `buildanagent.cost.usd`
- [x] At 80% of a session cap the meter emits one `budget_warning`
- [x] With `hashAttributes` naming an attribute, every exported span carries the keyed hash of its value and never the value itself
- [x] No `gen_ai.*` string literal appears in `packages/harness/src/telemetry` (a test)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/telemetry/project.test.ts`, `budget.test.ts`.

## Docs to update

`packages/harness/README.md`: attributes and content levels. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Outcome

`@buildanagent/harness/telemetry` holds `projectSpans()`, `createBudgetMeter()`, `budgetMeterFromEntries()` and `BUILDANAGENT_ATTRIBUTES`.

- The in-memory span exporter's export name in `@opentelemetry/sdk-trace` 2.12.1 is `InMemorySpanExporter`, which the SDK's own tests already import. The harness takes `@opentelemetry/api` and `@opentelemetry/sdk-trace` as exact-pinned dev dependencies. Their ES builds import files without extensions, so the harness's Vitest config bundles them through Vite, as the SDK's does.
- `projectSpans()` takes one more option than the plan sketched: a required `childContext`, because the harness imports nothing from OpenTelemetry and cannot build a parent context itself. The SDK's observer has the same option. The plan's sketch is revised.
- `execute_tool` is a sibling of the `chat` span that asked for it, under the `turn`, as in the SDK's observer. The plan's arrow chain read as a child, but a tool starts when its model call ends, so a child would begin after its parent. A call that waited for a person ends in the turn that resumed it, so its span can outlive the turn that started it.
- HD7 says the commit is a resource attribute. A tracer provider's resource belongs to the caller, so the projection writes `buildanagent.semconv.genai.commit` on the root span and the README tells callers to stamp the same value on their resource.
- Content has three levels, and tool arguments have their own switch that applies at every level, including to the tool calls inside message content. `refs` writes the ids of the entries that hold the content.
- The SDK now exports its content helpers (`blockPart`, `resultParts`, `systemInstructionsJson`, `jsonValue` and `ContentPart`) from `@buildanagent/sdk/otel`. The harness first copied them, and `pnpm check:duplicates` found the copy, so the one format has one home. That is a public SDK change with a changeset.
- The meter reports and the caller enforces. Wiring it into the runner's `budgetUsd` is left to the caller, and nothing in this todo stops a turn. A rebuilt meter does not repeat a warning for spend the log already holds.
- Two error codes are new: `invalid_telemetry_options` and `budget_unknown`.

## Risks and open questions

The pinned conventions are Development-only; a move is a deliberate change (ADR 0017).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
