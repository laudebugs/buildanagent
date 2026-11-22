# T58: Add our own gateway and SDK to Chapter 9's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T58` |
| Status | `ongoing` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T18](../done/T18-chapter-the-model-gateway.md), [B4](../done/B4-gateway-runtime.md), [B5](../done/B5-usage-cost-catalog.md), [B8](../done/B8-anthropic-adapter.md), [B9](../done/B9-openai-chat-adapter.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md), [T51](../done/T51-chapter-talking-to-a-model-on-our-sdk.md) |
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
- [ ] Write the gateway examples, with regions, notes and checks, run offline by the package's `test`, with transcripts.
- [ ] Write the SDK examples the same way.
- [ ] Turn each listing in the table into a tabs block with our tab first, keeping the third-party listing, notes and replay unchanged.
- [ ] Update the prose and notes; fact-check every changed claim into the chapter's log as a new block and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [ ] See the Scope section once written.
