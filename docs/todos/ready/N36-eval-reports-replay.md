# N36: Eval package: reports, mini-swe-agent trajectories and the offline replay suite

| Field | Value |
| --- | --- |
| ID | `N36` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-telemetry-completion-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N35](N35-harness-capstone.md) |
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
- `discordance()` between two runs
- `toMiniSweTrajectory()` in format `mini-swe-agent-1.1`
- The offline replay suite in `pnpm test`, using N35's fixtures through `replayPairs()`

**Out of scope** (and which todo covers it)

- Inspect and live runs (N37)

## Tasks

- [ ] Check the pass^k estimator against hand-computed values for n = 5.

## Acceptance criteria

- [ ] `report()` on a fixture of 10 rows matches a hand-computed table
- [ ] A converted trajectory has `instance_cost`, `api_calls` and `exit_status` filled
- [ ] The replay suite runs offline and fails when an entry changes
- [ ] Rows with `exit: "infra_error"` are counted apart from failures
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/evals/test/*.test.ts`.

## Docs to update

`packages/evals/README.md`: the report format. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
