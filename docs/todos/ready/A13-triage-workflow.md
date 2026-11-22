# A13: `triageTicket()`: linked sessions, the per-ticket budget, handoffs and clarifications

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A13` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-runs-the-three-roles-as-linked-turns-and-proves-the-workflow-in-a-capstone) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A12](A12-drafter-reply-gate.md), [N40](../done/N40-code-initiated-calls.md) |
| Size | M |

## Goal

Compose intake, reader, validation, planner, drafter and the gated actions into `createTriageAgent()`, with one ticket session, the per-ticket budget across roles, every handoff reason and the clarification rule.

## Context

- [AD1](../../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional), [AD9](../../plans/build-agent.md#ad9-one-budget-per-ticket-across-the-three-roles-and-every-budget-stop-hands-the-ticket-to-a-person-accepted) and [AD12](../../plans/build-agent.md#ad12-a-missing-fact-becomes-a-templated-question-through-the-reply-gate-and-missing-authority-becomes-a-handoff-provisional): composition, budget, clarification versus handoff
- [build-agent.md §3.4](../../plans/build-agent.md#34-roles-gates-and-the-workflow): `TriageOutcome`, `HandoffReason`, `TriageAgent`
- [ADR 0028](../../decisions/0028-per-ticket-budget-and-stop-handoff.md)

## Scope

**In scope**

- `createTriageAgent()`, `triage()`, `resolve()`, `pending()`
- One ticket session with child sessions per role
- `TriageAgentOptions.models`, which maps each bundle `ModelRef` and role to a `Model` (R13)
- The remaining budget folded from child `usage` entries and passed per turn, and to `Approvals.resolve()` on resume (R9)
- Every stop (`budget`, unknown price, `max_steps`, `no_progress`, kill switch, denial) mapped to a handoff without retry
- Template questions in `prompts/questions/` sent through the reply gate when `missing` is not empty
- The code-initiated triage write and the gated refund for `proposedRefund`, through `Harness.invokeTool()` (N40)
- The `TriageRecord` and each handoff stored as `product_record` entries, and the bundle hash on `session_header.product` (AH8)

**Out of scope** (and which todo covers it)

- The bundle hash (A14)
- Rollout stages (A22)

## Tasks

- [ ] Write one test per `HandoffReason`.
- [ ] Resume a paused ticket through `resolve()` from a fresh agent instance on the same store.

## Acceptance criteria

- [ ] Each `HandoffReason` has a test that reaches it and writes one `handoff` to the fake
- [ ] A budget stop in the drafter hands off and makes no further model call
- [ ] A ticket with `missing: ["order_id"]` produces a templated question that pauses for approval
- [ ] `createTriageAgent({ models })` with a `models` function returning `ScriptedModel`-backed models runs a ticket end to end, and each role's requests reach the model its bundle names
- [ ] A resumed ticket whose remaining budget is below the next call's projection hands off with `budget`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/workflow/*.test.ts`.

## Docs to update

The README's "Workflow" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None open. Product records are harness N2's `product_record` entries (AH8).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
