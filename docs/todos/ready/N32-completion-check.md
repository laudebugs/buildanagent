# N32: Completion check and diff flags (HD10)

| Field | Value |
| --- | --- |
| ID | `N32` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](N15-sandbox-interface.md), [N6](N6-session-runner.md) |
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

- [ ] Use `fakeSandbox()` in tests with scripted exit codes and a scripted diff.

## Acceptance criteria

- [ ] A project with only a `test` script runs `test` and records its exit code
- [ ] A diff adding `it.skip(` is flagged and the run still ends `done`
- [ ] A deleted test file and a test file with fewer `expect` lines are both flagged
- [ ] Configured checks replace discovery
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/completion/check.test.ts`.

## Docs to update

`packages/harness/README.md`: configuring checks. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Pattern flags will have false positives; they are recorded, never fatal.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
