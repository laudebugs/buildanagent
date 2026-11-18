# B7: Per-provider tool-name table and the canonical name rule

| Field | Value |
| --- | --- |
| ID | `B7` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 2](../../plans/build-sdk.md#42-stage-2-adds-the-two-wire-adapters-and-the-replay-pass-between-them) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B1](B1-sdk-workspace-scaffold.md) |
| Size | S |

## Goal

Replace the assumed 64-character floor with a table built from each first provider's API reference, before any naming code ships.

## Context

- [D12](../../plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising-provisional)
- [tools note §8](../../research/agent-sdk/notes/tools.md#8-names-should-be-namespaced-by-source-and-sanitized-to-the-strictest-provider): namespacing and sanitising to the strictest provider

## Scope

**In scope**

- A table in `packages/gateway/src/names.md` (and the adapter READMEs): allowed characters, length limit, case rules and the source URL for each D2 provider, as of the check date
- `names.ts`: the canonical rule, `assertCanonicalName()`, and a reversible `sanitize()` and `restore()` per adapter

**Out of scope** (and which todo covers it)

- Using the names in tools (B10) or adapters (B8, B9)

## Tasks

- [ ] Read each provider's API reference for tool or function names and record the rule with a link and date.
- [ ] Set the canonical rule to the strictest intersection; record any change from `^[A-Za-z0-9_-]{1,64}$` in ADR 0011 as a superseding note.
- [ ] Implement `sanitize()` and `restore()` so that `restore(sanitize(n)) === n` for every canonical name, with a hash suffix when truncation is needed.
- [ ] Test with names from the deep-comparison capstones and an `mcp__<server>__<tool>` example.

## Acceptance criteria

- [ ] The table lists both D2 providers with a source URL and a check date
- [ ] `assertCanonicalName()` rejects a 65-character name and a name with a space
- [ ] `restore(sanitize(n)) === n` holds for 1,000 generated canonical names
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/names.test.ts`.

## Docs to update

ADR 0011 (status note), `packages/gateway/README.md`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

A provider page may be unreachable from the build environment; record it as unchecked and keep the floor.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
