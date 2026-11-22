# N9: Layer 3: recall-first summary between turns, with hooks and a focus hint

| Field | Value |
| --- | --- |
| ID | `N9` |
| Status | `done` |
| Plan | [Build harness §4, Stage 2](../../plans/build-harness.md#42-stage-2-adds-the-five-context-layers-cheapest-first) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N8](N8-write-cap-masking.md), [B5](../done/B5-usage-cost-catalog.md), [B14](../done/B14-budget-progress.md) |
| Size | M |

## Goal

Summarise the discarded span between turns with Pi's recall-first template, write the summary as a visible `compaction` entry, and keep every original retrievable.

## Context

- [harness guide §3](../../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible): the summary template, 20K tail, hooks, focus hint, rules re-injection
- [HD9](../../plans/build-harness.md#hd9-sdk-d9s-per-call-check-plus-a-session-cap-and-a-pre-checked-summary-call-with-sdk-d9): the summary call's budget check
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): need 9 (cost projection)

## Scope

**In scope**

- A summary call through `Model.complete()` with `cacheRetention: "none"`
- Pi's fixed sections and the exact-identifier rule, over the whole span, with tool outputs cut to 2,000 characters
- A 20,000-token verbatim tail that never splits a call from its result
- `compaction` and `usage` (`source: "summary"`) entries; `toContext()` applies the latest compaction
- `beforeCompact` and `afterCompact` hooks, and a `focus` hint
- A frozen system prompt until compaction, re-rendered fresh afterwards with the rules files re-injected
- The pre-call budget projection (HD9)

**Out of scope** (and which todo covers it)

- Mid-turn and overflow triggers (N10)
- Rules-file discovery (N23 provides the files)

## Tasks

- [x] Version the template; store `promptVersion` on the entry.
- [x] Script the summary model's reply with `ScriptedModel` and assert the request it received.
- [x] Apply [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)'s append-only rule for signed thinking (plan review 2, 2026-11-19): after a compaction, the request view keeps no thinking block that followed the summarised span.

## Acceptance criteria

- [x] A scripted session crossing the budget writes one `compaction` entry and the next request contains the summary and the 20K tail
- [x] The summary request includes the whole discarded span, not its tail
- [x] `beforeCompact` returning a summary replaces ours, and the entry records it
- [x] A summary whose projected cost would cross the session cap is skipped and logged
- [x] Originals stay in the file and `rerunFrom` an entry before the compaction works
- [x] After a compaction on an Anthropic model with preserved thinking, the next request carries no thinking block after the edit point (a scripted test inspects the request)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/context/summarize.test.ts`.

## Docs to update

`packages/harness/README.md`: the summary template and hooks. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Template quality is untested on real models until N39; keep it a versioned setting.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Layer 3 is in `@buildanagent/harness/context`: `createContextPolicy({ summarize, hooks, log })`, and `runTurn()` calls `TurnContext.compact()` after the loadout and before the input is written. `contextOf()` now applies the latest `compaction` entry (a new `contextWithStarts()` also returns the entry each message starts at, which the tail cut uses). 10 tests in `packages/harness/test/context/summarize.test.ts` cover the acceptance criteria and the tail cut.

- **Template.** `recall-v1` in `summary-template.ts`: Pi's fixed sections and exact-identifier rule (MIT), over the whole span with tool results cut to 2,000 characters, version stored as `promptVersion`. The span includes the earlier summary when there is one, so summaries update each other.
- **Tail.** The newest messages up to `tailTokens`, moved earlier until the tail does not start with a tool result.
- **Cap.** `summarize.capUsd` is the session cap: the harness has no session-wide `budgetUsd` yet (HD9's fold of `usage` entries into each run's `budgetUsd`), so the summary layer takes its own. A summary is skipped, and reported through `log`, when spend plus the projected cost would pass it or either is unknown.
- **Hook summary.** `beforeCompact` returning a summary skips the call; because the entry's `usageEntryId` is required, a zero-cost `usage` entry stands for it and the entry records `promptVersion: "hook"` and a `hook` model.
- **Signed thinking.** The kept tail's signed reasoning is dropped when `contextOf()` applies a compaction; blocks written after it stay.
- **Not done, left to later todos.** The frozen system prompt: the harness's system prompt is a fixed string, so every turn already sends the same one, and rules files re-injected after a compaction arrive with N23. `log` is a callback, not a protocol event, so the dispatcher does not forward skipped summaries; N10 adds the mid-turn and overflow triggers.
