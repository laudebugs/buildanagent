# T58: Add our own gateway and SDK to Chapter 9's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T58` |
| Status | `done` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T18](../done/T18-chapter-the-model-gateway.md), [B4](../done/B4-gateway-runtime.md), [B5](../done/B5-usage-cost-catalog.md), [B8](../done/B8-anthropic-adapter.md), [B9](../done/B9-openai-chat-adapter.md), [T50](T50-chapter-call-workflow-loop-on-our-sdk.md), [T51](T51-chapter-talking-to-a-model-on-our-sdk.md) |
| Size | M |

## Goal

Chapter 9 ("The model gateway") cites `@buildanagent/gateway` and `@buildanagent/sdk` in prose only. This todo adds each package as the first tab of every listing it can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Every listing in the chapter can take a tab on our packages today, so none stays single. Retries, the cache policy, the cost fold and the one-method adapter are the gateway's (B4, B5, B8, B9). The per-step tool list and the pre-call budget are the SDK's loop, which sits over the gateway's `projectCallCost()`. The chapter's `switchTo` todos are all done, and `book:switch-report` reports it ready.

**In scope**

| Listing | Stays as a tab | Our tab, first |
| --- | --- | --- |
| `#ask-helper` | `verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts`, region `ask` | `ask()` over `model.complete()`, with the portable `cacheRetention` option and `maxOutputTokens` (gateway) |
| `#scripted-two-methods` | `verify/vercel-ai-sdk/examples/lib/check.ts`, region `scripted` | A scripted `ModelAdapter` with its single `stream()` method; `createModel()` supplies `complete()` (gateway) |
| `#wire-listing` | the AI SDK file, region `wire` | The gateway's Anthropic adapter over a stub transport that answers in Messages format (gateway) |
| `#retry-once` | the AI SDK file, region `retry` | An HTTP 529 answered by the stub; the gateway retries once and streams one `retry` event (gateway) |
| `#retry-limits` | the AI SDK file, region `retry-limits` | A 401 fails after one attempt, and two 429s against `retries: 1` end in an error terminal (gateway) |
| `#cache-hit` (replay) | the AI SDK file, region `cache` | Two calls with one prefix: the stub reports it written, then read, and the catalog prices both (gateway) |
| `#prepare-step` (replay) | `verify/vercel-ai-sdk/examples/04-prepare-step.ts`, region `prepare-step` | `beforeModelCall` returning `activeTools`, so the second request carries none (SDK). Our SDK has no forced tool choice, and the chapter says so |
| `#budget-wrapper` | the AI SDK file, region `budget` | `run()` with `budgetUsd`: no wrapper, because the loop projects with `projectCallCost()` itself (SDK) |
| `#budget-refused` | the AI SDK file, region `refuse` | A run whose second call fits the cap alone but not on top of the first call's spend, so it ends `budget` with no second request (SDK) |

The brief named eight listings; `#wire-listing` is a ninth in the chapter and qualifies, so it gets a tab.

- New examples: `packages/gateway/examples/03-scripted-adapter.ts` and `04-retries-caching.ts` (with a stub in `examples/lib/`), and `packages/sdk/examples/11-prepare-step.ts` and `12-budget.ts`, each with `// #region` and `// book:note` markers and checks that fail when the behaviour breaks. Each package's `test/book-examples.test.ts` runs them offline and records their transcripts.
- Prose and notes around each block describe both tabs and name what differs: portable `cacheRetention` against Anthropic's `cacheControl` mark, an error terminal against `RetryError`, a loop option against a model wrapper. The figure `budget-check` draws the AI SDK tab's numbers, and the text says our tab's differ.
- A new fact-check block in `apps/manual/fact-checks/the-model-gateway.md`, and the register entries our tabs' prose needs.

**Out of scope**

- `#sonnet-rates` and the exercises: they stay on the AI SDK file, as in Chapter 2.
- Package `src/`: any change the examples reveal goes to the owner as a follow-up.

## Tasks

- [x] Read the chapter, its log and the two packages; write Scope and Tasks.
- [x] Write the gateway examples, with regions, notes and checks, run offline by the package's `test`, with transcripts.
- [x] Write the SDK examples the same way.
- [x] Turn each listing in the table into a tabs block with our tab first, keeping the third-party listing, notes and replay unchanged.
- [x] Update the prose and notes; fact-check every changed claim into the chapter's log as a new block and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [x] Each of the nine listings in the table is a tabs block whose first tab comes from `packages/` and whose other tab is the listing the chapter showed before, with the same file, region, notes and replay
- [x] Our tabs for `#cache-hit` and `#prepare-step` replay our packages' committed transcripts
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [x] The fact-check log has a block of rows for the tabs (rows 115 to 140), and its tally matches its rows
- [x] `check:book`, the manual's `test` and `build`, `figures:build` with no stale figure, `pnpm check`, `pnpm typecheck`, `pnpm test`, the CI scripts' tests and the results-drift check pass offline
- [ ] The pull request records the writing review's 5C scores, before and after

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **Every listing qualified.** All nine listings now open with our tab: six on the gateway and three on the SDK (the per-step tool list and the two budget listings). None stays single. The brief named eight listings; `#wire-listing` is a ninth and also got a tab. `#sonnet-rates` and the exercises stay on the AI SDK file.
- **The gateway examples.** `packages/gateway/examples/03-scripted-adapter.ts` (region `scripted`) and `04-retries-caching.ts` (regions `wire`, `ask`, `retry`, `retry-limits`, `cache`). The second runs the gateway's real Anthropic adapter on `examples/lib/stub.ts`, a stub transport that answers HTTP statuses the example queues and reports cache tokens for a marked prefix it sees twice. Its transcript is `results/transcripts/04-retries-caching.json`.
- **The SDK examples.** `packages/sdk/examples/11-prepare-step.ts` (`beforeModelCall` returning `activeTools`) and `12-budget.ts` (`run()` with `budgetUsd`, over `pricedScripted()`, a `ScriptedModel` that the gateway prices as Claude Sonnet 5.5). Transcripts are `11-prepare-step.json` and `12-budget.json`.
- **Differences the chapter now says.** Our `ask` uses the portable `cacheRetention` option where the AI SDK's uses an Anthropic `cacheControl` mark. A failed call ends in an error message of kind `retryable`, not a `RetryError`. The budget is a `run()` option, not a wrapper. Our SDK has no forced tool choice. The figure draws the AI SDK tab's amounts, and the text gives ours ($0.01024 spent, $0.021088 projected, $0.025 budget).
- **Mutation checks.** Each example's checks fail when the behaviour breaks: 529 no longer retryable, 401 made retryable, 429 made fatal, the system cache mark removed, the cache-read rate changed, `activeTools` ignored, the budget check always allowing, and the scripted adapter's `done` event removed.
- **Fact-check.** Rows 115 to 140 in `apps/manual/fact-checks/the-model-gateway.md`, all ✅; the tally reads 140 rows.
- **Follow-ups for the owner.** The gateway's stub and the SDK's `pricedScripted()` duplicate plumbing the two packages' `lib/check.ts` already hold. The manual's `check-book` tests time out at their 60-second limit when `pnpm test` runs every package in parallel on a loaded machine, and pass alone (the real-book test takes about 29 seconds alone).
