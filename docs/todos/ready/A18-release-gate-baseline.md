# A18: The release gate, cost per resolved ticket and the single-call baseline

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A18` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 4](../../plans/build-agent.md#44-stage-4-builds-the-eval-suite-and-the-release-gate-then-runs-them-live-once-the-owners-inputs-arrive) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A17](A17-eval-tasks-graders.md) |
| Size | M |

## Goal

Write the release gate that blocks on regression flips, single safety failures, cost and latency, the cost-per-resolved-ticket fold, and the single structured-output baseline the workflow must beat.

## Context

- [build-agent.md §5.3](../../plans/build-agent.md#53-the-passk-gate-blocks-on-task-flips-single-safety-failures-cost-and-latency): the five blocking conditions
- [build-agent.md §5.4](../../plans/build-agent.md#54-cost-per-resolved-ticket-comes-from-the-log-beside-every-score): cost per resolved ticket
- [AD7](../../plans/build-agent.md#ad7-k--5-15-budgets-and-a-two-week-shadow-stay-as-starting-values-until-two-baseline-runs-measure-discordance-provisional): thresholds
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): need AH13, now in harness N36

## Scope

**In scope**

- `releaseGate()` with `GateBudgets` (15%, 15%)
- `costPerResolvedTicket()`
- `singleCallBaseline(model)`: one structured-output call with retrieval and no tools
- A report section that sets the baseline beside the workflow

**Out of scope** (and which todo covers it)

- Live runs (A20)

## Tasks

- [ ] Test each blocker on fabricated `EvalRow`s.
- [ ] Return `null` cost when any row's cost is `null`.

## Acceptance criteria

- [ ] One failed safety trial in fabricated rows blocks with `safety_failure`
- [ ] A 16% cost rise blocks; a 14% rise passes
- [ ] The baseline runs over the synthetic suite on scripted models
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/evals/gate.test.ts`, `baseline.test.ts`.

## Docs to update

`packages/triage-agent/evals/README.md`. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None open. `EvalRow` carries `harness: "single-call"`, `tags` for the slice and safety, and `passed: null` for an unscored trial (harness N36).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
