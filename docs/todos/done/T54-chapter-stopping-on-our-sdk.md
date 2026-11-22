# T54: Add our own SDK to Chapter 4's stopping and structured-output listings as tabs

| Field | Value |
| --- | --- |
| ID | `T54` |
| Status | `done` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T13](../done/T13-chapter-stopping-and-structured-output.md), [B11](../done/B11-loop-core.md), [B14](../done/B14-budget-progress.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Give Chapter 4, "Stopping: caps, stop conditions and structured output" (`stopping-and-structured-output`), a first tab on `@buildanagent/sdk` wherever our SDK can show what a listing shows. The chapter's `switchTo` todos are B11 and B14, and `book:switch-report` reports both done, so BK8 asks T13's pull request to open this follow-up. The owner decided on 2026-11-19 that chapters keep their third-party listings and add ours as the first tab ([BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted), [ADR 0057](../../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)).

Our SDK fits this chapter closely. B11's `run()` counts `maxSteps` in model calls, 20 by default, and ends a capped run with a `max_steps` result and a `warning` event rather than a silent return or a throw; its `RunResult` union is the run-level stop reason the chapter asks readers to check, and an output tool ends a run `done` with a typed answer ([B11's Outcome](../done/B11-loop-core.md#outcome)). B14 adds `budgetUsd`, checked before each model call rather than after the response that crosses it, and a `budget` result ([B14's Outcome](../done/B14-budget-progress.md#outcome)).

## Context

- [T13's Outcome](../done/T13-chapter-stopping-and-structured-output.md#outcome): the chapter's listings, replays, figures and fact-check log.
- [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md): widens the listing rule to `packages/` and adds a transcript recorder for our examples; this todo reuses both, so it depends on T50.
- `packages/sdk/README.md` ("How a run ends", the output tool and `shouldStop`) and `packages/sdk/src/loop.ts`, `result.ts` and `budget.ts`.

## Scope

**In scope**

| Listing, table or figure | Stays | Our SDK, first |
| --- | --- | --- |
| The tabs block `#cap-ai`, `#cap-langchain`, `#cap-claude` | The three third-party tabs | A run capped with `maxSteps` that ends `max_steps`, with its warning event |
| `#stop-on-done` (replay) | `verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts`, region `stop-when` | An output tool that ends the run `done`, or a `shouldStop` hook that ends it `stopped` |
| `#triage-output` (replay) | `verify/vercel-ai-sdk/examples/05-structured-output.ts`, region `output-object` | The triage schema as an output tool, with an answer that fails it spending one of `maxSteps` |
| The tables `#default-caps` and `#schema-failures`, and the figure `#default-caps` | Their rows and marks | A row and a mark for our SDK: 20 model calls, `max_steps` |

- New examples under `packages/sdk/examples/` with `// #region` and `// book:note` markers, run offline by the package's `test`, with transcripts.
- The spend-cap paragraph gains our pre-emptive `budgetUsd` beside the Claude Agent SDK's post-response `maxBudgetUsd`, citing B14's measured overshoot.
- The prose, notes and fact-check rows the tabs change.

**Out of scope** (and which todo covers it)

- A listing of `continueRun()` resuming a capped run: resuming belongs to the memory chapter, so a future follow-up to [T15](../done/T15-chapter-memory-and-sessions.md), opened once its `switchTo` todos N3 and N6 are done (BK8), covers it.

## Tasks

- [x] Write the examples for our tabs, with regions, notes and transcripts.
- [x] Turn each listing in the table into a tabs block with our tab first; add our rows to the two tables and our mark to the figure, and rerun `figures:build`.
- [x] Fact-check every changed claim into `apps/manual/fact-checks/stopping-and-structured-output.md` as a new block, with corrections as their own rows, and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [x] Each listing in the table is a tabs block whose first tab comes from `packages/` and whose other tabs are unchanged
- [x] Every API identifier in the chapter's inline code resolves, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [x] `check:book`, the manual's `test` and `build`, `figures:build` with no stale figure, and `figures:audit` pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the results-drift check reports no drift

## Tests

The listing-rule tests in `apps/manual/test/`, the new examples in `packages/sdk/test/examples.test.ts`, the figure staleness test and the book's CI job.

## Docs to update

- [Book plan](../../plans/build-book.md): the §4.1 row for Chapter 4's examples
- `packages/sdk/README.md`, if an example shows a use that the README lacks
- The chapter's source register entries, for any source our tabs' prose cites

## Risks and open questions

- The chapter argues that a capped AI SDK run looks finished unless the caller checks. Our tab shows the opposite design, a `max_steps` result the type system makes callers handle, so the prose must present it as our SDK's choice and not as a verdict on the others.
- Listing numbers shift, because each tabs block numbers every listing in it and ours comes first. The build computes every number and reference, so only hand-written text that counts listings needs checking.
- Our packages are alpha (a `0.1.0-alpha` release as of November 2026), so their APIs may change under the chapter. The type-check and the results-drift check catch each change, but each one then needs a chapter update.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The examples.** Three numbered files in `packages/sdk/examples/`, run offline by `test/book-examples.test.ts`, which records their transcripts in `packages/sdk/results/transcripts/`.
  - `07-stop-step-cap.ts`, region `step-cap`: `maxSteps: 3` over a model that only calls tools ends `max_steps` with one `warning` event. The file also shows the default of 20.
  - `08-stop-done-tool.ts`, region `done-tool`: an output tool ends the run `done` with a typed answer. A second run ends `stopped` through a `shouldStop` hook.
  - `09-stop-triage-output.ts`, region `triage`: the triage schema is an output tool, and its first answer fails the schema and spends one of three model calls. Two more runs cover `max_steps` under `maxSteps: 1` and a text answer that ends `done` with no output.
- **The chapter.** `#cap-ai`, `#stop-on-done` and `#triage-output` are tabs blocks with our tab first (`#cap-ours`, `#stop-on-done-ours`, `#triage-output-ours`), each replaying our transcript, and the third-party tabs, notes and replays are unchanged. Our SDK has a row in `#default-caps` and `#schema-failures` and a mark in the `#default-caps` figure, on `ToolLoopAgent`'s 20. The spend-cap paragraph gains `budgetUsd`'s pre-emptive check with B14's measured overshoot. The prose presents a `max_steps` result as our SDK's design choice, marked as our reading. The plan's section 4.1 row for Chapter 4 names the three examples.
- **Fact-check.** Rows 95 to 121 in `apps/manual/fact-checks/stopping-and-structured-output.md`: 23 rows ✅, rows 96, 107 and 117 ✏️, and row 116 ⚠️ (our reading and advice, marked as ours). The tally reads 121 rows.
- **Out of scope, as written.** `continueRun()` resuming a capped run stays with the memory chapter's follow-up.
