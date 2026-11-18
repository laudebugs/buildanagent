# A11: The planner role: one capped loop with T0–T2 tools and the clarification pause

| Field | Value |
| --- | --- |
| ID | `A11` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-runs-the-three-roles-as-linked-turns-and-proves-the-workflow-in-a-capstone) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A10](A10-reader-context.md), [A4](A4-read-internal-tools.md), [A7](A7-policy-store-kill-switch.md), [A9](A9-context-taint.md) |
| Size | M |

## Goal

Run the planner as one capped loop that sees trusted metadata, the reader's validated enums and a summary reference, never the raw body, holds only the seven T0–T2 tools, and ends with a typed `PlannerResult` or a clarification pause.

## Context

- [AD1](../../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional): the planner's settings
- [build-agent.md §3.4](../../plans/build-agent.md#34-roles-gates-and-the-workflow): `PlannerResult`, `PLANNER`
- [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg): the planner in the context split

## Scope

**In scope**

- `prompts/planner.md`
- `PLANNER`: seven tools, `clarificationTool()`, `outputTool` for `PlannerResult`, `maxSteps: 8`
- The policy hook, taint hook and kill-switch interceptor wired through a harness extension
- `proposedRefund` returned as data, never executed by the planner
- The planner's turn input (trusted metadata, the reader's enums and the summary reference) written with `inputOrigin: "operator"` (AH14)

**Out of scope** (and which todo covers it)

- Executing a proposed refund (A13)
- The drafter (A12)

## Tasks

- [ ] Assert, with a `ScriptStep` function, that no planner request contains the ticket body.
- [ ] Test the escalation pause and its resume through the harness.

## Acceptance criteria

- [ ] The planner's requests list exactly the seven tools plus the clarification and output tools
- [ ] A scripted `support_escalate` call ends the run `awaiting_approval` with a signed pause entry
- [ ] A ninth step ends the role with `max_steps`
- [ ] The planner's input blocks carry `origin: "operator"`, and A9's taint check reports its session clean
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/roles/planner.test.ts`.

## Docs to update

The README's "Workflow" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

A cap of 8 is our proposal; shadow tunes it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
