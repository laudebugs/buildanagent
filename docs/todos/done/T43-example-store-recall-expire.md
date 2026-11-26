# T43: Example: store, recall and expire a fact across runs on LangChain's store

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T43` |
| Status | `done` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [U18](../done/U18-research-retrieval-and-long-term-memory.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/langchain/examples/` so Chapter T36 ("Retrieval and long-term memory") has code behind its subject. The example shows the chapter's exercise. One `createAgent` run writes a sourced record with an expiry time to the store, a run on another `thread_id` recalls it through `runtime.store.search`, and after an injected clock passes the expiry, the recall tool drops and deletes the record. U18's research found the gap: `verify/langchain/examples/09-long-term-store.ts` writes and reads a fact inside one run, and none of the eight SDKs expires a memory inside the process, so the exercise needs an example that builds expiry and says so. The owner approved this example on 2026-11-19.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T36's todo, [T36](../done/T36-chapter-retrieval-and-long-term-memory.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [U18's report](../../research/memory/retrieval-and-memory.md#three-new-examples-would-give-the-chapter-its-listings-led-by-t41s-keyword-search): the recommended example, and why the expiry must be built
- `verify/langchain/examples/09-long-term-store.ts`: the store write this example extends, with its `runtime.store` cast
- [LangChain reference fact-check](../../reference/langchain/fact-check.md): F4 on the `runtime.store` type, and the U18 memory findings

## Scope

**In scope**

- One or more examples in `verify/langchain/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T36's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [x] Name the example `11-store-recall-expire.ts`, the next free number in `verify/langchain/examples/`.
- [x] Import `InMemoryStore` from `@langchain/langgraph`, not from `langchain`, whose export of that name is core's key-value store; assert in the example that the store passed to `createAgent` has `search`.
- [x] Store each record with a subject, the fact, a source, a created date and an expiry time, and read the time from a clock the example injects, never from `Date.now()`.
- [x] Recall the record in a second run on another `thread_id`, through a recall tool that calls `runtime.store.search` and filters out expired records.
- [x] Advance the clock past the expiry, and assert with `check()` that the recall tool returns nothing and that `store.get` no longer finds the record, because the tool deleted it.
- [x] Give the first run a `MemorySaver` checkpointer. After the delete, read that thread's checkpoint with `checkpointer.getTuple({ configurable: { thread_id } })`, and assert that the write's tool call still carries the fact, so the chapter can show that deleting a memory leaves the session log untouched.
- [x] If the example builds the store with an `index`, pass `index: { dims, embeddings }` with `SyntheticEmbeddings`, the form the installed `IndexConfig` accepts, and note in the header that the docs' `index: { embed, dims }` form fails to type-check.
- [x] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [x] No mock model in the example calls a tool that touches the host
- [x] The results-drift check passes after the committed results update
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/langchain`, and the root `pnpm test`.

## Docs to update

- `verify/langchain/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.

## Outcome

`verify/langchain/examples/11-store-recall-expire.ts` runs the chapter's exercise on LangGraph's `InMemoryStore`. A writer agent stores a record with a subject, fact, source, created time and expiry time. A reader agent on another `thread_id` recalls it through a tool that calls `runtime.store.search`, and after the injected clock passes the expiry the tool returns nothing and deletes the record, so `store.get` returns null. The first thread's `MemorySaver` checkpoint, read with `getTuple`, still holds the fact in the write's tool call. Its checks pass offline, and removing the tool's delete makes the example fail. The SDK supports the behaviour offline, so no limit needed recording. The example builds no `index`, because it needs none, so the `SyntheticEmbeddings` form and the docs' `index: { embed, dims }` trap are not exercised and the header says nothing about them (fact-check row T43-11). Its verdict joins `results/run-examples.json`, and its transcript is `results/transcripts/11-store-recall-expire.json`; two runs wrote it byte for byte. The claims are logged in [the example's fact-check log](../../plans/reviews/fact-check-langchain-store-example.md), rows T43-1 to T43-14. The plan's §4 row names the file, and T36's todo names its listing regions. The writing review is left for the pull request, after the code reviews.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
