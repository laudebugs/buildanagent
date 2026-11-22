# N5: HEAD, checkout, fork, revert and migration by pointer

| Field | Value |
| --- | --- |
| ID | `N5` |
| Status | `ready` |
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

- [ ] Store the pointer index as JSON beside the session files; update it with write-to-temp then `rename`.
- [ ] Make `path()` follow `parentId` from HEAD to the root, crossing into a parent file when the header names one.

## Acceptance criteria

- [ ] After `checkout(x)` and a reload with no further append, `head()` is `x`
- [ ] `revert` leaves the original file byte-identical
- [ ] A fork's `path()` includes the parent prefix without copying it
- [ ] A crash between writing a migrated file and the `rename` leaves the old pointer valid
- [ ] `child({ stepId: "step:reader" })` writes a `subagent_link` with `stepId` and no `spawningCallId`, and `child({ spawningCallId })` the reverse
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/head.test.ts`, `fork-revert.test.ts`, `migrate.test.ts`.

## Docs to update

`packages/harness/README.md`: HEAD, fork and revert. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
