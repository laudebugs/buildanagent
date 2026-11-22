# T57: Add our own SDK to Chapter 10's hook, steering and event listings as tabs

| Field | Value |
| --- | --- |
| ID | `T57` |
| Status | `done` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T19](../done/T19-chapter-events-and-hooks.md), [B13](../done/B13-interceptors-observers.md), [B16](../done/B16-steering.md), [B17](../done/B17-otel-observer.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Give Chapter 10, "Events and hooks: one event union, interceptors and observers" (`events-and-hooks`), a first tab on `@buildanagent/sdk` wherever our SDK can show what a listing shows. The chapter's `switchTo` todos are B13, B16 and B17, and `book:switch-report` reports all three done, so BK8 asks T19's pull request to open this follow-up. T19 found that `packages/sdk/examples/` holds no example of hooks, observers, steering or the event stream, so each tab needs a new example first. The owner decided on 2026-11-19 that chapters keep their third-party listings and add ours as the first tab ([BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted), [ADR 0057](../../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)).

## Context

- [T19's Outcome](../done/T19-chapter-events-and-hooks.md#outcome): the chapter's listings, replay, figures and fact-check log. Its prose already describes our SDK's six interceptors, observers and steering from the README and source, so each new tab must agree with those claims.
- [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md): widened the listing rule to `packages/` and added the transcript recorder for our examples; this todo reuses both.
- `packages/sdk/README.md` ("Hooks change a run at six moments, and observers only watch", "Steer a running agent with `run.steer()`") and `packages/sdk/src/hooks.ts`, `compose.ts` and `observers.ts`.

## Scope

**In scope**

| Listing | Stays | Our SDK, first |
| --- | --- | --- |
| `#pi-events` | `verify/pi/examples/01-hello-session.ts`, region `events` | An observer that records each event's type for one prompt, with the deltas, `model_call_end` and `agent_settled` |
| The tabs block `#block-copilot`, `#block-langchain`, `#block-adk` | The three third-party tabs | A `beforeToolCall` gate that denies a tool and an `afterToolCall` that replaces a result, with the model reading both |
| `#pi-steer` | `verify/pi/examples/04-steering.ts`, region `steer` | `run.steer()` and `run.followUp()` on a streaming run, with the `steer_applied` event |

- New examples under `packages/sdk/examples/` with `// #region` and `// book:note` markers, run offline by the package's `test`, with transcripts where they make a replay.
- The table `#combine-hooks` keeps its row for our SDK, and the prose gains a pointer to the gate-order example if one is written.
- The prose, notes and fact-check rows the tabs change.

**Out of scope** (and which todo covers it)

- Our packages' OpenTelemetry observer, `otelObserver()`: the chapter names it in prose only, and a listing of it belongs to the observability chapter's follow-up, [T25](../done/T25-chapter-evals-observability-and-release.md).

## Tasks

- [x] Write the examples for our tabs, with regions, notes and transcripts.
- [x] Turn each listing in the table into a tabs block with our tab first, and pin the harness's version in the caption through `src/data/harnesses.json`.
- [x] Fact-check every changed claim into `apps/manual/fact-checks/events-and-hooks.md` as new rows, with corrections as their own rows, and update the tally.
- [x] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [x] Each listing in the table is a tabs block whose first tab comes from `packages/` and whose other tabs are unchanged
- [x] Every API identifier in the chapter's inline code resolves, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [x] `check:book`, the manual's `test` and `build` pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the results-drift check reports no drift

## Tests

The listing-rule tests in `apps/manual/test/`, the new examples in `packages/sdk/test/examples.test.ts`, and the book's CI job.

## Docs to update

- [Book plan](../../plans/build-book.md): the §4.2 row for Chapter 10's examples, and the todo table
- `packages/sdk/README.md`, if an example shows a use that the README lacks
- The chapter's source register entries, for any source our tabs' prose cites

## Risks and open questions

- Listing numbers shift, because each tabs block numbers every listing in it and ours comes first. The build computes every number and reference, so only hand-written text that counts listings needs checking.
- Our packages are alpha (a `0.1.0-alpha` release as of November 2026), so their APIs may change under the chapter. The type-check and the results-drift check catch each change, but each one then needs a chapter update.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The examples.** Three files in `packages/sdk/examples/`: `08-observer-events.ts` (region `events`, an observer that records each event's type), `09-gate-and-redact.ts` (region `hooks`, a `beforeToolCall` gate that denies one call and an `afterToolCall` that replaces another's result, with the model reading both) and `10-steering.ts` (region `steer`, `run.steer()` and `run.followUp()` on a streaming run). Each runs offline through `test/book-examples.test.ts`, and its transcript is in `packages/sdk/results/transcripts/`.
- **The chapter.** `#events-ours`, `#block-ours` and `#steer-ours` each come first in a tabs block, beside the listings the chapter showed before with their files, regions and notes unchanged. The hook and steering tabs replay their transcripts. The prose now says "four listings", names the decision and patch shapes of ours, and walks through the steering example's steps.
- **Fact-check.** Rows 88 to 101 of `apps/manual/fact-checks/events-and-hooks.md`, all confirmed (rows 99 and 100 came from the first code review's fix and row 101 from the writing review); the tally is updated.
- **Gate-order example.** Not written: the chapter's `/etc/passwd` case stays prose, checked by row 75, and `#combine-hooks` keeps its row for our SDK. A listing of `composeInterceptors()` can follow if the owner wants one.
- **Differences from Pi's listings.** The Pi events example ends on `agent_settled`, and ours ends on `agent_settled` then `run_end`, so the prose states both. Our tab has no "rejected second prompt" note, because `run()` starts one run and the person calls `steer()` and `followUp()` on its `Run`.
