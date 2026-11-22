# N3: `SessionStore`: memory and JSONL backends, the conformance suite and the write-time bound

| Field | Value |
| --- | --- |
| ID | `N3` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N2](../ongoing/N2-session-entries-schema.md) |
| Size | M |

## Goal

Build the store every other component writes through, with an idempotent append, a compare-and-swap for remote backends, a torn-line-tolerant reader and the 64 KiB entry bound, and pin it with a conformance suite. Every call that finds a session takes the user as well as the session id, so the owner check is part of the lookup and no caller can forget it.

**Amended by the owner on 2026-11-19 ("yes, i accept these").** The book's Chapter 5 found that a session id finds a session but proves nothing about who may open it: LangChain's `MemorySaver` files threads by `thread_id` alone, the Claude Agent SDK searches every project for an id, and only ADK's `getSession` asks for the app, the user and the session id together ([Chapter 5, "A session id finds a session; your server decides whose it is"](../../../apps/manual/src/content/chapters/memory-and-sessions.md)). Our store follows ADK: a session is keyed by its user and its id, every method that reads or changes one takes both, and a session that exists under another user looks exactly like one that does not exist.

## Context

- [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api): the API sketch
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): `SessionStore`, idempotent append, write-time bound, user entry first
- [build-harness.md §5.2](../../plans/build-harness.md#52-conformance-suites-pin-each-interface-that-has-more-than-one-implementation): the store suite
- Chapter 5 of the book, `apps/manual/src/content/chapters/memory-and-sessions.md`, section "A session id finds a session; your server decides whose it is": the four ownership rules, the table of where each SDK keeps state and whether its lookup is scoped by user, and ADK's `getSession` as the model to follow

## Scope

**In scope**

- `memoryStore()` and `jsonlStore({ dir, maxEntryBytes })`
- A session key made of the user and the session id, such as `{ userId, sessionId }`, taken by `append`, `load` and `delete`; `list()` takes the user and returns only that user's sessions. No method finds a session by its id alone
- One result for a missing session and for another user's session, so a caller cannot tell them apart
- `append` idempotent by entry id; `expectedLastId` compare-and-swap
- `load({ fromSeq })` that skips a torn last line and reports it once
- `list()` from session headers; `delete()`
- `EntryTooLargeError` above 64 KiB
- `runStoreConformance(factory)` in `./testing`

**Out of scope** (and which todo covers it)

- Locking (N4)
- Spilling oversize tool output to a file (N8)

## Tasks

- [ ] Write each JSONL line with one `appendFile` call ending in `\n`, and `fsync` the file before `append` resolves.
- [ ] Assign `seq` in the store, monotonically per session.
- [ ] Key every method by user and session id, and have the JSONL backend file each user's sessions apart, such as one directory per user, so a lookup under one user cannot open another user's file.
- [ ] Update the `SessionStore` sketch in [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api) to the new signatures, and check the key that each todo calling the store passes, starting with N4, N6 and N7.
- [ ] Decide whether `openSession` and `SessionLock.acquire` take the same user-and-session key, and record the decision in the [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api) sketch. We recommend yes: key both by `{ userId, sessionId }`, so neither an open nor a lock can reach another user's session. If the decision is yes, note the new key in [N4](N4-writer-lock.md), which builds the lock.
- [ ] Run the conformance suite against both backends.

## Acceptance criteria

- [ ] Appending the same entry twice stores it once
- [ ] An append with a stale `expectedLastId` fails with `ConflictError` and writes nothing
- [ ] A file whose last line is cut mid-JSON loads every complete entry
- [ ] An entry over 64 KiB throws `EntryTooLargeError`
- [ ] `append`, `load` and `delete` each require a user and a session id, and a type test shows that a call with the session id alone fails to compile
- [ ] Loading Ada's session under Bob's user id returns the same result as loading an id that was never created, and `list()` under Bob's user id leaves out Ada's sessions; the conformance suite checks both on each backend
- [ ] Both backends pass the same conformance suite
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/store.conformance.test.ts`.

## Docs to update

`packages/harness/README.md`: the store interface, why every lookup takes the user, and how to add a backend. The `SessionStore` sketch in [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

`fsync` cost on every append may be visible in N19-style timings; record it, do not drop it.

The personal coding agent has one user, so its sessions all share one user id. The key still carries it, because a store can hold more than one user's sessions, as LangChain's `MemorySaver` and the Claude Agent SDK's config directory do in Chapter 5. A lookup must then name the user even where a deployment also isolates each user, as the platform does by making each user a tenant whose tasks run in Durable Objects named by tenant ([ADR 0037](../../decisions/0037-multi-user-agent-platform.md)). Adding the user later would change every caller.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
