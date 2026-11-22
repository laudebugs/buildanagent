# N10: Layers 4 and 5: mid-turn compaction and the overflow retry

| Field | Value |
| --- | --- |
| ID | `N10` |
| Status | `done` |
| Plan | [Build harness §4, Stage 2](../../plans/build-harness.md#42-stage-2-adds-the-five-context-layers-cheapest-first) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N9](N9-summary-layer.md), [N7](../done/N7-rebuild-resume-replay.md) |
| Size | M |

## Goal

Add the two remaining triggers: compact inside a turn when the next call would cross 90% of the window, and on a provider overflow compact once and retry, then end with an in-band error.

## Context

- [harness guide §3](../../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible): layers 4 and 5; overflow classification per provider
- [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional): the decision and its evidence
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): needs 3 and 4

## Scope

**In scope**

- `mid_turn` in `transformContext`, on by default only for windows under 128K
- `ContextPolicy.onOverflow()`: one compaction, then `continueRun` on the rebuilt context
- A `compaction` entry with `layer` set for each
- An end with the SDK's `error` stop reason after the single retry fails

**Out of scope** (and which todo covers it)

- Per-provider overflow classifiers (the SDK adapters own `error.kind`)

## Tasks

- [x] Script a model step that returns `error.kind: "overflow"`, then a success.
- [x] If need 4 is not yet in the SDK, end the turn and start a new one from the rebuilt context, and note it in the README.
- [x] Apply [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)'s append-only rule for signed thinking (plan review 2, 2026-11-19) to mid-turn and overflow compaction: the rebuilt request drops every thinking block after the edit point.

## Acceptance criteria

- [x] A 100K-window scripted session compacts mid-turn once when crossing 90%
- [x] A 1M-window session does not compact mid-turn by default
- [x] An overflow error leads to exactly one compaction and one retry; a second overflow ends the turn with `stopReason: "error"`
- [x] After a mid-turn or overflow compaction on an Anthropic model with preserved thinking, the retried request carries no thinking block after the edit point
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/context/mid-turn.test.ts`, `overflow.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Depends on §3.6 needs 3 and 4; the fallback above keeps the todo unblocked.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Layers 4 and 5 are in `@buildanagent/harness/context`. The 14 tests in `test/context/mid-turn.test.ts` and `overflow.test.ts` cover the acceptance criteria: a 100,000-token window and a 3,000-token window compact mid-turn once, and a 1M-token window does not.

- **Mid-turn.** `MidTurn` in `mid-turn.ts` compacts inside `transformContext`. The SDK keeps the run's whole transcript, so the compaction changes the view: the summary, the kept tail and what the run adds. The first call that would pass `midTurnRatio` (0.9) of the window summarises, writes a `compaction` entry (`layer: "mid_turn"`), and the view stays compacted for the rest of the turn. The layer is on by default only below a 128K window (`layers.mid_turn` overrides). To name the entry each message starts at, the layer waits for the recorder's queued entries, which `TurnContext.attach()` makes possible by giving it the turn's writer. It skips with a log record when the log and the transcript do not line up.
- **Overflow.** `runTurn()` retries once. When the run ends `error` with `error.kind: "overflow"`, `onOverflow()` compacts (forced, layer `overflow_retry`) and `continueRun()` goes on from the rebuilt context. Need 4 is in the SDK: a context whose last response ended in an error asks the model again, so the fallback of ending the turn was not needed. The retry runs in the same `runTurn()` call, so the dispatcher still sends one `turn/settled`.
- **Signed thinking.** The mid-turn view and the rebuilt context drop signed reasoning from the messages before the compaction and keep what the run wrote after it. On an Anthropic model with thinking, the last assistant message of a tool loop then loses its thinking block, which Anthropic can reject. HD3's rule 4, the adapter's `drop_block` retry, is the answer there, and N39 measures its cost.
- **Review fixes, results.** The turn's result adds the first attempt's steps, usage and cost to the retry's, and the retry gets what the first left of `maxSteps`. After a mid-turn compaction, the last response's usage counts again from the first response made under the new view. A rejected summary's `usage` entry is reflected in the result's `lastEntryId`.
- **Review fixes, limits and order.** A turn given its own `history` has no mid-turn compaction or retry. The retry does not compact mid-turn again. `midTurnRatio` must lie between 0 and 1. The policy's `transformContext` runs before the harness's own, so it indexes the run's transcript; the plan and README record that order change.
- **Review fixes, steering and aborts.** An abort during the retry's summary call ends the turn `aborted`. The dispatcher holds a steer between the two runs, released by a new `onOverflowRetry` callback so ordinary turns are unaffected.
- **Not done, left to later todos.**
  - The retry gets the turn's full `budgetUsd` again; HD9's session cap would subtract spend.
  - A turn compacts mid-turn once, so a context still over the limit after that waits for the overflow layer.
  - `resumeTurn()` has no overflow retry.
  - A steer accepted during the retry's summary call is dropped when the retry does not go ahead.
