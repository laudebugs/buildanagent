# T44: Example: context-block memory that survives eviction and stays inside one agent

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T44` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [U18](../done/U18-research-retrieval-and-long-term-memory.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/cloudflare-agents/examples/` so Chapter T36 ("Retrieval and long-term memory") has code behind its subject. The example shows a writable memory block and an FTS5 search block in `agents/context`, written and searched by a mock model through `set_context` and `search_context`, surviving the eviction of the Durable Object, and invisible to a second agent name. U18's research found the gap: no Cloudflare example writes long-term memory, and none has tested FTS5 in local workerd. Cloudflare's strongest search runs on Vectorize and Workers AI, which have no local simulation, so an offline example must search the agent's own SQLite. The owner approved this example on 2026-11-19.

## Context

- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and Chapter T36's todo, [T36](T36-chapter-retrieval-and-long-term-memory.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools
- The harness's README and `examples/lib/` helpers
- [U18's report](../../research/memory/retrieval-and-memory.md#all-eight-sdks-retrieve-through-tools-six-ship-long-term-memory-and-none-expires-it-in-the-process): context blocks are per chat and experimental
- `verify/cloudflare-agents/examples/08-hibernation.ts`: the eviction pattern this example reuses
- [Context blocks, mirrored](../../reference/cloudflare-agents/source/agents/docs/agents/context.md): every export of `agents/context` may change between releases

## Scope

**In scope**

- One or more examples in `verify/cloudflare-agents/examples/`, each asserting its behaviour with `check()`
- `// #region` and `// book:note` markers for the chapter's listings
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- Chapter T36's prose (its own todo)
- Our own packages' versions of the same behaviour (the chapter's switch todos)

## Tasks

- [ ] Name the example `10-context-memory.ts`, the next free number in `verify/cloudflare-agents/examples/`.
- [ ] Declare one writable memory block and one FTS5 search block, and script the mock model to call `set_context` and then `search_context`.
- [ ] Evict the Durable Object, and assert with `check()` that the block's content and the search result both survive.
- [ ] Address a second agent name, and assert that it sees neither the block nor the search result.
- [ ] Record in the example's header whether FTS5 ran in local workerd, and that the APIs are experimental as of November 2026.
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or reference, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [ ] No mock model in the example calls a tool that touches the host
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/cloudflare-agents`, and the root `pnpm test`.

## Docs to update

- `verify/cloudflare-agents/README.md`: the new example
- The plan's §4 row for the chapter

## Risks and open questions

- The SDK may not support the behaviour offline; record the limit in the chapter todo and the harness README instead of writing an example that only pretends.
- FTS5 may not work in local workerd. If it fails, record the limit in the harness README and in Chapter T36's todo, and keep the writable-block half of the example.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
