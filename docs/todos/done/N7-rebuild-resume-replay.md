# N7: Context rebuild, resume, playback and re-run from an entry

| Field | Value |
| --- | --- |
| ID | `N7` |
| Status | `done` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N6](../done/N6-session-runner.md), [B15b](../done/B15b-continue-run.md), [E2](../done/E2-effect-identity-crash-rule.md) |
| Size | M |

## Goal

Make the log the only state: rebuild the SDK `Context` from entries in any process, play a session back with no calls, and re-run from any entry on a new branch.

## Context

- [N3](../done/N3-session-store.md): the store is keyed by `{ userId, sessionId }`, so pass the session's key on every `load`
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

- [x] Group `message_block` entries by `messageId` and order blocks by `index`.
- [x] Compare `toContext()` with the `context` of the original `RunResult` in a test.
- [x] Run the determinism test with `fixedClock`, `sequentialIds` and the same script twice.

## Acceptance criteria

- [x] `toContext()` deep-equals the `RunResult.context` of the run that wrote the log
- [x] After the harness's configured system prompt changes, a rebuilt `Context.system` still matches the stored turn's prompt byte for byte (R6)
- [x] `continueRun` on a `toContext()` result, after a JSON round trip, finishes the scripted run
- [x] Playback makes zero model and tool calls (asserted with `ScriptedModel.calls`)
- [x] Two identical scripted sessions produce byte-identical JSONL files
- [x] A re-run from an entry leaves the original branch's entries unchanged
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/rebuild.test.ts`, `playback.test.ts`, `rerun.test.ts`.

## Docs to update

`packages/harness/README.md`: the two replay modes. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Outcome

All the criteria hold, with one limit: the first holds only for a run that didn't pause, because a paused run's `context.pending` and `pendingInputs` are in no entry until N13 records them.

- A rebuilt message needs the usage of its final attempt, so the protocol's `usage` entry gained `lastAttemptUsage`; a retried call's message carries it. The rebuilt context deep-equals the run's, so no per-turn snapshot entry is needed.
- `runTurn()` takes `history` from the log when the caller gives none, so the conversation lives only in the log.
- `rerunFrom` is a function next to `runTurn`, not a `Session` method, because it needs the harness. It refuses an entry that follows an open call.
- Resume settles open calls in `runTurn()` before it writes anything. The unknown outcome comes from the safety package's `renderOutcome`, so the harness now depends on `@buildanagent/agent-safety`. A message with blocks and no end is ended as `tool_calls`, because the gateway drops an aborted message with the results that answer its calls.
- A turn that ended paused leaves its calls open, and a later turn without its own `history` refuses to start while any call is open.
- `Harness.tenant` (default `local`) and `effectScope()` give the `EffectScope`. The scope's `branch` is the log's file plus its latest checkout, so a re-run gets a branch of its own.
- `TurnOptions.clock` and `newId` make a turn deterministic.
- Out of scope, with its owner: approvals that a crash left waiting (N13), and a crash in the middle of a `guardedWrite` whose record stayed `started`.

## Risks and open questions

If §3.6 need 6 is refused, keep a serialised `Context` snapshot entry per turn and record the cost.

## Revision (2026-11-18, SDK gaps)

Gap 2 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) changes the crash rule for writes. A write whose call entry exists without a result must not get an "aborted error result"; the rewind report explains that such a result cannot say whether the effect happened ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#our-sdks-and-plans-rewind-the-conversation-and-roll-back-no-data)). Add:

- [x] On resume, an open call to a tool that declares itself a write gets a result with `outcome.kind: "unknown"` and `retry: "reconcile_first"`, not an aborted error; read-only tools keep the aborted error.
- [x] A resumed run whose model re-proposes the same write reaches the same effect key and sends nothing twice (the fake system counts requests per key).
- [x] The `EffectScope` passed to E2 takes `tenant` from the harness config, a plain string whose default is `"local"` for single-user hosts, plus the session key, the branch and the tool call id ([build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api); added in plan review 2, 2026-11-19).

The effect key and store come from the safety package's [E2](../done/E2-effect-identity-crash-rule.md), and a tool declares itself a write through the `effect` field the [B10](../done/B10-tool-runtime.md) revision adds. The owner accepted SG3 on 2026-11-18, so E2 is in **Depends on**.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
