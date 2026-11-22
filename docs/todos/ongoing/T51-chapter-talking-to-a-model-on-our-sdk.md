# T51: Add our own SDK to Chapter 2's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T51` |
| Status | `ongoing` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T11](../done/T11-chapter-talking-to-a-model.md), [T50](T50-chapter-call-workflow-loop-on-our-sdk.md), [B4](../done/B4-gateway-runtime.md), [B5](../done/B5-usage-cost-catalog.md) |
| Size | M |

## Goal

Wherever our gateway supports what a listing in Chapter 2 shows, give that listing a tab with the same step on `@buildanagent/gateway`. The chapter is "Talking to a model: messages, streams, tokens, instructions and model choice" (`talking-to-a-model`). Its `switchTo` todos, B4 (the gateway runtime) and B5 (usage, the cost catalog and fold, and the caching policy), are both done, and `book:switch-report` reports the chapter ready for tabs. By the owner's decision of 2026-11-19, the third-party listings stay, and ours joins each one as its first tab ([ADR 0057](../../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)). The reader then sees the four token classes and the closing stream event in the code the rest of the book builds on.

## Context

- [T11's Outcome](../done/T11-chapter-talking-to-a-model.md#outcome): the chapter's listings, replays, figures and fact-check log.
- [T50](T50-chapter-call-workflow-loop-on-our-sdk.md): widens the listing rule to accept `packages/` and adds a transcript recorder for our packages; this todo reuses both, so it starts after T50.
- `packages/gateway/README.md`, `src/stream-contract.ts`, `src/usage.ts`, `src/cost.ts` and `src/catalog.json`: the stream's single closing event, the `Usage` classes of [ADR 0003](../../decisions/0003-token-usage-fields.md) and the catalog prices of [ADR 0004](../../decisions/0004-cost-catalog-and-basis.md).

## Scope

**In scope**

| Listing | Stays as a tab | Our gateway's tab, first |
| --- | --- | --- |
| `#text-stream` (replay) | `verify/vercel-ai-sdk/examples/06-streaming.ts`, region `text-stream` | A model from `createModel()`, streamed, collecting text deltas until the `done` event, whose message is the folded answer |
| `#stream-usage` (replay) | `verify/vercel-ai-sdk/examples/10-streaming-usage.ts`, region `stream-usage` | The same scripted usage read from the `done` message's `Usage` (`uncachedInput`, `cacheRead`, `cacheWrite`, `output`) and priced by the gateway's cost fold from its catalog |
| `#system-in-messages` (replay) | `verify/vercel-ai-sdk/examples/01-generate-text.ts`, region `system-in-messages` | Only if the gateway draws the same line between the system prompt and the messages; otherwise the listing stays single and the chapter says why |

- New examples under `packages/gateway/examples/`, with `// #region` and `// book:note` markers, run offline by the package's `test`, and their transcripts.
- The prose and notes around each block, so they describe both tabs; the fact-check log's new block and tally.

**Out of scope** (and which todo covers it)

- The stream tabs block (`#stream-parts`, `#langchain-updates`, `#copilot-deltas`): it already compares three SDKs; adding a fourth tab is optional and can wait for a reader's request.
- `#sonnet-rates` (`lib/rates.ts`): the gateway's catalog replaces it in our tab's prose, not as a tab of its own.
- Section T39 (fine-tuning versus prompting), which adds its own section and listing.

## Tasks

- [ ] Write the gateway examples for the tabs, with regions, notes and transcripts, run offline by the package's `test`.
- [ ] Turn each qualifying listing into a tabs block with our tab first, keeping the third-party listing, its notes and its replay unchanged.
- [ ] Update the prose and notes; fact-check every changed claim into `apps/manual/fact-checks/talking-to-a-model.md` as a new block and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [ ] Each qualifying listing is a tabs block whose first tab comes from `packages/gateway` and whose other tab is the listing the chapter showed before, with the same file, region, notes and replay
- [ ] Every API identifier in the chapter's inline code resolves or carries a marker citing a ✅ or ✏️ row (BK17)
- [ ] `check:book`, the manual's `test` and `build`, `figures:build` with no stale figure, the results-drift check, `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description
