# N6: Session runner: SDK events to entries, user entry first

| Field | Value |
| --- | --- |
| ID | `N6` |
| Status | `done` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N5](../done/N5-head-fork-revert.md), [B13](../done/B13-interceptors-observers.md) |
| Size | M |

## Goal

Turn one SDK run into log entries: write the user entry durably before the first model call, then block, result, usage and turn entries from the SDK's end events, so the log is complete without any second store.

## Context

- [N3](../done/N3-session-store.md): the store is keyed by `{ userId, sessionId }`, so pass the session's key on every call; `append` takes entries without `seq` and returns them with it
- [HD1](../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional): the decision and its evidence
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): seams and needs 5 and 12
- [SDK plan §3.4](../../plans/build-sdk.md#34-the-seams-p2-consumes): authoritative end events, header stamp
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): user entry first; model id and loadout on entries; one log per subagent

## Scope

**In scope**

- `runTurn(session, harness, options)` with an `Observer` that appends inside the lock
- `session_header` from `run_start` (`sdkVersion`, `defaultsHash`, `capabilities`)
- `turn_start` with the turn's exact system prompt, `message_block` per block, `message_end`, `usage`, `tool_result`, `turn_end`
- `TurnOptions.inputOrigin` (default `"user"`) as the `origin` of the input blocks (R7)
- Per-turn settings `system`, `tools` (an allowlist of registered names), `output`, `model`, `maxSteps` and `modelOptions` (agent AH1)
- Per-turn `hostContext`, typed by `createHarness<H>()` and passed to the registry's wrapper for that turn (agent AH2)
- Steer and follow-up messages as `message_block` with `delivery`
- `env_stamp` at session start and `loadout` on every model, effort or tool-set change, applied only at turn boundaries
- Running a child session's turn (the link itself is N5's)

**Out of scope** (and which todo covers it)

- Rebuild and resume (N7)
- Approvals (N13)

## Tasks

- [x] Await each append before the observer returns, so a crash loses at most the block being streamed.
- [x] Write the user entries before calling `run()`; test with a model step that throws.
- [x] Record which SDK event produced each entry in a test fixture.

## Acceptance criteria

- [x] A scripted two-step run with one tool call produces the expected entry sequence, checked against a fixture
- [x] Killing the turn before the first model call leaves the user entry in the file
- [x] Two parallel tool results interleave in the log with their own `callId`s
- [x] A model change mid-session is rejected inside a turn and applied with a `loadout` entry at the next turn
- [x] A child session's header names its parent and the spawning call id or step id
- [x] With `inputOrigin: "operator"` the input blocks carry `origin: "operator"`; without it they carry `"user"`
- [x] Two turns on one harness with different `system`, `tools`, `output` and `maxSteps` each send only their own settings (asserted on `ScriptedModel.calls`), and `tools` naming an unregistered tool throws
- [x] Two concurrent turns with different `hostContext` values each see only their own value in `execute`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/runner.test.ts`.

## Docs to update

`packages/harness/README.md`: the event-to-entry table. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Outcome

- Every entry write goes through one serialized queue (`EntryWriter`), because the observer and the permission pipeline's gate both append and must not race for a parent. A failed write aborts the run and `runTurn()` rethrows it.
- Observers don't block the run, so `runTurn()` writes the user entries before `run()`. The session header records `SDK_VERSION`, so the SDK now exports it.
- A child's header carries `parent` (its parent session and link entry) and the new protocol field `spawn` (`spawningCallId` or `stepId`). Its path doesn't cross into the parent, so the child starts fresh.
- Added `onRun` (to steer a run), `turnRetries` and `history` to `TurnOptions`.
- A turn-layer `retry` writes a `usage` entry only.
- Parallel tool results are written in the order the calls end, which can differ from the order the model made them, and each carries its own `callId`.

## Risks and open questions

Depends on §3.6 needs 5 and 12 (post-`afterToolCall` results, receipt fields); if B13 or B16 differ, record the gap in the README and adapt.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
