# N10: Layers 4 and 5: mid-turn compaction and the overflow retry

| Field | Value |
| --- | --- |
| ID | `N10` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 2](../../plans/build-harness.md#42-stage-2-adds-the-five-context-layers-cheapest-first) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N9](N9-summary-layer.md), [N7](N7-rebuild-resume-replay.md) |
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

- [ ] Script a model step that returns `error.kind: "overflow"`, then a success.
- [ ] If need 4 is not yet in the SDK, end the turn and start a new one from the rebuilt context, and note it in the README.
- [ ] Apply [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)'s append-only rule for signed thinking (plan review 2, 2026-11-19) to mid-turn and overflow compaction: the rebuilt request drops every thinking block after the edit point.

## Acceptance criteria

- [ ] A 100K-window scripted session compacts mid-turn once when crossing 90%
- [ ] A 1M-window session does not compact mid-turn by default
- [ ] An overflow error leads to exactly one compaction and one retry; a second overflow ends the turn with `stopReason: "error"`
- [ ] After a mid-turn or overflow compaction on an Anthropic model with preserved thinking, the retried request carries no thinking block after the edit point
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/context/mid-turn.test.ts`, `overflow.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Depends on §3.6 needs 3 and 4; the fallback above keeps the todo unblocked.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
