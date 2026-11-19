# N7: Context rebuild, resume, playback and re-run from an entry

| Field | Value |
| --- | --- |
| ID | `N7` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N6](N6-session-runner.md), [B15b](B15b-continue-run.md), [E2](../done/E2-effect-identity-crash-rule.md) |
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

## Revision (2026-11-18, SDK gaps)

Gap 2 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) changes the crash rule for writes. A write whose call entry exists without a result must not get an "aborted error result"; the rewind report explains that such a result cannot say whether the effect happened ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#our-sdks-and-plans-rewind-the-conversation-and-roll-back-no-data)). Add:

- [ ] On resume, an open call to a tool that declares itself a write gets a result with `outcome.kind: "unknown"` and `retry: "reconcile_first"`, not an aborted error; read-only tools keep the aborted error.
- [ ] A resumed run whose model re-proposes the same write reaches the same effect key and sends nothing twice (the fake system counts requests per key).
- [ ] The `EffectScope` passed to E2 takes `tenant` from the harness config, a plain string whose default is `"local"` for single-user hosts, plus the session key, the branch and the tool call id ([build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api); added in plan review 2, 2026-11-19).

The effect key and store come from the safety package's [E2](../done/E2-effect-identity-crash-rule.md), and a tool declares itself a write through the `effect` field the [B10](../done/B10-tool-runtime.md) revision adds. The owner accepted SG3 on 2026-11-18, so E2 is in **Depends on**.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
