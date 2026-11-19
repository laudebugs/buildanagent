# B10: Tool definitions, the validation pipeline and the validator check (D7)

| Field | Value |
| --- | --- |
| ID | `B10` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B3](../done/B3-scripted-model.md), [B7](../done/B7-tool-name-table.md), [E1](../done/E1-safety-core-outcomes.md) |
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

- [x] Add `@earendil-works/pi-schema` 1.5.2 to `packages/sdk` (exact pin); add `@cfworker/json-schema` 4.1.6 as a dev dependency for the check only.
- [x] Implement the pipeline as a function `(call, tools, ctx) => Promise<ToolResult>` that never throws for model-caused failures.
- [x] Write strict-schema fixtures from the Anthropic and OpenAI API references in `packages/sdk/test/fixtures/strict-schemas/`, since B8 and B9 come later.
- [x] Write the D7 check: run both validators on those fixtures and on draft-07 output schemas; record results in `packages/sdk/docs/validator-check.md`.
- [x] If pi-schema fails a schema that the fallback passes, switch, and update ADR 0007. (It fails none, so D7 stands; ADR 0007 records the check.)
- [x] Validate `outputTool` results and return schema failures to the model as `isError` results.
- [x] Load the chosen validator inside workerd (Cloudflare's runtime) in a smoke test; if pi-schema fails there, switch D7 to `@cfworker/json-schema` for every target (added 2026-11-18, [ADR 0033](../../decisions/0033-three-deployment-targets.md))

## Acceptance criteria

- [x] An unknown tool name, invalid input, a throwing `execute` and a `repair` that returns a fixed call each have a test, and none throws out of the pipeline
- [x] An invalid-input error lists each failing JSON Pointer path and the received arguments
- [x] The default error text contains the do-not-substitute instruction, and `formatError` overrides it
- [x] With `redactErrors: true`, a thrown error's message is absent from the model-facing content and present in `details`
- [x] A `length`-stopped message produces one re-issue error per tool call and runs no `execute`
- [x] `validator-check.md` lists every schema tested and the result for both validators
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/tool-pipeline.test.ts`, `output-tool.test.ts`, and the check script under `packages/sdk/scripts/`.

## Docs to update

ADR 0007 (if the check changes it), `packages/sdk/README.md`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Coercion rules (for example string to number) are ours; keep them minimal and listed in the README.

## Revision (2026-11-18, SDK gaps)

Gap 1 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) gives every write a typed outcome. When this todo defines `ToolResult`, add an optional `outcome?: WriteOutcome` field, typed by the safety package's [E1](../done/E1-safety-core-outcomes.md), and these criteria:

- [x] A tool that returns `outcome` with any kind except `applied` has `isError` set for the model, and the model-facing content includes the outcome sentence.
- [x] `outcome` round-trips through a `context` JSON serialisation.
- [x] `ToolDefinition` gains an optional `effect?: { kind: "write"; businessKey?(input: I): string }`. A tool without it counts as read-only for the crash rule in the [N7](../ready/N7-rebuild-resume-replay.md) and [N40](../ready/N40-code-initiated-calls.md) revisions, which read this field.

The owner accepted [ADR 0043](../../decisions/0043-standalone-safety-core.md) and SG3, including this `effect` field, on 2026-11-18, so this revision is in force and E1 is in **Depends on**.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/sdk` now exports `defineTool()`, `outputTool()`, `clarificationTool()`, `SdkError` and `isSdkError()`, and the types `ToolDefinition`, `ToolResult`, `ToolContext`, `ToolEffect`, `ToolFailure`, `SchemaIssue`, `ToolSchema`, `JsonSchema` and `WriteOutcome`. The pipeline lives in `packages/sdk/src/tools/pipeline.ts` as `runToolCall(call, tools, ctx)` and `runToolCalls(message, tools, ctx)`. It stays internal until B11's loop calls it.

Each criterion and the test that covers it:

- An unknown tool, invalid input, a throwing `execute` and a fixing `repair`, none throwing: `test/tool-pipeline.test.ts`, with repair's other paths (returns `undefined`, still invalid, throws) beside them.
- Each failing JSON Pointer path and the received arguments: `test/tool-pipeline.test.ts`, for raw JSON Schema and for Zod, including an escaped `~1`.
- The do-not-substitute line, and `formatError` replacing it: `test/tool-pipeline.test.ts`.
- `redactErrors`: `test/tool-pipeline.test.ts` checks that the thrown message is absent from the content and present in `details`, and that `formatError` receives the fixed line.
- A `length`-stopped message: `test/tool-pipeline.test.ts` checks one re-issue error per call and no `execute`. The same file checks that a message that ended in an error or was aborted runs none of its calls, and that a cancelled run starts no `repair` and no `execute`.
- `validator-check.md`: `scripts/validator-check.mjs` writes it, and `test/validator-check.test.ts` fails if pi-schema loses a case to the fallback or the file is stale.
- Outcomes: `test/tool-outcome.test.ts` checks `isError` for every kind, the sentence first in the content, the JSON round trip and an invalid outcome throwing `SdkError`.
- `effect`: `test/define-tool.test.ts`, with two `@ts-expect-error` type tests.
- `outputTool` and `clarificationTool`: `test/output-tool.test.ts`. The workerd smoke test: `test/workerd-validator.test.ts`.

Judgement calls:

- **The safety package is copied, not imported.** `@buildanagent/agent-safety` is private and unpublished, and the published SDK can't depend on it. The SDK therefore carries byte-identical copies of its `errors.ts`, `outcome.ts` and `render.ts` in `src/vendor/agent-safety/`, and `test/vendored-safety.test.ts` fails on drift. This breaks the one-home rule of the maintainability guideline, so the guidelines' Known gaps table records it, closed by [F5](../ready/F5-agent-safety-package.md), which publishes the package. Then the folder goes and the SDK imports the root export, as §3.1 plans. Moving the outcomes into the gateway would also give them one home, but it would contradict ADR 0043, which puts them in the safety package.
- **Fields left to later todos.** `ToolDefinition` has only the fields B10 uses, plus `kind` and `effect`. `exposure` belongs to B11, `executionMode`, `resourceKey` and `firstParty` to B12, `progressKey` to B14, and `execution` to the durable adapter. `kind` is optional and defaults to `function`.
- **Programmer errors throw.** A malformed result, an invalid outcome, a bad definition and duplicate names throw `SdkError`. A throwing `repair` or `formatError` becomes an error result, and its message goes to `details`. So that a throw never hides a write, the pipeline context's `onExecuted` hears of each call once `execute` returns, and `onResult` receives each result before the next call runs.
- **Coercion** has three rules: JSON text to an object or array, a decimal string to a number, and `"true"` or `"false"` to a boolean. They are listed in the SDK README.
- **The pack test links third-party dependencies.** The offline installs now link pi-schema and `@standard-schema/spec` from the workspace's own install. pi-schema 1.5.2 maps a `source` export condition to an unshipped `src/index.ts`, so Node can't load it under `--conditions=source`. Under that condition the test still imports every entry, and lets an entry that reaches pi-schema fail only with an error naming it; as of November 2026 that is the SDK's root entry alone. Reporting this to pi-schema is a follow-up.

