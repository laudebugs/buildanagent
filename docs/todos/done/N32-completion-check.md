# N32: Completion check and diff flags (HD10)

| Field | Value |
| --- | --- |
| ID | `N32` |
| Status | `done` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md), [N6](../done/N6-session-runner.md) |
| Size | M |

## Goal

Check completion in code: after a `done` result, run the project's configured or discovered checks inside the sandbox, flag diff patterns that game the checks, and record the check results and the flags in one entry.

## Context

- [HD10](../../plans/build-harness.md#hd10-configured-or-discovered-checks-run-in-the-sandbox-after-done-with-flags-recorded-provisional): the decision and its evidence
- [harness guide §10](../../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate): completion checked in code, not taken from the model

## Scope

**In scope**

- `completionChecks` in `.agents/harness.json`; otherwise `package.json` `typecheck`, `test`, `check`, then a `Makefile` `test`
- Checks run in the session's sandbox with a timeout
- A diff against the turn's start state, with the HD10 flag patterns
- A `completion_check` entry and a protocol event; no change to the stop reason

**Out of scope** (and which todo covers it)

- Tuning the patterns on recorded false claims (N38)

## Tasks

- [x] Use `fakeSandbox()` in tests with scripted exit codes and a scripted diff.

## Acceptance criteria

- [x] A project with only a `test` script runs `test` and records its exit code
- [x] A diff adding `it.skip(` is flagged and the run still ends `done`
- [x] A deleted test file and a test file with fewer `expect` lines are both flagged
- [x] Configured checks replace discovery
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/completion/check.test.ts`.

## Docs to update

`packages/harness/README.md`: configuring checks. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Pattern flags will have false positives; they are recorded, never fatal.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The check is in `packages/harness/src/completion/` and the 33 tests in `test/completion/check.test.ts` cover the acceptance criteria. The plan's N32 revision says where it is exported.

- **Wiring.** `runTurn()` takes `completion: { sandbox, env, timeoutMs?, snapshotter? }` and `onCompletionCheck`. The start state is snapshotted before every turn, not only those that end `done`, because the turn's end is unknown when it starts. A `done` turn runs the checks and writes a `completion_check` entry after `turn_end`; the stop reason never changes. See the [README](../../../packages/harness/README.md) and [HD10's N32 revision](../../plans/build-harness.md#hd10-configured-or-discovered-checks-run-in-the-sandbox-after-done-with-flags-recorded-provisional).
- **Checks.** `resolveChecks()` reads `completionChecks` from `.agents/harness.json`, else discovers `typecheck`, `test` and `check`, then `make test`; each check has a 10-minute default timeout (exit 124), a refusal is exit 126 and an abort is exit 130, each with a flag. See the [README](../../../packages/harness/README.md#configure-the-checks-in-agentsharnessjson).
- **Flags.** The patterns are the plan's list and no others, and a list of more than 100 flags is cut. See [HD10's N32 revision](../../plans/build-harness.md#hd10-configured-or-discovered-checks-run-in-the-sandbox-after-done-with-flags-recorded-provisional).
- **Diff.** `gitSnapshotter` compares two snapshots of the files `git ls-files` lists, and a skipped file is never reported as deleted. See [HD10's N32 revision](../../plans/build-harness.md#hd10-configured-or-discovered-checks-run-in-the-sandbox-after-done-with-flags-recorded-provisional).
- **Tests.** A thin wrapper over `fakeSandbox()` scripts `npm run test` and `git ls-files`, and a scripted snapshotter is the scripted diff.
- **Review fixes.**
  - The checks are resolved, and the check config read, before the model runs, and the commands resolved then are the ones that run.
  - An edit during the turn to `.agents/harness.json`, to a `typecheck`, `test` or `check` script, to any script a check runs through `npm`, `pnpm`, `yarn` or `bun` or its `pre`/`post` hook, or to the `Makefile` `test` rule gets a `check config changed` flag, a kind added to HD10's list as a documented revision.
  - A check that can't do its work (a bad config, a sandbox error, a disposed sandbox, a start snapshot that throws) is recorded as a `completion check failed` flag instead of making `runTurn()` throw.
  - Diff: only a read that fails with `sandbox_not_found` counts as a deleted file; a deleted fixture in a test folder is not a deleted test file; the snapshot's listing and reads stop after 60 seconds.
  - Aborts: no check starts after an abort, and a check the signal aborted is recorded as aborted whatever the sandbox returned.
  - Store: a refused `completion_check` append leaves the `done` result as it was.
- **Not done.** N38 tunes the patterns on recorded false claims. `resumeTurn()` runs no completion check, so a turn that pauses for an approval and then ends `done` goes unchecked.
