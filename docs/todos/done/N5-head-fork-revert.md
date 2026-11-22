# N5: HEAD, checkout, fork, revert and migration by pointer

| Field | Value |
| --- | --- |
| ID | `N5` |
| Status | `done` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N4](../done/N4-writer-lock.md) |
| Size | M |

## Goal

Persist HEAD as `checkout` entries and make fork, revert and format migration write new immutable files and move a pointer, so no operation rewrites history.

## Context

- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): persisted HEAD, Codex's immutable files and one mutable pointer
- [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api): `Session`

## Scope

**In scope**

- `openSession()`, `Session.head()`, `path()`, `checkout()`
- `fork(entryId)` and `revert(entryId)` writing a new file whose header names the parent prefix
- An index file mapping session key to current file, replaced atomically (write then `rename`)
- `migrate()` that writes, verifies and publishes a new file, rejecting unknown future versions
- `Session.child(link)` taking `{ spawningCallId }` or `{ stepId }`, with `subagent_link` recording whichever was given (agent AH3)

**Out of scope** (and which todo covers it)

- Rebuilding a `Context` (N7)
- Retention (N33)

## Tasks

- [x] Store the pointer index as JSON beside the session files; update it with write-to-temp then `rename`.
- [x] Make `path()` follow `parentId` from HEAD to the root, crossing into a parent file when the header names one.

## Acceptance criteria

- [x] After `checkout(x)` and a reload with no further append, `head()` is `x`
- [x] `revert` leaves the original file byte-identical
- [x] A fork's `path()` includes the parent prefix without copying it
- [x] A crash between writing a migrated file and the `rename` leaves the old pointer valid
- [x] `child({ stepId: "step:reader" })` writes a `subagent_link` with `stepId` and no `spawningCallId`, and `child({ spawningCallId })` the reverse
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/head.test.ts`, `fork-revert.test.ts`, `migrate.test.ts`.

## Docs to update

`packages/harness/README.md`: HEAD, fork and revert. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The harness now has `Session`, with a persisted HEAD, fork, revert, child and migration by pointer, in `packages/harness/src/session/`. The plan's §3.2 sketch holds with the differences below.

**Public API.**
- `@buildanagent/harness/session`: `openSession()`, `listSessions()`, `Session` (`head()`, `path()`, `checkout()`, `append()`, `fork()`, `revert()`, `child()`, `file()`, `writable()`, `close()`), `SessionIndex` with `memoryIndex()`, `migrateSession()` with `Migration` and `MigrationResult`, `ChildLink`, and `DERIVED` and `isDerivedFile()`.
- `@buildanagent/harness/session/jsonl`: `fileIndex({ dir })`.
- `SessionStore` gains an optional `loadRaw(key)`, which both stores implement.
- Four new `HarnessError` codes: `session_locked`, `session_read_only`, `entry_not_found` and `unsupported_format`.

**Behavior.**
- HEAD is derived from the log: an entry moves it to itself and a `checkout` to the entry it names. `checkout()` appends a `checkout` entry, so a reload finds HEAD where it was left.
- A fork or revert writes a file with a header (copying what ran the session, and naming the parent file and entry) and a `checkout` of that entry. `path()` follows `parentId` and crosses into the parent file when an entry isn't in this one, leaving out the headers of the files it crosses and every `checkout`.
- `fork()` returns a session under a new key and leaves this one alone. `revert()` writes the file, then moves the pointer, and returns this session on the new file. The old file is byte-identical afterwards, and a pointer that fails to move leaves the old file in use.
- `child()` writes the child's file with no parent, then appends a `subagent_link` with exactly one of `spawningCallId` and `stepId`.
- `migrateSession()` reads the raw entries, runs the migrations in order, checks the result with `parseEntry()`, writes one new file, reads it back and compares, and then moves the pointer. A newer format, a missing step or a log with no header is `unsupported_format`.

**Decisions.**
- **The pointer is a separate `SessionIndex`,** not part of `SessionStore`, because the store's files are immutable by design and the pointer is the one thing that moves. A session with no pointer is in the file named like its key, so a plain session needs no index entry.
- **`openSession()` takes an `index`, and its `lock` is optional.** A session with a lock is the writer, and one without is a reader, which the plan's "readers never lock" asks for.
- **`head()` is `string | null`.** The plan's `string` has no answer for a session before its header.
- **`Session.append()` is added.** The plan's `Session` had no way to write, and N6 needs one that is guarded by the end of the log this session has seen, so a writer that lost its lock fails the compare-and-swap.
- **A revert returns this session,** though the plan's signature says it returns a session: the logical session is the same, and only its file changed.
- **Physical file names are the session id for a first file, and a generated id after.** A revert's file is `r<id>`, a migrated one `m<id>`, and a fork or child takes its new session id as its file name.
- **A file in another format is `unsupported_format`.** `load()` reported it as `session_corrupt`, which sends a reader to look for damage in a whole file. It now says what it is.
- **A file that continues a parent can't be migrated, and a session with forks can't either.** Only the current file moves, so a revert's or a fork's parent would stay in the old format and make the session unreadable, and the forks that name a migrated file as their parent would too. `migrateSession()` refuses the first case, after it has seen that the log needs migrating, and can't see the second, because a store has no index of dependents. Migrating a whole tree of branches is left for when a second format exists. It takes the session's writer lock for the whole migration.
- **A fork or child whose link can't be written leaves its file behind.** The file is a session nothing links to, which retention (N33) removes.
- **A session's tree is its file plus the path to its fork point.** Entries the parent writes after a fork, and entries a revert went back from, aren't reachable from the new file, though they stay in the old one. Without this a fork could check out what it was never given, and a parent growing would change the fork.
- **Derived files have names that start with `~`** (`DERIVED`), which `listSessions()` leaves out. The store itself still lists every file. Deleting a session across its files, and what a delete does to forks that name it as a parent, belong to retention (N33).

**Left out.** Rebuilding a `Context` (N7), deleting a session across its files and removing orphaned files (N33), migrating a session that has branches, and migrations themselves, because only format 1 exists.

