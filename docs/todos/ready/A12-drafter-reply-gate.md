# A12: The drafter role, the reply gate and the approval card

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A12` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-runs-the-three-roles-as-linked-turns-and-proves-the-workflow-in-a-capstone) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A11](A11-planner-context.md), [A5](A5-outbound-money-tools.md), [A8](A8-role-based-quorum.md), [N13](../done/N13-signed-approvals.md), [N40](../done/N40-code-initiated-calls.md) |
| Size | M |

## Goal

Run the tool-less drafter on the raw ticket and the requester's own records, send its draft through the outbound checks and a code-initiated T3 call that always asks one person, and build the approval card that shows the exact text, the taint and the quorum.

## Context

- [AD1](../../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional): code-initiated calls
- [AD11](../../plans/build-agent.md#ad11-every-reply-needs-a-person-in-v1-and-the-template-only-path-waits-for-a-zero-leak-corpus): every reply asks a person
- [build-agent.md §3.4](../../plans/build-agent.md#34-roles-gates-and-the-workflow): `DRAFTER`, `ApprovalCard`, `approvalCard()`
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): needs AS1 and AH4, now in SDK B15 and harness N40

## Scope

**In scope**

- `prompts/drafter.md`; `DRAFTER` with no tools but the output tool
- The code-initiated `support_send_reply` call through `Harness.invokeTool()` (N40)
- `approvalCard()`: canonical text, input hash, rule, tier, affected requester, taint sources, outbound flags, quorum state
- An edited draft re-enters the pipeline as a new input

**Out of scope** (and which todo covers it)

- Template questions for clarifications (A13)

## Tasks

- [ ] Write `prompts/drafter.md` and `DRAFTER`, and run the drafter as a harness turn in its own child session.
- [ ] Pass the checked draft to `Harness.invokeTool()` as a `support_send_reply` call, and return its `awaiting_approval` result.
- [ ] Build `approvalCard()` from the pending request, the `code_call` entry and the drafter's session taint.

## Acceptance criteria

- [ ] Every reply pauses for approval in every stage
- [ ] The card's text equals the text the fake helpdesk receives after approval, plus the AI label
- [ ] An edited draft gets a new input hash and a new pause
- [ ] The reply runs only after `Approvals.resolve()` meets the quorum, and the log holds `code_call`, `approval_requested`, `approval_resolved` and `tool_result` entries for it
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/roles/drafter.test.ts`, `test/gates/card.test.ts`.

## Docs to update

The README's "Approvals" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None open. P4 placed AH4 in harness N40, which this todo depends on.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
