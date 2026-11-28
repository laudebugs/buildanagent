# B27: Example: rank candidates by cost per solved task and call a difference noise

| Field | Value |
| --- | --- |
| ID | `B27` |
| Status | `done` |
| Plan | [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28) |
| Round / milestone | Round B (build SDK), M5, for the book's `fast-and-slow-calls` chapter ([T76](../ready/T76-chapter-fast-and-slow-calls.md)) |
| Depends on | [B5](../done/B5-usage-cost-catalog.md) |
| Size | M |

## Goal

Add `packages/sdk/examples/16-cost-per-solved-task.ts`, which ranks four candidate configurations by cost per solved task and refuses to rank a pair whose pass-rate difference is inside the noise. It reproduces Anthropic's method and none of its numbers, and it gives the chapter's effort section its listing.

## Context

- [The model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md#one-new-part-ii-chapter-should-follow-events-and-hooks-and-teach-the-seven-rules-through-five-offline-examples) holds this example's specification, and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md) holds the sources for every number the example stands in for. The owner approved the report's six decisions on 2026-11-28 ("approved all of them").
- [Examples guideline](../../guidelines/examples.md): how a tested example, its `// #region` markers and its transcript are written.

## Scope

**In scope**

- `packages/sdk/examples/16-cost-per-solved-task.ts`, with scripted pass-fail results for 40 tasks on four candidates (Haiku 5.5, Sonnet 5.5, Opus 5.5 at `low`, Opus 5.5 at `medium`), with token counts and catalog prices
- A printed table of cost per solved task, with any pair whose paired pass-rate difference is under two standard errors marked as tied
- An assertion that a lower-effort large model beats a smaller model on cost per solved task when the scripted numbers say so, and one that a tied pair is not ranked
- A comment that says the example reproduces Anthropic's method and none of its numbers

**Out of scope** (and which todo covers it)

- The chapter that lists this example: [T76](../ready/T76-chapter-fast-and-slow-calls.md)
- Any new SDK or gateway feature: the example uses the exports that exist today

## Tasks

- [x] Script the 40 results so one pair is tied and one lower-effort large model wins on cost per solved task.
- [x] Write the paired standard-error test and the ranking.
- [x] Write the assertions and the regions.

## Acceptance criteria

- [x] The test asserts the ranking, the tied pair and the unranked tie
- [x] The comment names Anthropic's cost-per-solved-task method as the model for the example and says the numbers are invented
- [x] The example prices every candidate from the catalog
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/` runs the example offline.

## Docs to update

- [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28): this todo's row

## Risks and open questions

- Forty tasks resolve a large gap and no small one; the comment says so, citing the power figures the book's evals chapter already uses.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`packages/sdk/examples/16-cost-per-solved-task.ts` (89 lines) ranks four candidates on 40 scripted tasks by cost per solved task and refuses to rank a pair whose paired pass-rate difference is under two standard errors. It needs no model call and no SDK or gateway feature: each candidate's price per task comes from `priceUsage()` and `findCatalogEntry()` on the gateway's catalog, in whole nano-dollars. The header says it reproduces Anthropic's method and none of its numbers, and that every pass, fail and token count is invented. `test/book-examples.test.ts` runs the file and fails when a `check()` is false. The checks assert:

- Pass counts of 18 (Haiku 5.5), 28 (Sonnet 5.5), 36 (Opus 5.5 low) and 29 (Opus 5.5 medium) of 40, with 800, 3,000, 1,000 and 2,500 output tokens and 4,000 input tokens a task.
- Cost per solved task of $0.0018, $0.0543, $0.0400 and $0.0910 (1,777,778, 54,285,714, 40,000,000 and 91,034,483 nano-dollars).
- One tied pair, Sonnet 5.5 and Opus 5.5 at medium (one task apart), which share rank 3 although Sonnet costs less per solved task; Haiku is rank 1 and Opus at low rank 2.
- Opus at low beats Sonnet on cost per solved task, and the pair is outside the noise (a gap of 8 tasks).

The risk's power figures are not cited: the book's evals chapter holds none. The header says only that forty tasks resolve large gaps. No changeset: examples are not in the package's `files`.
