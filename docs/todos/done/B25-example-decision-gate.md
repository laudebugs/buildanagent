# B25: Example: thresholds that scale with risk, over a decision-model stand-in

| Field | Value |
| --- | --- |
| ID | `B25` |
| Status | `done` |
| Plan | [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28) |
| Round / milestone | Round B (build SDK), M5, for the book's `fast-and-slow-calls` chapter ([T76](../ready/T76-chapter-fast-and-slow-calls.md)) |
| Depends on | [B10](../done/B10-tool-runtime.md), [B11](../done/B11-loop-core.md), [B13](../done/B13-interceptors-observers.md) |
| Size | M |

## Goal

Add `packages/sdk/examples/15-decision-gate.ts`, which gates three tool calls on the probability a decision model returns, with a different threshold for each level of risk. It teaches that a probability states intent and not consent, and it gives the chapter's decision-model section its listing.

## Context

- [The model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md#one-new-part-ii-chapter-should-follow-events-and-hooks-and-teach-the-seven-rules-through-five-offline-examples) holds this example's specification, and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md) holds the sources for every number the example stands in for. The owner approved the report's six decisions on 2026-11-28 ("approved all of them").
- [Examples guideline](../../guidelines/examples.md): how a tested example, its `// #region` markers and its transcript are written.

## Scope

**In scope**

- `packages/sdk/examples/15-decision-gate.ts` and its transcript, with a typed `DecideClient` offering `predicate`, `choice` and `score` answers, implemented by a deterministic table
- Three gated tool calls: a read-only lookup acts above 0.67, a refund acts above 0.93 and otherwise asks for confirmation, and a transfer always asks
- A scripted 0.99 for "yeah, go ahead I guess" on the transfer still reaches the confirmation step
- A question that refers to an earlier answer is rejected, so the code must send a second request
- A date comparison runs in code after the client extracts its parts
- A comment that says the table mimics the request shape of TypeSafe, Clef and OpenAI's Decisions API and measures nothing

**Out of scope** (and which todo covers it)

- The chapter that lists this example: [T76](../ready/T76-chapter-fast-and-slow-calls.md)
- Any new SDK or gateway feature: the example uses the exports that exist today

## Tasks

- [x] Define `DecideClient` and the deterministic table.
- [x] Write the three tools and the gate that reads the probability of the option the code will take.
- [x] Write the four assertions in Scope (the three thresholds' behaviour, the transfer's confirmation at 0.99, the rejected dependent question and the in-code date comparison), then the regions and the transcript.

## Acceptance criteria

- [x] The test asserts each threshold's behaviour, the transfer's confirmation at 0.99, the rejected dependent question and the in-code date comparison
- [x] The comment states what the table imitates and that it measures nothing
- [x] The example calls no network and no real decision model
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/` runs the example offline.

## Docs to update

- [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28): this todo's row

## Risks and open questions

- The three wire shapes (TypeSafe, Clef, OpenAI's Decisions API) come from vendor documentation that changes. The comment names them "as of November 2026" and the example depends on none of them.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`packages/sdk/examples/15-decision-gate.ts` gates three tool calls on a probability from a decision-model stand-in, using exports that exist today. A `beforeToolCall` hook asks the client one predicate question about the customer's intent, reads the probability of `yes` (the option the code will take) and compares it with a bar for the tool: 0.67 for the read-only lookup, 0.93 for the refund, and `Number.POSITIVE_INFINITY` for the transfer. Above the bar the hook returns `allow`; otherwise it returns `ask`, and the run ends `awaiting_approval`. An unknown tool takes the infinite bar, so it always asks. No SDK or gateway feature was needed.

The example's `check()` calls assert each claim, and `test/book-examples.test.ts` runs the file as its own process:

- A lookup at 0.70 runs, and at 0.60 asks.
- A refund at 0.95 runs, and at 0.90 asks and does not run.
- A transfer at 0.99 ("yeah, go ahead I guess") asks, and its request reason records the 0.99.
- A refund the customer says was bought on 20 October, 39 days before the fixed date of 28 November 2026, is denied at 0.97. The client extracts the month and the day, and the code compares the dates against `RETURN_DAYS`.
- A request that holds a question naming an earlier answer (`{month}`) is rejected, so the code sends the month first and builds the day question from the answer. Every request in the run holds one question.

`DecideClient`, its question and answer types and the table sit in `examples/lib/decision-table.ts`, and the tools, calendar and rows in `examples/lib/decision-fixtures.ts`, so the example stays at 91 lines. The header and the table's header say that the table imitates the request shape of TypeSafe, Clef and OpenAI's Decisions API as of November 2026, measures nothing and depends on none of them. The transcript is `packages/sdk/results/transcripts/15-decision-gate.json`. No changeset: the examples are not in the package's `files`, and the changeset gate looks only at `src/`, `package.json` and `tsconfig.build.json`.
