# B26: Example: what a model switch costs under a per-model cache

| Field | Value |
| --- | --- |
| ID | `B26` |
| Status | `done` |
| Plan | [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28) |
| Round / milestone | Round B (build SDK), M5, for the book's `fast-and-slow-calls` chapter ([T76](../ready/T76-chapter-fast-and-slow-calls.md)) |
| Depends on | [B4](../done/B4-gateway-runtime.md), [B5](../done/B5-usage-cost-catalog.md) |
| Size | M |

## Goal

Add `packages/gateway/examples/05-switch-or-stay.ts`, which prices a ten-turn session under one cache per model, so a reader sees what switching models costs and how much the answer depends on which model takes turn 1. It gives the chapter's router section its listing.

## Context

- [The model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md#one-new-part-ii-chapter-should-follow-events-and-hooks-and-teach-the-seven-rules-through-five-offline-examples) holds this example's specification, and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md) holds the sources for every number the example stands in for. The owner approved the report's six decisions on 2026-11-28 ("approved all of them").
- [Examples guideline](../../guidelines/examples.md): how a tested example, its `// #region` markers and its transcript are written.

## Scope

**In scope**

- `packages/gateway/examples/05-switch-or-stay.ts` and its test, priced from the catalog with no model call
- A ten-turn session that adds 2,000 input tokens a turn, with 200 output tokens a turn kept out of the cached context, at Sonnet 5.5's cache write ($2.50) and read ($0.10) rates and Haiku 5.5's ($0.125 and $0.01), with the output prices of [B24](../done/B24-example-cascade-with-check.md), one cache per model and no expiry
- The report's hand-calculated totals: $0.0790 for Sonnet throughout, $0.0044 for Haiku throughout, $0.0680 for Haiku for five turns then Sonnet, $0.0406 for Sonnet then Haiku, and $0.0616 alternating each turn starting on Sonnet ($0.0671 when Haiku takes turn 1)
- A second run with a gap beyond the five-minute TTL before every turn, in which every model rewrites its whole prefix
- A comment that names the Switchcraft assumption (a separate cache per model per conversation), so a reader sees that the alternation total depends on it and on which model takes turn 1

**Out of scope** (and which todo covers it)

- The chapter that lists this example: [T76](../ready/T76-chapter-fast-and-slow-calls.md)
- Any new SDK or gateway feature: the example uses the exports that exist today

## Tasks

- [x] Recompute the report's totals with a script before writing the test, and correct the report's numbers through its fact-check log if the arithmetic differs.
- [x] Write the pricing function over the catalog's rates and the six schedules.
- [x] Write the expiry run and the assertions, then the regions.

## Acceptance criteria

- [x] The test reproduces the six totals from the catalog's rates, to the four decimals shown
- [x] The expiry run shows every model rewriting its whole prefix on every turn
- [x] The comment states the one-cache-per-model assumption
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/` runs the example; the package's docs check covers its README mention, if any.

## Docs to update

- `packages/gateway/README.md` if it lists its examples
- [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28): this todo's row

## Risks and open questions

- The totals are the report's hand calculation. If the script disagrees, the script wins and the report's row is corrected, because the example is the check of record.
- Anthropic's cache-write premium and TTL are documented, but no paper tests them against live traffic, so the example is arithmetic and not a measurement.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`packages/gateway/examples/05-switch-or-stay.ts` (94 lines) prices a ten-turn session from the shipped catalog with `findCatalogEntry()` and `priceUsage()`, and calls no model. Each turn adds 2,000 input tokens and returns 200 output tokens that stay out of the cached context. Each model keeps its own cache, which holds the prefix up to that model's last turn, so a returning model reads its cache and writes only what was added since. A cache unused for more than five minutes has expired, and its model then rewrites the whole prefix. The script agreed with the report's hand calculation on all six totals, so the report and its fact-check log needed no correction. The example's `check()` calls assert the totals to four decimals, and `test/book-examples.test.ts` runs the file as its own process:

- Sonnet throughout $0.0790, Haiku throughout $0.0044.
- Haiku for five turns then Sonnet $0.0680 (0.06795 before rounding, so the total rounds half up from whole nano-dollars), Sonnet then Haiku $0.0406.
- Alternating each turn $0.0616 from Sonnet and $0.0671 from Haiku.
- With 360 seconds between turns, every schedule reads 0 cached tokens on every turn, so each model rewrites its whole prefix. Sonnet throughout then costs $0.2950 and Haiku throughout $0.0148.

The catalog holds no cache lifetime, so the example names one as a constant: 300 seconds, the lifetime of the `5m` write class. The header comment says the figures are arithmetic and not a measurement. It also names Switchcraft's assumption of a separate cache per model per conversation, on which the alternating totals depend along with the model that takes turn 1. In the pricing region, the zeros for `uncachedInput`, the `1h` write and `reasoning` are sample data. The run records no transcript, because it makes no model call. The gateway README lists no examples, so it needed no change. No changeset: the examples are not in the package's `files`, and the changeset gate looks only at `src/`, `package.json` and `tsconfig.build.json`.
