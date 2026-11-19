# T50: Add our own SDK to Chapter 1's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T50` |
| Status | `ready` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T10](../done/T10-chapter-call-workflow-loop.md), [B11](../done/B11-loop-core.md) |
| Size | M |

## Goal

Wherever our SDK supports what a listing in Chapter 1 shows, give that listing a tab with the same step on `@buildanagent/gateway` and `@buildanagent/sdk`. The chapter is "Use the least autonomy that works: a call, a workflow, then a loop" (`call-workflow-loop`), and five of its six listings qualify today. The third-party listings stay. The owner decided on 2026-11-19 that chapters keep the third-party listings as tabs and add ours as our SDK gains each feature: "we'll add our SDK as functionality becomes available" ([BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted), [ADR 0057](../../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)). Each listing therefore becomes a `:::tabs` block, with our SDK's tab first and the AI SDK or ADK listing, unchanged, beside it. Chapter 1's only `switchTo` todo is B11, the loop core, and `book:switch-report` now reports it done. With the tabs in place, the reader learns the loop from the code the rest of the book builds on and still sees how two other SDKs write it.

## Context

- [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted): the switch rule, the owner's decision of 2026-11-19 that our SDK joins as tabs, and the note that this todo first widens the listing rule to name `packages/`.
- [Book plan BK9's T4 result](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed): a listing must sit in a harness that `apps/manual/src/data/harnesses.json` lists, with an exact pin, so a listing from `packages/` fails today as "in no harness".
- [T10's Outcome](../done/T10-chapter-call-workflow-loop.md#outcome): the chapter's six listings, its four replays, its figures and its fact-check log.
- [`apps/manual/README.md`, tabs](../../../apps/manual/README.md#tabs-show-one-concept-in-several-sdks) and [boxes](../../../apps/manual/README.md#a-box-sets-a-passage-apart-from-the-chapters-argument): how a `:::tabs` block numbers and heads its listings, and how a box holds one; `#scripted-mock` sits in the chapter's box.
- [B11's Outcome](../done/B11-loop-core.md#outcome): what the loop core delivered: `run()`, `runOrThrow()`, the `RunResult` union with its stop reasons, the closed `AgentEvent` union, and `maxSteps`, which defaults to 20 and counts model calls.
- `packages/sdk/README.md`, `packages/gateway/README.md` and `packages/sdk/examples/`: the existing order-agent example, which `packages/sdk/test/examples.test.ts` runs, shows how we write our examples and run them offline.
- `apps/manual/src/book/transcripts.ts` and `scripts/transcripts/`: the transcript format a replay reads, which today only `verify/*/results/transcripts/` supplies.

## Scope

**In scope**

Each listing in `apps/manual/src/content/chapters/call-workflow-loop.md` that our SDK can show today, and the tab it gains:

| Listing | Stays as a tab | Our SDK's tab, first |
| --- | --- | --- |
| `#one-call` (replay) | `verify/vercel-ai-sdk/examples/01-generate-text.ts`, region `call` | One gateway `complete()` call (B4) |
| `#workflow` (replay) | `verify/google-adk/examples/02-workflow-agents.ts`, region `sequential` | A writer call, then a reviewer call, in an order plain TypeScript sets; our SDK has no workflow agent class, so the code itself is the workflow |
| `#weather-tool` | `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, region `tool` | The same tool on `defineTool()` (B10) |
| `#tool-loop` (replay) | `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, region `loop` | `run()` with that tool and an explicit `maxSteps` (B11) |
| `#scripted-mock` | `verify/vercel-ai-sdk/examples/lib/check.ts`, region `scripted` | `ScriptedModel` from `@buildanagent/sdk/testing` (B3) |

- New examples under `packages/sdk/examples/` (or `packages/gateway/examples/` for the one call), with `// #region` and `// book:note` markers, run offline by the package's `test`.
- Widen the listing rule so a listing may come from `packages/`, in three places: the coverage check, the harness table (or a sibling table) and the caption's pin. For our packages, the pin is the workspace version (a `0.1.0-alpha` release as of November 2026) rather than an exact third-party pin.
- Transcripts for the new examples, in the format of `scripts/transcripts/events.ts`, recorded by the package's tests and committed beside those tests, so our tabs replay as the third-party tabs do. The results-drift check covers them.
- Turn each listing in the table into a `:::tabs` block, ours first. A block holding a container listing, one with notes or a replay, needs a longer fence (`::::tabs`), and the `#scripted-mock` block sits inside the chapter's box, whose fence then grows again. If the tabs block cannot yet hold a listing with notes and a replay, widen it here, with tests. A tab's caption becomes its heading and names its SDK, so each listing's descriptive caption, such as "One model call: your code sends one request and reads one answer", moves into the sentence that introduces the block.
- The prose around each listing, so it names both tabs where it describes code: the notes, the paragraphs that walk through each replay, and the box "How these examples run without a key". The inline code that names `generateText`, `stopWhen`, `SequentialAgent` or `LoopAgent` keeps resolving under BK17, because those listings stay; new inline code names our SDK's identifiers.
- `figures/call-workflow-loop/loop-bench.ts`: it lights six steps in the order of the AI SDK loop's transcript, so check that order against our loop's transcript and say in the chapter if the two differ.

**Out of scope** (and which todo covers it)

- `#pi-hello` (`verify/pi/examples/01-hello-session.ts`): the chapter shows a harness keeping a session and bringing its own tools, which our harness does only once its session runner lands ([N6](N6-session-runner.md)). The listing stays a single Pi listing until then; a later todo adds our tab, and the chapter's `switchTo` gains N6 if the owner wants that tab.
- The exercises keep their AI SDK and ADK files; a later todo can add versions on our SDK.
- The other chapters' listings: each gains our tabs in its own follow-up when its `switchTo` todos are done.

## Tasks

- [ ] Widen the listing rule to accept `packages/`, with a test for a listing from `packages/sdk/examples/` and one for a file in no package, and update `apps/manual/README.md` and BK9's T4 result.
- [ ] Add a transcript recorder for our packages' examples, writing transcripts in the existing format, and commit the transcripts.
- [ ] Write the five examples for our tabs with their regions and notes, each run offline by the package's `test`.
- [ ] Turn each listing in the table above into a tabs block with our tab first, keeping the third-party listing, its notes and its replay unchanged; widen the tabs block if it cannot hold them.
- [ ] Update the prose and notes around each block so they describe both tabs.
- [ ] Check `loop-bench`'s step order against our loop transcript; rebuild and audit the figure if it changes.
- [ ] Fact-check every changed claim into `apps/manual/fact-checks/call-workflow-loop.md` as a new block, with corrections as their own rows, and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [ ] Each listing in the table above is a tabs block whose first tab comes from `packages/` and whose other tab is the listing the chapter showed before, with the same file, region, notes and replay
- [ ] `#pi-hello` is still a single `verify/` listing
- [ ] Each of our tabs carries notes that describe its code, and our tabs for `#one-call`, `#workflow` and `#tool-loop` replay our packages' committed transcripts
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [ ] The fact-check log has a block of rows for the tabs, and its tally matches its rows
- [ ] The pull request records the writing review's 5C scores, before and after
- [ ] `check:book`, the manual's `test` and `build`, `figures:build` with no stale figure, and `figures:audit` pass
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the results-drift check reports no drift

## Tests

The listing-rule tests in `apps/manual/test/`, the new examples in `packages/sdk/test/examples.test.ts` (or the gateway's equivalent), and the book's CI job.

## Docs to update

- [Book plan](../../plans/build-book.md): BK8 and BK9's T4 result, for the widened rule; the §4.1 row for Chapter 1's examples
- `apps/manual/README.md`: how a listing names a file in `packages/`
- The chapter's source register entries, for any source our tabs' prose cites

## Risks

- Tabs double the code a reader can open at each step, and the prose must still read as one argument. Keep each paragraph about the step, and name an SDK only where the two tabs differ.
- Listing numbers shift, because each tabs block numbers both its listings and ours comes first. The build computes every number and reference, so only hand-written text that counts listings needs checking.
- Our packages are alpha (a `0.1.0-alpha` release as of November 2026), so their APIs may change under the chapter. The type-check and the results-drift check catch each change, but each one then needs a chapter update.
- The replay recorder is new code; if it grows past this todo, split it into its own todo that this one depends on.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
