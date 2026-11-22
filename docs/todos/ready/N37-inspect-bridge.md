# N37: Inspect bridge and the baseline runner (opt-in)

| Field | Value |
| --- | --- |
| ID | `N37` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N36](N36-eval-reports-replay.md), [N17](../done/N17-docker-backend.md) |
| Size | M |

## Goal

Drive the unmodified harness from Inspect through `sandbox_agent_bridge()`, run mini-swe-agent on the same task under the same limits, and write both as `EvalRow`s, outside `pnpm test`.

## Context

- [harness guide §10](../../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate): Inspect's bridge, `forward_generation_config`, isolated grader
- [HD8](../../plans/build-harness.md#hd8-a-30-task-seed-suite-of-20-repository-and-10-coding-agent-tasks-at-k--5-accepted-amended): the decision and its evidence
- [observability note §7](../../research/agent-harness/notes/observability-and-evals.md#7-eval-design-tasks-from-real-failures-outcome-graders-clean-trials-held-fixed-comparisons): eval design

## Scope

**In scope**

- `packages/evals/inspect/harness_task.py` and an exact-pinned `requirements.txt` (`inspect-ai` and `mini-swe-agent` 2.4.6)
- Our CLI in the Docker sandbox image, with the gateway's `baseURL` pointed at the bridge's local proxy
- `forward_generation_config=True`
- Graders outside the agent's writable sandbox; a clean workspace per trial with no earlier git history
- Resource guarantees and kill limits from HD8, recorded per row
- A `pnpm --filter @buildanagent/evals eval:live` script that refuses to start without an explicit budget flag

**Out of scope** (and which todo covers it)

- Choosing and running the seed suite (N38)

## Tasks

- [ ] Pick `inspect-ai` at a release at least a week old.
- [ ] Prove the wiring offline first: point the bridge at the gateway's `startMockServer()` and run one task end to end.

## Acceptance criteria

- [ ] One task runs end to end offline against the mock server and writes rows for both harnesses
- [ ] The live script exits non-zero without `--budget-usd`
- [ ] The bridge and mini-swe-agent are spawned with `spawnEnv()` plus the bridge's proxy URL and a dummy key, and no real provider key reaches either (a test records each spawn's environment)
- [ ] A grader file written by the agent is not the one the grader reads (test)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The offline end-to-end task; live runs are manual.

## Docs to update

`packages/evals/README.md`: running evals. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Python toolchain drift; the pinned `requirements.txt` and a lock hash contain it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
