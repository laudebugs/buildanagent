# B25: Example: thresholds that scale with risk, over a decision-model stand-in

| Field | Value |
| --- | --- |
| ID | `B25` |
| Status | `ready` |
| Plan | [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28) |
| Round / milestone | Round B (build SDK), M5, for the book's `fast-and-slow-calls` chapter ([T76](T76-chapter-fast-and-slow-calls.md)) |
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

- The chapter that lists this example: [T76](T76-chapter-fast-and-slow-calls.md)
- Any new SDK or gateway feature: the example uses the exports that exist today

## Tasks

- [ ] Define `DecideClient` and the deterministic table.
- [ ] Write the three tools and the gate that reads the probability of the option the code will take.
- [ ] Write the four assertions above, then the regions and the transcript.

## Acceptance criteria

- [ ] The test asserts each threshold's behaviour, the transfer's confirmation at 0.99, the rejected dependent question and the in-code date comparison
- [ ] The comment states what the table imitates and that it measures nothing
- [ ] The example calls no network and no real decision model
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/` runs the example offline.

## Docs to update

- [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28): this todo's row

## Risks and open questions

- The three wire shapes (TypeSafe, Clef, OpenAI's Decisions API) come from vendor documentation that changes. The comment names them "as of November 2026" and the example depends on none of them.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
