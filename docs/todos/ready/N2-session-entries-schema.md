# N2: Session entry union, its JSON Schema and the stable fields

| Field | Value |
| --- | --- |
| ID | `N2` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-the-session-log) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N1](N1-harness-workspace-scaffold.md), [B2](B2-gateway-core-types.md) |
| Size | M |

## Goal

Define every `SessionEntry` type from §3.2 on the SDK's transcript types, generate its JSON Schema, and mark the stable surface that practitioners' own tools may rely on.

## Context

- [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api): the entry union
- [HD1](../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional) and [HD11](../../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-owner-to-confirm): the decision and its evidence
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): the typed tree, entries for every state change
- [ADR 0013](../../decisions/0013-log-entry-per-content-block.md), [ADR 0018](../../decisions/0018-retention-and-transcript-schema.md): the decision records

## Scope

**In scope**

- `src/session/entries.ts`: `EntryBase`, `Origin` and every entry type except `approval_requested` and `approval_resolved`, which N13 adds
- A runtime list `SESSION_ENTRY_TYPES` and a type test that it matches the union
- `schema/session-entry.schema.json`, generated and committed, with a test that fails when it is stale
- `formatVersion: 1` and a `parseEntry()` that rejects unknown future versions

**Out of scope** (and which todo covers it)

- Storage (N3)
- Approval entries (N13)
- The documentation page (N33)

## Tasks

- [ ] Import `ContentBlock`, `ModelContent`, `ModelRef`, `Usage`, `Cost` and `AssistantMessage` from `@agent-speak/gateway` unchanged.
- [ ] Write the schema generator script, or reuse N26's generator if N26 lands first.
- [ ] Mark the stable fields with a `@stable` JSDoc tag.

## Acceptance criteria

- [ ] Every entry type in §3.2 (bar the two approval types) exists, with `origin` on `EntryBase`
- [ ] `parseEntry()` rejects `formatVersion: 2` with a typed error
- [ ] The schema test fails after a field is added to a type without regenerating
- [ ] A `usage` entry accepts `cost.total: null`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/entries.test.ts`, `schema.test.ts`.

## Docs to update

`packages/harness/README.md`: the entry list. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The generator choice is shared with N26; pick one exact-pinned dev dependency for both.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
