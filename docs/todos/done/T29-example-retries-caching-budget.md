# T29: Example: retries, prompt caching and a pre-call budget

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T29` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` so Chapter T18 ("The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost") has code behind its subject. The example shows a retried call after a scripted retryable error, cache-read tokens on a repeated prefix, and a budget middleware that refuses a call whose projected cost exceeds the cap. The coverage review found the gap: `04-prepare-step` narrows tools and `06-streaming` shows stream parts; neither shows retries, caching or a budget, the subjects of Chapter T18.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T18's todo, [T18](../ready/T18-chapter-the-model-gateway.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/vercel-ai-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T18's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Script a mock that fails once with a retryable error, then succeeds; assert the retry count.
- [x] Send the same prefix twice and assert that the second usage reports cache-read tokens.
- [x] Wrap the model with a middleware that projects each call's cost before sending it, and assert that a call over the cap never reaches the mock.
- [x] If a second wire protocol can be shown offline through a provider's base-URL setting and a mock HTTP server, add it; otherwise say so in the example's header.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (`pnpm check`, `pnpm typecheck` and the harness's `pnpm test` pass; the root `pnpm test` stops at `verify/copilot-sdk`, which needs Linux namespaces that this machine lacks)

## Tests

`pnpm test` in `verify/vercel-ai-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/vercel-ai-sdk/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step (`pnpm check`, `pnpm typecheck` and the harness's `pnpm test` pass locally; the branch was pushed once, not after each step)
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Added `verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts`, with `prices`, `budget`, `retry`, `cache`, `refuse` and `wire` regions and `book:note` markers `retry-header`, `retry-count`, `cache-read` and `refused`. Its fifteen checks cover, against a scripted model, one retry after a retryable error (`retry-after-ms: "0"` keeps the run fast), no retry for a non-retryable error, `RetryError` once `maxRetries` runs out, a cache write then cache-read tokens on a repeated prefix at under a fifth of the uncached cost, a projection that prices the prefix as a cache write and uses the call's own `maxOutputTokens`, and a budget middleware that refuses a call that fits alone but not on top of what is already spent, before it reaches the model (the projection's value is asserted as a literal, so a wrong rate fails). The same retry, cache and budget calls then run through `@ai-sdk/anthropic` with a stub `fetch` that answers in Anthropic's Messages wire format, the second wire protocol, offline. Prices are Claude Sonnet 5.5's from the gateway catalog, as of November 2026. The transcript and the example's `run-examples.json` entry are committed.

Limit: the Messages-format exchange leaves no request or answer events in the transcript, because the recorder attaches to `ai/test`'s mock model, which `createAnthropic` bypasses; only its `check()` results are recorded. A follow-up could record wire calls (for example from the stub `fetch`); this todo leaves T5's recorder unchanged.

Still open: the two code-review rounds, which belong to the pull request, and the writing review of the header and README copy (Task 6's last clause).
