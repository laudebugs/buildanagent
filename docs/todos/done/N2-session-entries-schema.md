# N2: Session entry union, its JSON Schema and the stable fields

| Field | Value |
| --- | --- |
| ID | `N2` |
| Status | `done` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N1](../done/N1-harness-workspace-scaffold.md), [B2](../done/B2-gateway-core-types.md) |
| Size | M |

## Goal

Define every `SessionEntry` type from §3.2 on the SDK's transcript types, in `@buildanagent/protocol` so the protocol never imports the harness, generate its JSON Schema, and mark the stable surface that practitioners' own tools may rely on.

## Context

- [build-harness.md §3.2](../../plans/build-harness.md#32-session-log-api): the entry union
- [HD1](../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional) and [HD11](../../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted): the decision and its evidence
- [harness guide §2](../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries): the typed tree, entries for every state change
- [ADR 0013](../../decisions/0013-log-entry-per-content-block.md), [ADR 0018](../../decisions/0018-retention-and-transcript-schema.md): the decision records

## Scope

**In scope**

- `packages/protocol/src/entries.ts`: `EntryBase`, `Origin` and every entry type except `approval_requested` and `approval_resolved`, which N13 adds, and `code_call`, which N40 adds; `@buildanagent/harness/session` re-exports them
- `turn_start.system`, so a rebuilt context carries the frozen system prompt (R6)
- `session_header.product` and the namespaced `product_record` entry, documented as outside HD11's stable surface (agent AH8)
- `permission_decision`, written by N12 on every `decide()` (agent AH9)
- `tool_result.trust` and `subagent_link.stepId` (agent AH10, AH3)
- `@buildanagent/gateway` as a `dependencies` entry of `@buildanagent/protocol`, used for types only
- A runtime list `SESSION_ENTRY_TYPES` and a type test that it matches the union
- `schema/session-entry.schema.json`, generated and committed, with a test that fails when it is stale
- `formatVersion: 1` and a `parseEntry()` that rejects unknown future versions

**Out of scope** (and which todo covers it)

- Storage (N3)
- Approval entries (N13)
- The documentation page (N33)

## Tasks

- [x] Import `ContentBlock`, `ModelContent`, `ModelRef`, `Usage`, `Cost` and `AssistantMessage` from `@buildanagent/gateway` unchanged, as type-only imports.
- [x] Type `turn_end.stopReason` as a string union copied from the SDK plan §3.3 until B11 exports `RunResult`, then switch to the import.
- [x] Write the schema generator script, or reuse N26's generator if N26 lands first.
- [x] Mark the stable fields with a `@stable` JSDoc tag.

## Acceptance criteria

- [x] Every entry type in §3.2 (bar the two approval types) exists, with `origin` on `EntryBase`
- [x] `parseEntry()` rejects `formatVersion: 2` with a typed error
- [x] The schema test fails after a field is added to a type without regenerating
- [x] A `usage` entry accepts `cost.total: null`
- [x] `product_record` and `permission_decision` entries validate against the schema, and `session_header.product` is optional
- [x] `@buildanagent/harness/session` re-exports the union, and no file in `packages/protocol` imports from `@buildanagent/harness`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/session/entries.test.ts`, `schema.test.ts`.

## Docs to update

`packages/harness/README.md`: the entry list. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The generator choice is shared with N26; pick one exact-pinned dev dependency for both.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The session entry union now lives in `@buildanagent/protocol`, with a generated JSON Schema, a `parseEntry()` that refuses an unknown format, and the stable fields marked. `@buildanagent/harness/session` re-exports it.

**Public API.**
- Types: `SessionEntry` (the base fields and eighteen entry types, each also exported by name), `EntryBase`, `Origin`, `PermissionMode`, `ApprovalPolicy` and `SandboxTier`.
- Values: `SESSION_ENTRY_TYPES`, `FORMAT_VERSION` (1), `parseEntry()`, `ProtocolError` with codes `invalid_entry` and `unsupported_format_version`, and `isProtocolError()`.
- `packages/protocol/schema/session-entry.schema.json`, a JSON Schema draft 2020-12 of one entry, with `additionalProperties: false` at each level.

**Behavior.**
- `parseEntry()` takes a JSON line or a parsed value. It checks the base fields, that `type` is in the list and that a `session_header` has `formatVersion: 1`; any other version throws `unsupported_format_version`. It does not check each type's own fields, which the schema covers.
- A `usage` entry accepts `cost.total: null`, `session_header.product` is optional, and `product_record` and `permission_decision` validate.
- A `@stable` tag marks the five base fields, `formatVersion` and each entry's `type`, and a test counts them.

**Decisions.**
- **The generator is zod, not a type-based tool.** TypeScript 7.0.2's programmatic API is unstable, so `ts-json-schema-generator` and its kind cannot read our types. A zod description in `packages/protocol/scripts/session-entry-schema.ts` mirrors the hand-written types, and `z.toJSONSchema` writes the file. A type test compares the field names of every entry in the two, the fixtures check the rest against the schema, and a staleness test compares the committed file with the generator's output. zod and `@cfworker/json-schema` are dev dependencies of the protocol package, so its built JavaScript imports neither. N26 should reuse the generator for its own schema.
- **The protocol defines `PermissionMode`, `ApprovalPolicy` and `SandboxTier`.** The plan's `env_stamp` names them from the harness, which the protocol must not import, so the protocol owns the three unions and the harness later imports them.
- **`turn_end.stopReason` imports the SDK's `RunResult`.** B11 is done, so the copied union is not needed.
- **The tests sit beside the code, in `packages/protocol/test`.** The todo named `packages/harness/test/session`, but the union and its schema live in the protocol, so its tests do; the harness has one test that its entry re-exports the same values.
- **The schema is not in the package's `files` yet.** The pack test allows only `dist/` and the licences, so the schema ships with the documentation todo (N33).
- **The `schema` directory is outside Biome's formatting,** so the committed file stays byte-equal to the generator's output.

**Left out.** Storage (N3), the approval entries (N13), `code_call` (N40) and the documentation page (N33). Deep validation inside `parseEntry()` stays with the schema, because a runtime validator would give the protocol a dependency.
