# T41: Example: retrieval over a small fixture, offline

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T41` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [U18](U18-research-retrieval-and-long-term-memory.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/vercel-ai-sdk/examples/` that shows a search tool over a small fixture corpus, keyword or vector with deterministic embeddings, whose results the model cites, and a check that a wrong top result misleads it, so Chapter T36 ("Retrieval and long-term memory") has code behind its subject. The coverage review found the gap: Chapter T36 teaches retrieval, and no example retrieves; U18 decides which form the book should show.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T36's todo, [T36](T36-chapter-retrieval-and-long-term-memory.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers

## Scope

**In scope**

- One or more examples in `verify/vercel-ai-sdk/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if the harness is covered

**Out of scope** (and which todo covers it)

- Chapter T36's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [ ] Read U18's recommendation first, and pick keyword search or a vector index with deterministic, scripted embeddings; use no embedding API and no new dependency unless the owner approves one.
- [ ] Keep the fixture corpus small and in the harness's `fixtures/`, and assert with `check()` which documents the tool returns for each query.
- [ ] Script a turn where the top result is wrong, and assert that the model's answer follows it, so the chapter can show the failure mode.
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
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
