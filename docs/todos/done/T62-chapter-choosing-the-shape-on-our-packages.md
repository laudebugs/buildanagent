# T62: Add our own packages to Chapter 8's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T62` |
| Status | `done` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T17](../done/T17-chapter-choosing-the-shape.md), [B19b](../done/B19b-reference-loop.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Chapter 8 ("Choosing the shape") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Chapter 8 has six listings. Each is read against `packages/sdk/README.md` and `packages/sdk/src`, not memory.

**In scope: our SDK first**

| Listing | Stays | Our SDK, first |
| --- | --- | --- |
| `#sequential-order` | `verify/google-adk/examples/02-workflow-agents.ts`, region `sequential` | The existing `packages/sdk/examples/02-workflow.ts`, region `sequential` (Chapter 1's tab): two `complete()` calls in an order the code sets. No new example |
| `#route-by-code` | `verify/google-adk/examples/03-graph-workflow.ts`, region `routing` | A new example: a regular expression picks the branch, the digit branch is a plain function and the other makes one model call |
| `#subagent`, `#orchestrator`, `#usage` | `verify/openai-agents-sdk/examples/12-subagent-as-tool.ts`, regions `subagent`, `orchestrator`, `usage` | A new example: a tool whose `execute` starts a nested `run()` with `nestedRunDepth(ctx)` (README, "`depth` and `maxDepth` stop a tree of agents"), so only the child's summary reaches the orchestrator, with each run's own usage and a code-summed total |

**Stays single**

| Listing | Why |
| --- | --- |
| `#handoff-tool` | Our SDK has no handoff: no `handoffs` option, no transfer tool and no way to make another agent active mid-turn. A tab would have to hand-build a stop-on-tool plus a second `run()` over the first run's messages, which shows our own glue and not what the OpenAI listing shows. The prose points at the missing primitive instead |

**Out of scope.** The harness packages (`protocol`, `harness`, `cli`, `evals`) are private scaffolds with nothing to list. The exercises keep pointing at the OpenAI harness.

- New examples under `packages/sdk/examples/` with `// #region` and `// book:note` markers, run offline by `test/book-examples.test.ts`, with transcripts in `packages/sdk/results/transcripts/`.
- The prose, notes and fact-check rows the tabs change.

## Tasks

- [x] Read the chapter, its log and the packages; write Scope and Tasks.
- [x] Write the router and subagent examples, with regions, notes and transcripts.
- [x] Turn `#sequential-order`, `#route-by-code`, `#subagent`, `#orchestrator` and `#usage` into tabs blocks with our tab first, and pin the harness's version in the caption.
- [x] Fact-check every changed claim into `apps/manual/fact-checks/choosing-the-shape.md` as new rows, and update the tally.
- [x] Update the plan row and move this todo to `done/`.

## Acceptance criteria

- [x] Each supported listing is a tabs block whose first tab comes from `packages/` and whose other tabs are unchanged; `#handoff-tool` stays single for the reason in Scope
- [x] `check:book`, the manual's `test`, `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Outcome

- **Tabs.** `#sequential-order-ours` (the existing `02-workflow.ts`), `#route-by-code-ours` (new `11-route-by-code.ts`) and `#subagent-ours`, `#orchestrator-ours` and `#usage-ours` (new `12-subagent-as-tool.ts`) each come first in a tabs block, ahead of the unchanged ADK and OpenAI Agents SDK listings. The orchestrator tab replays its transcript. Transcripts for both new examples are in `packages/sdk/results/transcripts/`.
- **Stays single.** `#handoff-tool`: our SDK has no handoff, and the prose says so (row 99).
- **Difference from OpenAI's usage.** Our `result.usage` counts only the run's own calls, so the code adds the subagent's tokens to get the total, and the prose says so (row 101).
- **Fact-check.** Rows 97 to 105 of `apps/manual/fact-checks/choosing-the-shape.md`; the tally is updated.
