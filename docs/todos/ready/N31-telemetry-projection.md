# N31: Telemetry projection from the log, with the budget meter

| Field | Value |
| --- | --- |
| ID | `N31` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N7](N7-rebuild-resume-replay.md), [N13](N13-signed-approvals.md), [B17](B17-otel-observer.md) |
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

- [ ] Test with `@opentelemetry/sdk-trace-base` 2.12.0's in-memory exporter as a dev dependency.
- [ ] Import the SDK's attribute module; define no `gen_ai.*` name in the harness.

## Acceptance criteria

- [ ] A recorded capstone session projects to the expected span tree, checked against a fixture
- [ ] The approval-wait span's duration equals the gap between the two approval entries
- [ ] With default options no span attribute contains message or tool-argument text
- [ ] A session with an unknown price has spans with `buildanagent.cost.basis = "unknown"` and no `buildanagent.cost.usd`
- [ ] At 80% of a session cap the meter emits one `budget_warning`
- [ ] With `hashAttributes` naming an attribute, every exported span carries the keyed hash of its value and never the value itself
- [ ] No `gen_ai.*` string literal appears in `packages/harness/src/telemetry` (a test)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/telemetry/project.test.ts`, `budget.test.ts`.

## Docs to update

`packages/harness/README.md`: attributes and content levels. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The pinned conventions are Development-only; a move is a deliberate change (ADR 0017).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
