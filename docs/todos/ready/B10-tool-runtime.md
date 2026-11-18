# B10: Tool definitions, the validation pipeline and the validator check (D7)

| Field | Value |
| --- | --- |
| ID | `B10` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B3](B3-scripted-model.md), [B7](B7-tool-name-table.md) |
| Size | M |

## Goal

Build the tool runtime the loop dispatches to: definitions, schema handling and the fixed pipeline that turns every failure into data the model can act on.

## Context

- [agent-SDK guide §4](../../guides/agent-sdk.md#4-tools-should-take-standard-schema-validate-inside-the-sdk-and-return-every-failure-to-the-model-as-data): Standard Schema, the fixed pipeline, error text, truncation, three result channels
- [D7](../../plans/build-sdk.md#d7-pi-schema-validates-raw-json-schema-and-b10-confirms-the-choice-against-both-candidates-provisional): the validator and its check
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api): `ToolDefinition`, `ToolResult`, `defineTool`, `outputTool`

## Scope

**In scope**

- `defineTool()`, `outputTool()` and `clarificationTool()`
- Schema input as Standard Schema with JSON Schema, or raw JSON Schema validated by pi-schema
- The pipeline: resolve name, coerce, validate, optional `repair`, gate placeholder, `execute`, `afterToolCall` placeholder
- The default error formatter: path-level messages, the received arguments, and a line telling the model not to substitute a mock or invented data
- Failing every tool call of a `length`-stopped message with a re-issue error
- The D7 check of pi-schema against `@cfworker/json-schema`
- `redactErrors` per tool: when true, a thrown error reaches the model as a fixed line, and the original message goes only to `details`

**Out of scope** (and which todo covers it)

- Gates and hooks (B13)
- Parallel scheduling (B12)

## Tasks

- [ ] Add `@earendil-works/pi-schema` 1.5.2 to `packages/sdk` (exact pin); add `@cfworker/json-schema` 4.1.6 as a dev dependency for the check only.
- [ ] Implement the pipeline as a function `(call, tools, ctx) => Promise<ToolResult>` that never throws for model-caused failures.
- [ ] Write strict-schema fixtures from the Anthropic and OpenAI API references in `packages/sdk/test/fixtures/strict-schemas/`, since B8 and B9 come later.
- [ ] Write the D7 check: run both validators on those fixtures and on draft-07 output schemas; record results in `packages/sdk/docs/validator-check.md`.
- [ ] If pi-schema fails a schema that the fallback passes, switch, and update ADR 0007.
- [ ] Validate `outputTool` results and return schema failures to the model as `isError` results.

## Acceptance criteria

- [ ] An unknown tool name, invalid input, a throwing `execute` and a `repair` that returns a fixed call each have a test, and none throws out of the pipeline
- [ ] An invalid-input error lists each failing JSON Pointer path and the received arguments
- [ ] The default error text contains the do-not-substitute instruction, and `formatError` overrides it
- [ ] With `redactErrors: true`, a thrown error's message is absent from the model-facing content and present in `details`
- [ ] A `length`-stopped message produces one re-issue error per tool call and runs no `execute`
- [ ] `validator-check.md` lists every schema tested and the result for both validators
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/tool-pipeline.test.ts`, `output-tool.test.ts`, and the check script under `packages/sdk/scripts/`.

## Docs to update

ADR 0007 (if the check changes it), `packages/sdk/README.md`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Coercion rules (for example string to number) are ours; keep them minimal and listed in the README.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
