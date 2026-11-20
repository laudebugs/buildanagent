# T56: Example: a LangChain server that refuses another user's thread with the same "not found" as a missing one

| Field | Value |
| --- | --- |
| ID | `T56` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T15](../done/T15-chapter-memory-and-sessions.md) |
| Size | S |

## Goal

Add a small example to `verify/langchain` that shows Chapter 5's ownership rules in code, and list it in that chapter. The chapter's section "A session id finds a session; your server decides whose it is" says that LangChain's `MemorySaver` files snapshots by `thread_id` alone, so Bob's call with Ada's thread id loads Ada's thread. It then recommends four rules, two of which this example shows: look a thread up by its owner and its id together, and answer a missing thread and someone else's thread with the same "not found". As of November 2026 the chapter states those rules with no listing, because no example in our harnesses enforces them. The owner accepted the example on 2026-11-19 ("yes, i accept these").

## Context

- Chapter 5, `apps/manual/src/content/chapters/memory-and-sessions.md`, section "A session id finds a session; your server decides whose it is", and its fact-check log `apps/manual/fact-checks/memory-and-sessions.md`.
- `verify/langchain/examples/05-thread-memory.ts`: the existing thread example, whose `MemorySaver`, `fakeModel()` and `thread_id` config this example reuses.
- [T15's Outcome](../done/T15-chapter-memory-and-sessions.md#outcome): how the chapter was written and checked.
- `apps/manual/README.md`, "A listing shows a region of a real file" and "Notes, SDK tabs and replays make a listing interactive": regions, notes and replays.
- [N3](N3-session-store.md): our own session store, which the owner's decision of the same day makes take the user on every lookup, so the check this example writes by hand is built into our harness.
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): examples run offline against a mock model and touch nothing on the host.

## Scope

**In scope**

- `verify/langchain/examples/11-thread-owner.ts`, or the next free number, with a `// #region` around the server's lookup and `// book:note` markers on the owner check and the shared "not found"
- A server function, such as `chat(user, threadId, message)`, that records the owner when it creates a thread and checks it on every later call before it invokes the agent
- Its transcript, committed under `verify/langchain/results/transcripts/`
- A listing with notes and a replay in Chapter 5's ownership section, woven into the existing paragraphs, with fact-check rows

**Out of scope** (and which todo covers it)

- Ownership in our own harness's session store: [N3](N3-session-store.md)
- Generating thread ids on the server and keeping transcripts per user, the chapter's first and fourth rules: the example may show the first in passing, but needs neither

## Tasks

- [ ] Write the example: Ada starts a thread and the server records her as its owner; Bob sends Ada's thread id; Bob sends an id nobody created; Ada resumes her thread.
- [ ] Return one "not found" value, word for word the same, for Bob's two calls, and invoke the agent for neither.
- [ ] Add checks for each step, a region and the notes, and run `pnpm test` in `verify/langchain` twice to confirm the transcript is byte-identical.
- [ ] List the region in Chapter 5's ownership section with `replay`, weave it into the paragraphs that state the rules, and fact-check each changed claim into the chapter's log, marking any superseded row ✏️.
- [ ] Run `/anthropic-skills:writing-review` on the changed section and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [ ] The example passes offline, and its checks confirm that Bob's call with Ada's thread id and his call with an unknown id return the same "not found", that neither call reaches the model, and that Ada's next call still sees her earlier messages
- [ ] Two runs of the harness's `pnpm test` write a byte-identical transcript, and `results-drift.mjs` reports no drift
- [ ] Once the example lands, Chapter 5's section "A session id finds a session; your server decides whose it is" lists it with notes and a replay, in the same pull request, and its fact-check log gains a row for each claim the listing and the changed prose make
- [ ] `check:book`, the manual's `test` and `build`, and `pnpm fact-check-logs` pass
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The new example under the harness's `pnpm test`; `node --test scripts/ci/*.test.mjs` for the transcript checks; the manual's `test` for the listing.

## Docs to update

- `verify/langchain/README.md`: the example list
- [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents): Chapter 5's examples
- Chapter 5 and its fact-check log

## Risks and open questions

- Where the owner is stored is the example's choice: a map beside the checkpointer, or metadata in the checkpoint itself. A map is easier to read; checkpoint metadata survives a restart with the checkpointer. Pick the one that keeps the listing shortest, and say in a note that a real server keeps it in its database.
- The example must not suggest that LangChain is wrong. The chapter's point is that a thread id finds a thread and proves nothing about who may open it, so the check belongs to the server in every SDK.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
