# N7: Context rebuild, resume, playback and re-run from an entry

| Field | Value |
| --- | --- |
| ID | `N7` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N6](N6-session-runner.md), [B15b](B15b-continue-run.md) |
| Size | M |

## Goal

Make the log the only state: rebuild the SDK `Context` from entries in any process, play a session back with no calls, and re-run from any entry on a new branch.

## Context

- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): playback versus re-run; replay needs model id and loadout
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): need 6 (constructible `Context`)
- [SDK D10](../../plans/build-sdk.md#d10-a-discriminated-result-union-plus-runorthrow-for-callers-who-want-exceptions): the resumable context on every result

## Scope

**In scope**

- `Session.toContext(headId?)` that rebuilds `Context` (`system`, `messages`, `pending`) from entries, taking `system` from the latest `turn_start`
- `Session.playback()` and a byte-identical determinism test
- `Session.rerunFrom(entryId, options)`, which checks out the entry and starts a new turn
- Resume after a crash mid-turn: open tool calls get an aborted error result entry

**Out of scope** (and which todo covers it)

- Approval resolution on resume (N13)
- Compaction-aware rebuild (N9 extends `toContext`)

## Tasks

- [ ] Group `message_block` entries by `messageId` and order blocks by `index`.
- [ ] Compare `toContext()` with the `context` of the original `RunResult` in a test.
- [ ] Run the determinism test with `fixedClock`, `sequentialIds` and the same script twice.

## Acceptance criteria

- [ ] `toContext()` deep-equals the `RunResult.context` of the run that wrote the log
- [ ] After the harness's configured system prompt changes, a rebuilt `Context.system` still matches the stored turn's prompt byte for byte (R6)
- [ ] `continueRun` on a `toContext()` result, after a JSON round trip, finishes the scripted run
- [ ] Playback makes zero model and tool calls (asserted with `ScriptedModel.calls`)
- [ ] Two identical scripted sessions produce byte-identical JSONL files
- [ ] A re-run from an entry leaves the original branch's entries unchanged
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/rebuild.test.ts`, `playback.test.ts`, `rerun.test.ts`.

## Docs to update

`packages/harness/README.md`: the two replay modes. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If §3.6 need 6 is refused, keep a serialised `Context` snapshot entry per turn and record the cost.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
