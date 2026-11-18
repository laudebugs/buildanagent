# A17: Eval task format, the seven graders and 30 synthetic tickets

| Field | Value |
| --- | --- |
| ID | `A17` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 4](../../plans/build-agent.md#44-stage-4-builds-the-eval-suite-and-the-release-gate-then-runs-them-live-once-the-owners-inputs-arrive) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A15](A15-agent-capstone.md), [N36](N36-eval-reports-replay.md) |
| Size | M |

## Goal

Define the triage eval task, write a grader for each of the seven slices, and commit 30 synthetic tickets that exercise them offline, so the eval machinery is tested before any real ticket or model is involved.

## Context

- [build-agent.md §5.2](../../plans/build-agent.md#52-the-30-ticket-suite-runs-twice-synthetic-in-pnpm-test-real-in-the-opt-in-eval-job): the slices and graders
- [agent guide §6](../../guides/agent.md#6-evals-30-real-tickets-graded-on-final-state-released-on-passk-with-cost-beside-every-score): final-state grading, grader failure modes, the Unknown verdict
- [build-agent.md §3.5](../../plans/build-agent.md#35-evals-and-rollout): `TriageTask`, `grade()`

## Scope

**In scope**

- `TriageTask` and its JSON format
- Graders: exact match, approval-queue state plus reason rubric, `subset` trajectory, lookup discipline, rubric judge with Unknown, no-state-change, simulator product
- 30 synthetic tickets in `evals/synthetic/`, ten of them classification
- A scripted model per task, and a scripted judge for the rubric graders

**Out of scope** (and which todo covers it)

- Real tickets and labels (A19)
- The gate (A18)

## Tasks

- [ ] Normalise names, ids and formatting before code grading.
- [ ] Make an unparsable judge verdict `unscored`, never a fail.

## Acceptance criteria

- [ ] Each slice has at least one passing and one failing synthetic case
- [ ] A scripted unparsable judge verdict yields `unscored`
- [ ] The 30 synthetic tasks run in `pnpm test` in under 60 seconds
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/evals/graders.test.ts`, `synthetic-suite.test.ts`.

## Docs to update

`packages/triage-agent/evals/README.md`. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

Synthetic tickets test code, not model behaviour (§5.2).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
