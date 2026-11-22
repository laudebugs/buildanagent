# N33: Retention settings and the transcript schema page (HD11)

| Field | Value |
| --- | --- |
| ID | `N33` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N5](N5-head-fork-revert.md), [N2](../done/N2-session-entries-schema.md) |
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

- [ ] Run expiry only at session open and from an explicit `sessions prune` command, never in the background.

## Acceptance criteria

- [ ] With no retention set, no file is ever deleted
- [ ] An expired session under `archive` is gzipped and still searchable
- [ ] The schema page lists every type in `SESSION_ENTRY_TYPES` (test)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/retention.test.ts`, `schema-doc.test.ts`.

## Docs to update

The new `session-format.md`; ADR 0018's status after the owner answers. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
