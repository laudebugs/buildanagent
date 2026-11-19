# T28: Example: streaming with usage and the four token classes

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T28` |
| Status | `ongoing` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` so Chapter T11 ("Talking to a model: messages, streams, tokens, instructions and model choice") has code behind its subject. The example shows a streamed response whose final usage reports input, cached-read, cached-write and output tokens, and a price computed from them. The coverage review found the gap: `claude-agent-sdk/01-hello-agent.ts` (16 lines) shows no stream and no usage, so it cannot support Chapter T11's token-class figure or its pricing exercise.

The same todo also writes the listing for Section T39 (fine-tuning versus prompting, in Chapter T11): a tuned model priced against a cached prompt, offline. U21's research proposed the example, because T39 had no listing and this harness already prices usage. The owner approved folding it into this todo on 2026-11-19, rather than giving it a todo of its own ([U21 report, Examples](../../research/fine-tuning/fine-tuning-vs-prompting.md#one-offline-example-would-give-the-section-its-listing-and-no-example-should-call-a-tuning-api)).

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T11's todo, [T11](T11-chapter-talking-to-a-model.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [U21 report, Examples](../../research/fine-tuning/fine-tuning-vs-prompting.md#one-offline-example-would-give-the-section-its-listing-and-no-example-should-call-a-tuning-api): the tuned-versus-cached example, its token counts, its four checks and its dated price table; Section T39's todo, [T39](T39-section-fine-tuning-vs-prompting.md)

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
- Section T39's prose ([T39](T39-section-fine-tuning-vs-prompting.md))

## Tasks

- [ ] Script `MockLanguageModelV4` to stream deltas and finish with a usage object that has non-zero `cacheRead` and `cacheWrite`.
- [ ] Assert with `check()` that the folded message equals the streamed text and that each usage field arrives.
- [ ] Price the run with a fixed table in the example, and assert the total.
- [ ] For Section T39, script two mock calls. The first sends a 4,000-token prefix of instructions and examples plus a 200-token question to a base model id; the second sends the question alone to a tuned model id. Both answer in 300 tokens.
- [ ] Price both from a small table in the example that holds GPT-4.1 mini's base and tuned rates, with the date they were copied and their source page. U21 computed $0.00216 for the uncached base call, $0.00096 with the prefix cached, and $0.00112 for the tuned call.
- [ ] Assert U21's four checks with `check()`:
  1. the tuned call pays twice the base rate per token;
  2. the uncached base call costs more than the tuned call;
  3. the cached base call costs less than the tuned call;
  4. against the uncached prompt, a $30 training run breaks even after 28,847 requests, and against the cached prompt it never does.
- [ ] Re-read the base and tuned rates on OpenAI's pricing page on the day the example is written, and recompute the four checks if they changed.
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [ ] No mock model in the example calls a tool that touches the host
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/vercel-ai-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/vercel-ai-sdk/README.md`: the new example
- The plan's §4 row for the chapter, and T39's listing

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.
- The tuned rates come from OpenAI's pricing page as of November 2026, and OpenAI stops all new training jobs on 6 January 2027. The example's table carries its date, so a later edition changes one place.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
