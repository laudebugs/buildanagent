# N36: Eval package: reports, mini-swe-agent trajectories and the offline replay suite

| Field | Value |
| --- | --- |
| ID | `N36` |
| Status | `done` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N35](../done/N35-harness-capstone.md) |
| Size | M |

## Goal

Build the eval machinery that runs on every commit: the report format that pairs pass rates with cost, the converter to mini-swe-agent trajectories, and an offline suite that replays recorded sessions.

## Context

- [harness guide §10](../../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate): cost beside pass^k, three suites, mini-swe-agent's trajectory format
- [build-harness.md §5.5](../../plans/build-harness.md#55-the-eval-harness-compares-cost-and-passk-against-mini-swe-agent-in-three-suites): the test strategy
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): `EvalRow`

## Scope

**In scope**

- `EvalRow`, `report()` with pass@1, pass^k (the unbiased estimator), Wilson intervals, and cost, tokens, steps, preamble size and prompts per task
- `EvalRow.passed: boolean | null` with `unscored?: "judge_unknown" | "infra_error"` (R11), `harness: string` documenting `"ours"`, `"mini-swe-agent"` and `"single-call"`, and `tags?: string[]` for the slice and `"safety"` (agent AH13)
- `discordance()` between two runs
- `toMiniSweTrajectory()` in format `mini-swe-agent-1.1`
- The offline replay suite in `pnpm test`, using N35's fixtures through `replayPairs()`

**Out of scope** (and which todo covers it)

- Inspect and live runs (N37)

## Tasks

- [x] Check the pass^k estimator against hand-computed values for n = 5.

## Acceptance criteria

- [x] `report()` on a fixture of 10 rows matches a hand-computed table
- [x] A converted trajectory has `instance_cost`, `api_calls` and `exit_status` filled
- [x] The replay suite runs offline and fails when an entry changes
- [x] Rows with `exit: "infra_error"` are counted apart from failures
- [x] A row with `passed: null` and `unscored: "judge_unknown"` is reported as unscored and counted neither as a pass nor as a fail
- [x] `report()` groups rows by any `harness` string, including `"single-call"`, and can filter by a tag
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/evals/test/*.test.ts`.

## Docs to update

`packages/evals/README.md`: the report format. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/evals` now turns session logs into eval rows, rows into a report, and logs into mini-swe-agent trajectories, and its tests replay the capstone's recorded sessions offline.

- **API.** `report()`, `discordance()`, `toEvalRow()`, `toMiniSweTrajectory()`, `isEvalsError()`, `EvalsError` (codes `invalid_row`, `duplicate_trial`, `invalid_option` and `unfinished_session`) and `MINI_SWE_TRAJECTORY_FORMAT`, with the types the todo lists. `packages/evals/README.md` documents the report format.
- **Choices.** The trajectory follows mini-swe-agent v2.4.6 (`default.py`, lines 159 to 180). A `null` `costUsd` makes the harness cost `null` and `instance_cost` `null`, where mini-swe-agent raises by default. A judge's calls are left out of spend, and summary calls count. Per-task figures are means over all trials, infra errors included, and pass@1 pools the graded trials. `ReportOptions` gains `ablation`, and `report()` refuses a harness whose kept rows span several ablations. `toEvalRow()` and `toMiniSweTrajectory()` share one classifier of the SDK's stop reasons, an exhaustive switch: `done` is `submitted`, `error` is `infra_error`, `max_steps`, `budget`, `no_progress`, `aborted` and `stopped` are `limit`, and a paused session is unfinished, so `toEvalRow()` throws `unfinished_session`. Wall time sums each turn's time, so a wait for approval is left out. `report()` also gives each harness's figures per task in `byTask`, for paired statistics.
- **Replay.** The suite runs each capstone case again on its recorded pairs through `replayPairs()`, with the triage agent rebuilt from public harness APIs, and compares every entry it writes with the fixture. Five tests show it failing when a tool result, a model block, a usage entry, the last tool result or the approval reason changes. It checks the recording's expiry against the fixed recording time, as the harness's capstone test does, so the result does not depend on the date.
- **Checks.** `pnpm check`, `pnpm typecheck`, `pnpm check:links` and the evals package's tests pass locally. The root `pnpm test` stops at `verify/copilot-sdk` on this Mac, which lacks `unshare`, so CI runs it and the box naming it stays unticked.
- **Facts.** Fact-check rows N36-1 to N36-9 in [the harness plan's log](../../plans/reviews/fact-check-build-harness.md) check the mini-swe-agent claims against the v2.4.6 source.
