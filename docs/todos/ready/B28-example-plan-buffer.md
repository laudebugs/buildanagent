# B28: Example: a slow planner's buffer funds several fast steps, and a stuck rule takes control back

| Field | Value |
| --- | --- |
| ID | `B28` |
| Status | `ready` |
| Plan | [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28) |
| Round / milestone | Round B (build SDK), M5, for the book's `fast-and-slow-calls` chapter ([T76](T76-chapter-fast-and-slow-calls.md)) |
| Depends on | [B10](../done/B10-tool-runtime.md), [B11](../done/B11-loop-core.md) |
| Size | M |

## Goal

Add `packages/sdk/examples/17-plan-buffer.ts`, in which a scripted slow model returns a buffer of five actions that a scripted fast executor runs as tool calls. It shows the planner and executor split and its hand-back rules, and it gives the chapter's cascade section its second listing.

## Context

- [The model-routing report](../../research/model-routing/system-1-system-2-and-model-routing.md#one-new-part-ii-chapter-should-follow-events-and-hooks-and-teach-the-seven-rules-through-five-offline-examples) holds this example's specification, and its [fact-check log](../../research/model-routing/fact-check-system-1-system-2-and-model-routing.md) holds the sources for every number the example stands in for. The owner approved the report's six decisions on 2026-11-28 ("approved all of them").
- [Examples guideline](../../guidelines/examples.md): how a tested example, its `// #region` markers and its transcript are written.

## Scope

**In scope**

- `packages/sdk/examples/17-plan-buffer.ts` and its transcript
- Control returns to the slow model when the buffer empties, when an action is invalid, or when three steps in a row earn no progress (a smaller K than SwiftSage's five, so the test stays short)
- A ten-step task uses two slow calls, where step-by-step slow use needs ten, and an injected invalid action triggers a third slow call
- A comment that says SwiftSage's evidence is one simulator with hand-written rules

**Out of scope** (and which todo covers it)

- The chapter that lists this example: [T76](T76-chapter-fast-and-slow-calls.md)
- Any new SDK or gateway feature: the example uses the exports that exist today

## Tasks

- [ ] Script the planner's buffers and the executor's steps.
- [ ] Write the three hand-back rules as one function over the run's state.
- [ ] Write the assertions and the regions.

## Acceptance criteria

- [ ] The test asserts two slow calls for the ten-step task and three when an invalid action is injected
- [ ] The no-progress rule fires after three steps and the test covers it
- [ ] The comment states the evidence's limits
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/` runs the example offline.

## Docs to update

- [Build SDK §4.7](../../plans/build-sdk.md#47-five-offline-examples-for-the-fast-and-slow-calls-chapter-added-2026-11-28): this todo's row

## Risks and open questions

- The progress signal is the example's own rule. A real agent needs a signal its own task defines, and the comment says so.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
