# N3: `SessionStore`: memory and JSONL backends, the conformance suite and the write-time bound

| Field | Value |
| --- | --- |
| ID | `N3` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-the-session-log) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N2](N2-session-entries-schema.md) |
| Size | M |

## Goal

Build the store every other component writes through, with an idempotent append, a compare-and-swap for remote backends, a torn-line-tolerant reader and the 64 KiB entry bound, and pin it with a conformance suite.

## Context

- [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api): the API sketch
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): `SessionStore`, idempotent append, write-time bound, user entry first
- [build-harness.md §5.2](../../plans/build-harness.md#52-conformance-suites-pin-each-interface-that-has-more-than-one-implementation): the store suite

## Scope

**In scope**

- `memoryStore()` and `jsonlStore({ dir, maxEntryBytes })`
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
- [ ] Run the conformance suite against both backends.

## Acceptance criteria

- [ ] Appending the same entry twice stores it once
- [ ] An append with a stale `expectedLastId` fails with `ConflictError` and writes nothing
- [ ] A file whose last line is cut mid-JSON loads every complete entry
- [ ] An entry over 64 KiB throws `EntryTooLargeError`
- [ ] Both backends pass the same conformance suite
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/store.conformance.test.ts`.

## Docs to update

`packages/harness/README.md`: the store interface and how to add a backend. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

`fsync` cost on every append may be visible in N19-style timings; record it, do not drop it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
