# T41: Example: retrieval over a small fixture, offline

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T41` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [U18](../done/U18-research-retrieval-and-long-term-memory.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` so Chapter T36 ("Retrieval and long-term memory") has code behind its subject. The example shows a search tool that ranks a fixture of about ten short documents with BM25, written inside the example. The model cites the tool's results, and four checks show where keyword search works and where it fails. The plan's code review found the gap: Chapter T36 teaches retrieval, and no example retrieves. The `search` tools in `claude-agent-sdk/04-max-turns.ts` and `openai-agents-sdk/08-max-turns.ts` return a fixed "3 hits" to test a turn cap. U18 recommended hand-written BM25, because it needs no new dependency and is the strongest keyword baseline, and the owner approved that form on 2026-11-19.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T36's todo, [T36](../ready/T36-chapter-retrieval-and-long-term-memory.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [U18's report](../../research/memory/retrieval-and-memory.md#three-new-examples-would-give-the-chapter-its-listings-led-by-t41s-keyword-search), the recommended form and its four checks

## Scope

**In scope**

- One or more examples in `verify/vercel-ai-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T36's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Write BM25 scoring in the example itself, with no embedding API and no new dependency; if hand-written scoring grows too long, propose `minisearch` to the owner instead of adding it.
- [x] Keep a fixture of about ten short documents in the harness's `fixtures/`, and assert with `check()` which documents the tool returns for each query.
- [x] Assert four behaviours with `check()`: an exact identifier, such as an error code, ranks its document first; a paraphrase that shares no words with its document misses; a tenant filter inside the query keeps another tenant's near-duplicate out of the top results; and a planted document ranked first misleads the scripted model, whose answer follows it.
- [x] Optionally (left out; see Outcome), add a hybrid variant that fuses the BM25 list with cosine scores from `MockEmbeddingModelV4` by reciprocal rank fusion at k = 60. If you write it, label the mock vectors in the example and its README line as a stand-in for semantic search.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [x] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/vercel-ai-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/vercel-ai-sdk/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Outcome

`verify/vercel-ai-sdk/examples/17-keyword-retrieval.ts` gives a tool loop a `search_docs` tool that ranks `fixtures/support-docs.json`, ten short documents from two tenants, with BM25 written in the example (k1 = 1.2, b = 0.75, Lucene's rarity term). It needs no new dependency, so no `minisearch` proposal is due. Its checks pass offline and read the tool's recorded calls and the ranked lists: the identifier E4021 finds only kb-01; a paraphrase with no shared word finds nothing, while the same need in the document's words ranks kb-02 first; a tenant filter applied before ranking keeps the globex near-duplicate kb-06 out of an acme search and each tenant's answer comes from its own document; and a planted document that repeats the question's words (kb-10) ranks first, the scripted answer repeats its instruction, and the same question without it gets the real answer. A last check finds that every model request offered only the `search_docs` function tool. The SDK supports the behaviour offline, so no limit needed recording. Two limits go to the chapter instead. The scripted model's second turn is defined to repeat the first result, so the planted-document check shows that ranking decides what the model reads, not that a real model would follow it. The example has no vector search, so the optional hybrid variant (RRF at k = 60 over `MockEmbeddingModelV4`) was left out and the chapter's fusion section has no listing from it. The example's verdict joins `results/run-examples.json`, and its transcript is `results/transcripts/17-keyword-retrieval.json`; two runs wrote it byte for byte. The claims are logged in [the example's fact-check log](../../plans/reviews/fact-check-keyword-retrieval-example.md), rows T41-1 to T41-14. The writing review is left for the pull request, after the code reviews.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
