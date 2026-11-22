# N9: Layer 3: recall-first summary between turns, with hooks and a focus hint

| Field | Value |
| --- | --- |
| ID | `N9` |
| Status | `ongoing` |
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

- [ ] Version the template; store `promptVersion` on the entry.
- [ ] Script the summary model's reply with `ScriptedModel` and assert the request it received.
- [ ] Apply [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)'s append-only rule for signed thinking (plan review 2, 2026-11-19): after a compaction, the request view keeps no thinking block that followed the summarised span.

## Acceptance criteria

- [ ] A scripted session crossing the budget writes one `compaction` entry and the next request contains the summary and the 20K tail
- [ ] The summary request includes the whole discarded span, not its tail
- [ ] `beforeCompact` returning a summary replaces ours, and the entry records it
- [ ] A summary whose projected cost would cross the session cap is skipped and logged
- [ ] Originals stay in the file and `rerunFrom` an entry before the compaction works
- [ ] After a compaction on an Anthropic model with preserved thinking, the next request carries no thinking block after the edit point (a scripted test inspects the request)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/context/summarize.test.ts`.

## Docs to update

`packages/harness/README.md`: the summary template and hooks. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Template quality is untested on real models until N39; keep it a versioned setting.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
