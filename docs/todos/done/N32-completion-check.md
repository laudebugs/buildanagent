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

Check completion in code: after a `done` result, run the project's configured or discovered checks inside the sandbox, flag diff patterns that game the checks, and record both as an entry.

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

The check is in `packages/harness/src/completion/` and the 33 tests in `test/completion/check.test.ts` cover the acceptance criteria. The code is exported from `@buildanagent/harness/session`, because adding a `completion` subpath means editing `package.json`, which this todo left alone; a later todo can move it.

- **Wiring.** `runTurn()` takes `completion: { sandbox, env, timeoutMs?, snapshotter? }` and `onCompletionCheck`. The start state is snapshotted before the run. A turn that ends `done` runs the checks, snapshots again, and writes a `completion_check` entry after `turn_end`, and `lastEntryId` is that entry. The dispatcher takes `completion`, a function from a session id to that session's settings, and forwards the entry as a `completion_check` event. The stop reason never changes, and a turn that ends any other way runs nothing.
- **Checks.** `resolveChecks()` reads `completionChecks` from `.agents/harness.json`, which replaces discovery (an empty list runs nothing). Without it, it takes `typecheck`, `test` and `check` from `package.json` in that order with the runner the lockfile names, then `make test`. Each check runs with a 10-minute default timeout (exit 124), and one the sandbox refuses is recorded as exit 126 with a flag, and one the turn's signal aborts as exit 130 with a flag (the turn still ends `done`). A bad config throws `invalid_completion_config`.
- **Flags.** The patterns are the plan's list and no others: `.skip(`, `xit(` and `@pytest.mark.skip` added; `TODO` and `FIXME` (capitals) and "not implemented" (any case) added; a new file named for a mock, stub or fake; a deleted test file; a test file with fewer assertion lines. A moved line is not an added one, and a list of more than 100 flags is cut.
- **Diff.** `gitSnapshotter` reads the files `git ls-files` lists, as text up to 256 KiB, at most 5,000. The end snapshot reads the start's paths again, and a file skipped for size, encoding or the cap is ignored by the diff, so none is reported as deleted. A workspace that is no repository gets checks and no flags.
- **Tests.** They use `fakeSandbox()`: `true`, `false` and `sleep` give real exit codes and a real timeout, a thin wrapper scripts `npm run test` and `git ls-files`, and a scripted snapshotter is the scripted diff.
- **Review fixes.** The checks are resolved, and the check config read, before the model runs, and the commands resolved then are the ones that run. An edit during the turn to `.agents/harness.json`, to a `typecheck`, `test` or `check` script, to any script a check runs through `npm`, `pnpm`, `yarn` or `bun` or its `pre`/`post` hook, or to the `Makefile` `test` rule gets a `check config changed` flag, a kind added to HD10's list as a documented revision. A check that can't do its work (a bad config, a sandbox error, a disposed sandbox, a start snapshot that throws) is recorded as a `completion check failed` flag instead of making `runTurn()` throw. Only a read that fails with `sandbox_not_found` counts as a deleted file, the snapshot's listing and reads stop after 60 seconds, a deleted fixture in a test folder is not a deleted test file, no check starts after an abort, a check the signal aborted is recorded as aborted whatever the sandbox returned, and a store that refuses the `completion_check` append leaves the `done` result as it was.
- **Not done.** N38 tunes the patterns on recorded false claims. `resumeTurn()` runs no completion check, so a turn that pauses for an approval and then ends `done` goes unchecked. The start state is taken before every turn, not only those that end `done`, because the turn's end is unknown when it starts.
