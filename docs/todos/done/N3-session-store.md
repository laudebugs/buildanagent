# N3: `SessionStore`: memory and JSONL backends, the conformance suite and the write-time bound

| Field | Value |
| --- | --- |
| ID | `N3` |
| Status | `done` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N2](../done/N2-session-entries-schema.md) |
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

- [x] Write each JSONL line with one `appendFile` call ending in `\n`, and `fsync` the file before `append` resolves.
- [x] Assign `seq` in the store, monotonically per session.
- [x] Key every method by user and session id, and have the JSONL backend file each user's sessions apart, such as one directory per user, so a lookup under one user cannot open another user's file.
- [x] Update the `SessionStore` sketch in [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api) to the new signatures, and check the key that each todo calling the store passes, starting with N4, N6 and N7.
- [x] Decide whether `openSession` and `SessionLock.acquire` take the same user-and-session key, and record the decision in the [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api) sketch. We recommend yes: key both by `{ userId, sessionId }`, so neither an open nor a lock can reach another user's session. If the decision is yes, note the new key in [N4](../done/N4-writer-lock.md), which builds the lock.
- [x] Run the conformance suite against both backends.

## Acceptance criteria

- [x] Appending the same entry twice stores it once
- [x] An append with a stale `expectedLastId` fails with `ConflictError` and writes nothing
- [x] A file whose last line is cut mid-JSON loads every complete entry
- [x] An entry over 64 KiB throws `EntryTooLargeError`
- [x] `append`, `load` and `delete` each require a user and a session id, and a type test shows that a call with the session id alone fails to compile
- [x] Loading Ada's session under Bob's user id returns the same result as loading an id that was never created, and `list()` under Bob's user id leaves out Ada's sessions; the conformance suite checks both on each backend
- [x] Both backends pass the same conformance suite
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/store.conformance.test.ts`.

## Docs to update

`packages/harness/README.md`: the store interface, why every lookup takes the user, and how to add a backend. The `SessionStore` sketch in [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

`fsync` cost on every append may be visible in N19-style timings; record it, do not drop it.

The personal coding agent has one user, so its sessions all share one user id. The key still carries it, because a store can hold more than one user's sessions, as LangChain's `MemorySaver` and the Claude Agent SDK's config directory do in Chapter 5. A lookup must then name the user even where a deployment also isolates each user, as the platform does by making each user a tenant whose tasks run in Durable Objects named by tenant ([ADR 0037](../../decisions/0037-multi-user-agent-platform.md)). Adding the user later would change every caller.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The harness now has a `SessionStore` with a memory and a JSONL backend and a conformance suite, in `packages/harness/src/session/` and `src/testing/store-conformance.ts`. The plan's §3.2 sketch is updated to the signatures below.

**Public API.**
- `@buildanagent/harness/session`: `SessionStore`, `SessionKey`, `EntryInput`, `SessionSummary`, `AppendOptions`, `LoadOptions`, `memoryStore()`, `ConflictError`, `EntryTooLargeError` and `DEFAULT_MAX_ENTRY_BYTES`.
- `@buildanagent/harness/session/jsonl`: `jsonlStore({ dir, maxEntryBytes })`. It has its own entry because it needs Node's file system, and the portable `./session` entry must load in workerd.
- `@buildanagent/harness/testing`: `runStoreConformance()`, `storeConformanceCases()` and the factory types.
- Five new `HarnessError` codes: `session_conflict`, `entry_too_large`, `invalid_session_entry`, `invalid_session_key` and `session_corrupt`.

**Behavior.**
- Every method takes the user. A session under another user looks like a missing one on `load`, `delete` and `list`, and a type test shows a call with the session id alone fails to compile.
- `append` takes entries without `seq`, assigns it, validates each entry with `parseEntry()`, requires a `session_header` first and only first, and returns the stored entries. It is idempotent by id, with a `ConflictError` for an id stored with other content, and a partly stored batch finishes on a retry and conflicts if another writer has extended the log since.
- `expectedLastId` is a compare-and-swap, where `null` means the session must not exist.
- An entry over 64 KiB of JSON, in bytes, throws `EntryTooLargeError`, and a batch with one writes none of it.
- The JSONL store writes one `appendFile` of whole lines and an `fsync`, then syncs the folder for a new file. A torn last line is skipped by `load()`, reported once, and cut off by the next append.
- File names percent-encode every byte outside `a-z0-9_-`, so `..` can't climb out of a user's folder and `Ada` can't collide with `ada` on a case-insensitive file system. A key whose encoded name is over 200 bytes is refused by both stores.
- One process queues appends, loads and deletes per session, and keeps the state of the 64 logs used last.

**Decisions.**
- **`openSession` and `SessionLock.acquire` take the same `SessionKey`.** The todo recommended it, and the plan's sketch and N4's scope now say so, with N6 and N7 told to pass the key.
- **`jsonlStore` has its own entry,** `@buildanagent/harness/session/jsonl`, where the plan put it beside `memoryStore`. A Node import in the portable entry would break a Cloudflare bundle.
- **`append` returns the stored entries** and not `void`, so the runner gets each `seq` without a read.
- **A log must start with its header.** The plan's `list()` reads session headers, so a log without one can't be listed, and the store refuses it at the first write.
- **`load` of a missing session yields nothing** and doesn't throw, so another user's session and a missing one can't be told apart.
- **The cache is keyed by file size.** It saves rereading a log on every append, and a write by another process changes the size and forces a reread. The writer lock (N4) is still what keeps two processes from writing at once.
- **`fsync` on every append is kept.** Its cost wasn't measured here.

**Left out.** The writer lock (N4), spilling oversize tool output to a file (N8), and a SQLite projection for search, a later read-side index.

