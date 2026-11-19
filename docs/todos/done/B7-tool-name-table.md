# B7: Per-provider tool-name table and the canonical name rule

| Field | Value |
| --- | --- |
| ID | `B7` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 2](../../plans/build-sdk.md#42-stage-2-adds-the-two-wire-adapters-and-the-replay-pass-between-them) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B1](../done/B1-sdk-workspace-scaffold.md) |
| Size | S |

## Goal

Replace the assumed 64-character floor with a table built from each first provider's API reference, before any naming code ships.

## Context

- [D12](../../plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising-accepted)
- [tools note §8](../../research/agent-sdk/notes/tools.md#8-names-should-be-namespaced-by-source-and-sanitized-to-the-strictest-provider): namespacing and sanitising to the strictest provider

## Scope

**In scope**

- A table in `packages/gateway/src/names.md` (and the adapter READMEs): allowed characters, length limit, case rules and the source URL for each D2 provider, as of the check date
- `names.ts`: the canonical rule, `assertCanonicalName()`, and a reversible `sanitize()` and `restore()` per adapter

**Out of scope** (and which todo covers it)

- Using the names in tools (B10) or adapters (B8, B9)

## Tasks

- [x] Read each provider's API reference for tool or function names and record the rule with a link and date.
- [x] Set the canonical rule to the strictest intersection; record any change from `^[A-Za-z0-9_-]{1,64}$` in ADR 0011 as a superseding note.
- [x] Implement `sanitize()` and `restore()` so that `restore(sanitize(n)) === n` for every canonical name, with a hash suffix when truncation is needed.
- [x] Test with names from the deep-comparison capstones and an `mcp__<server>__<tool>` example.

## Acceptance criteria

- [x] The table lists both D2 providers with a source URL and a check date
- [x] `assertCanonicalName()` rejects a 65-character name and a name with a space
- [x] `restore(sanitize(n)) === n` holds for 1,000 generated canonical names
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/names.test.ts`.

## Docs to update

ADR 0011 (status note), `packages/gateway/README.md`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

A provider page may be unreachable from the build environment; record it as unchecked and keep the floor.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `packages/gateway/src/names.md` holds the table. As of November 2026, Anthropic Messages allows `^[a-zA-Z0-9_-]{1,128}$` and OpenAI Chat Completions allows the same characters at up to 64, so the canonical rule stays `^[A-Za-z0-9_-]{1,64}$`. ADR 0011 has a status note, not a superseding rule.
- The OpenAI row comes from `FunctionDefinition.name` in the Chat Completions API reference on `developers.openai.com`. That site did not resolve when B7 was drafted, and the medium review round reached it on 2026-11-19. OpenAI's TypeScript SDK at v7.49.0 has the same words. Neither provider states a case rule, so the name map salts names that differ only in case. The [fact-check log](../../plans/reviews/fact-check-tool-name-rule.md) records each claim.
- `src/names.ts` exports `CANONICAL_TOOL_NAME`, `isCanonicalName()`, `assertCanonicalName()` (a `GatewayError` with the new code `invalid_tool_name`), `TOOL_NAME_RULES`, and `createToolNameMap()`, whose `sanitize()` and `restore()` replace the per-adapter pair the scope named: an adapter builds one map from its rule and keeps it for the run.
- Every canonical name passes through both first protocols unchanged, so the hash-suffix path is tested under a stricter 16-character rule.
- For B8, B9 and B10: the adapters build their map from `TOOL_NAME_RULES.anthropicMessages` and `TOOL_NAME_RULES.openaiChat`, and `defineTool()` calls `assertCanonicalName()`.
