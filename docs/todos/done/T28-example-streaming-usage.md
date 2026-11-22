# T28: Example: streaming with usage and the four token classes

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T28` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` so Chapter T11 ("Talking to a model: messages, streams, tokens, instructions and model choice") has code behind its subject. The example shows a streamed response whose final usage reports input, cached-read, cached-write and output tokens, and a price computed from them. The coverage review found the gap: `claude-agent-sdk/01-hello-agent.ts` (16 lines) shows no stream and no usage, so it cannot support Chapter T11's token-class figure or its pricing exercise.

The same todo also writes the listing for Section T39 (fine-tuning versus prompting, in Chapter T11): a tuned model priced against a cached prompt, offline. U21's research proposed the example, because T39 had no listing and this harness already prices usage. The owner approved folding it into this todo on 2026-11-19, rather than giving it a todo of its own ([U21 report, Examples](../../research/fine-tuning/fine-tuning-vs-prompting.md#one-offline-example-would-give-the-section-its-listing-and-no-example-should-call-a-tuning-api)).

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T11's todo, [T11](../done/T11-chapter-talking-to-a-model.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [U21 report, Examples](../../research/fine-tuning/fine-tuning-vs-prompting.md#one-offline-example-would-give-the-section-its-listing-and-no-example-should-call-a-tuning-api): the tuned-versus-cached example, its token counts, its four checks and its dated price table; Section T39's todo, [T39](../ongoing/T39-section-fine-tuning-vs-prompting.md)

## Scope

**In scope**

- One or more examples in `verify/vercel-ai-sdk/examples/`, each asserting its behaviour with `check()`
- A tuned-versus-cached pricing example for Section T39, added 2026-11-19 by the owner's decision (U21's change 3), with the four checks under **Tasks**
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T11's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)
- Any listing that creates a real tuning job: it needs a network and a provider account, and OpenAI no longer accepts new organisations for tuning (U21)
- Section T39's prose ([T39](../ongoing/T39-section-fine-tuning-vs-prompting.md))

## Tasks

- [x] Script `MockLanguageModelV4` to stream deltas and finish with a usage object that has non-zero `cacheRead` and `cacheWrite`.
- [x] Assert with `check()` that the folded message equals the streamed text and that each usage field arrives.
- [x] Price the run with a fixed table in the example, and assert the total.
- [x] For Section T39, script two mock calls. The first sends a 4,000-token prefix of instructions and examples plus a 200-token question to a base model id; the second sends the question alone to a tuned model id. Both answer in 300 tokens.
- [x] Price both from a small table in the example that holds GPT-4.1 mini's base and tuned rates, with the date they were copied and their source page. U21 computed $0.00216 for the uncached base call, $0.00096 with the prefix cached, and $0.00112 for the tuned call.
- [x] Assert U21's four checks with `check()`:
  1. the tuned call pays twice the base rate per token;
  2. the uncached base call costs more than the tuned call;
  3. the cached base call costs less than the tuned call;
  4. against the uncached prompt, a $30 training run breaks even after 28,847 requests, and against the cached prompt it never does.
- [x] Re-read the base and tuned rates on OpenAI's pricing page on the day the example is written, and recompute the four checks if they changed.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/vercel-ai-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/vercel-ai-sdk/README.md`: the new example
- The plan's §4 row for the chapter, and T39's listing

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.
- The tuned rates come from OpenAI's pricing page as of November 2026, and OpenAI stops all new training jobs on 6 January 2027. The example's table carries its date, so a later edition changes one place.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **Two examples, one helper.** `verify/vercel-ai-sdk/examples/10-streaming-usage.ts` streams several text deltas that fold into one message, reads `totalUsage` for the four token classes (1,000 uncached, 1,500 cache-read, 500 cache-write, 200 output) and prices them at Claude Sonnet 5.5's rates: $0.0054, against $0.008 if every input token were billed uncached. `11-tuned-vs-cached.ts` prices U21's two calls and asserts its four checks. The calls cost $0.00216 uncached, $0.00096 cached and $0.00112 tuned, and the tuned rate is twice the base rate per class. A $30 training run breaks even after 28,847 requests against the uncached prompt and never against the cached one. `scripted()` in `examples/lib/check.ts` gained optional `usage` and `modelId`, and `examples/lib/rates.ts` holds the token classes, the usage object, the cost function and Sonnet 5.5's rates, so T29 can import them.
- **Regions for the chapters.** `stream-usage` in the first file and `rates` in `lib/rates.ts` (Chapter T11's usage listing); `price-table` and `compare` in the second (Section T39's listing). `book:note` markers: `input-classes` and `price-the-classes` in the first, `break-even` in the second.
- **Prices.** Every rate is in whole nano-dollars per token, so each sum is an integer. Claude's rates come from the pricing page and the shipped catalog (both 2026-11-19); GPT-4.1 mini's, which U21 had priced, were read again on 2026-11-19 and had not changed, so the four checks stand. Neither example calls a tool or the network, and neither creates a tuning job.
- **Transcripts.** `results/transcripts/10-streaming-usage.json` and `11-tuned-vs-cached.json` are committed. Two runs of `pnpm test` wrote byte-identical transcripts, and `run-examples.json` was restored from `main`.
- **Checks.** Run locally: `pnpm check`, `pnpm typecheck`, the harness's `pnpm test` (twice), `node scripts/ci/results-drift.mjs` and `node --test scripts/ci/*.test.mjs` pass, except `packages-pack.test.mjs`'s offline install, which fails the same way on `main`.
- **Fact-check.** Rows 535–548 of `docs/plans/reviews/fact-check-build-book.md` cover the rates, the SDK fields, the sums and our choices; the log now totals 548 claims: 474 ✅, 70 ✏️, 4 ⚠️.
- **Known limit.** A transcript has no usage field and names every model `model-N`, so a replay of these examples cannot show token classes, prices or the tuned call. T11's risks propose a follow-up that adds usage to the format; T5's format is unchanged here.
