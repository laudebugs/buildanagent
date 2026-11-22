# N33: Retention settings and the transcript schema page (HD11)

| Field | Value |
| --- | --- |
| ID | `N33` |
| Status | `done` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N5](N5-head-fork-revert.md), [N2](N2-session-entries-schema.md) |
| Size | S |

## Goal

Add the retention setting with archive and purge, and publish the transcript schema as documentation practitioners' own tools can depend on.

## Context

- [HD11](../../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted): the decision and its evidence
- [ADR 0018](../../decisions/0018-retention-and-transcript-schema.md): the decision records
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): retention instead of a silent purge; a documented schema

## Scope

**In scope**

- `retention: { days, action }` with no default deletion
- `archive`: gzip into `archive/`, still found by `sessions search`; `purge`: delete files and the pointer
- `packages/harness/docs/session-format.md`: every entry type, the stable fields and the `formatVersion` policy
- A disk-cost note from the capstone's recorded sessions, projected to a month

**Out of scope** (and which todo covers it)

- Choosing the retention default (the owner)

## Tasks

- [x] Run expiry only at session open and from an explicit `sessions prune` command, never in the background.

## Acceptance criteria

- [x] With no retention set, no file is ever deleted
- [x] An expired session under `archive` is gzipped and still searchable
- [x] The schema page lists every type in `SESSION_ENTRY_TYPES` (test)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/retention.test.ts`, `schema-doc.test.ts`.

## Docs to update

The new `session-format.md`; ADR 0018's status after the owner answers. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Retention is in `@buildanagent/harness/session/jsonl` and the schema page is `packages/harness/docs/session-format.md`. The 12 tests in `test/session/retention.test.ts` and the 3 in `schema-doc.test.ts` cover the acceptance criteria.

- **No deletion without a period.** `pruneSessions()` with no `retention` returns at once, and `jsonlStore()` without `retention` never runs it. A test ages a folder by 10,000 days, calls `pruneSessions()`, then lists and loads through the store, and the file list is unchanged and no `archive/` exists.
- **Archive.** `retention.ts` gzips each file of an expired session to `<dir>/archive/<user>/<file>.jsonl.gz`, through a temp file and a rename, and removes the original only after the archive reads back to the same bytes. The pointer stays. `jsonlStore()` lists, loads and `loadRaw()`s a session from its archive when the live file is missing, so anything built on those calls, the CLI's `sessions search` (N30) included, finds an archived session. A write to one restores its file first. The `sessions search` command itself does not exist yet, so the test searches through `list()` and `openSession()`.
- **Purge.** It deletes the session's files and its pointer. An expired session that a surviving fork continues is kept, so no log loses its ancestors, and a session whose lock is held, or whose file can't be read, is kept too.
- **A session is its first file plus the derived files that continue it,** found through the pointer and each header's `parent`. A spawned child's `parent` names no shared path, so it expires on its own.
- **When expiry runs.** `jsonlStore({ retention })` runs it once for a user on the first `list`, `load`, `loadRaw` or `append` for that user, and `pruneSessions()` runs it when called, which is what `sessions prune` will call. Nothing runs on a timer. A failure goes to `onRetentionError`.
- **The schema page.** `session-format.md` documents the six base fields, all twenty types field by field, the `formatVersion` policy, the files and the retention rules. `schema-doc.test.ts` fails when a type in `SESSION_ENTRY_TYPES` has no section, when a section's fields differ from the JSON Schema's, or when a field is marked optional differently from the schema's `required`.
- **Disk cost.** The page's projection comes from a scripted 20-turn session written through `runTurn()` and `jsonlStore()`, about 10 KB and 13 entries a turn. The harness capstone (N35) does not exist yet, so the numbers are a synthetic measurement, and N35 should replace them with its recorded sessions.
- **ADR 0018** said the JSON Schema was published in `packages/harness/schema/`. It is in `packages/protocol/schema/`, as the plan says, and the ADR now says so. Its status is unchanged, because the owner has no new answer.
- **Not done, left to later todos.**
  - The memory purge marks and the targeted purge (N52). The retention purge deletes whole sessions, so it needs no marks yet, and an `archive` keeps them.
  - The `sessions prune` and `sessions search` commands (N30).
  - Expiry of derived files left in an archive after a later purge, and of a file no pointer reaches other than a first file.
