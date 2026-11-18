# N38: Seed suite and the first baseline run (HD8)

| Field | Value |
| --- | --- |
| ID | `N38` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N37](N37-inspect-bridge.md) |
| Size | M |

## Goal

Assemble the 20 repository tasks of HD8's accepted seed suite, run them at k = 5 on our harness and on mini-swe-agent, and publish the first report with discordance, so every later change has a baseline. N38b adds the 10 shared triage tasks once Round A has them.

## Context

- [HD8](../../plans/build-harness.md#hd8-a-30-task-seed-suite-from-real-failures-and-triage-tasks-at-k--5-accepted): the decision and its evidence
- [HD10](../../plans/build-harness.md#hd10-configured-or-discovered-checks-run-in-the-sandbox-after-done-with-flags-recorded-provisional): tuning the completion flags
- [harness guide §10](../../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate): 20–50 real-failure tasks; what they can and cannot detect

## Scope

**In scope**

- 20 tasks recreated from this repository's history (a fix commit's parent, graded by the check it fixed)
- A live budget check: the run starts only with the owner's `--budget-usd`, within HD8's $3 per-trial cap
- Two runs of the same configuration for discordance
- `packages/evals/results/<date>-baseline.md` with the report
- Recorded sessions whose completion claims were false, used to tune HD10's patterns

**Out of scope** (and which todo covers it)

- Ablations (N39)
- The 10 shared triage tasks (N38b, after A17 and A19)

## Tasks

- [ ] Get the owner's budget for the live run; HD8's task source, k and per-trial cap are already accepted.
- [ ] Exclude tasks whose fix commit touched secrets or network-only checks.

## Acceptance criteria

- [ ] The 20-task list, with source commit and grader per task, is committed
- [ ] The report lists pass@1, pass^5, cost, tokens, steps and preamble size per task for both harnesses, with Wilson intervals
- [ ] Discordance between the two same-configuration runs is reported and used to size the regression suite
- [ ] HD10's flag patterns are updated, with before and after counts on the false claims
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

None in `pnpm test`; the report is the output.

## Docs to update

The results file; HD8's status in the plan through P4 or a follow-up. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Live cost; the owner sets the cap.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
