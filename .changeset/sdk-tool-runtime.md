---
"@buildanagent/sdk": minor
---

Define your agent's tools with `defineTool()`, `outputTool()` and `clarificationTool()`. This release only defines and checks tools: the loop that calls the model and runs them comes in a later release, and the rules below apply to every call it makes. A tool's input schema is either a Standard Schema that can describe itself as JSON Schema, such as a Zod 4.2 schema, or raw JSON Schema, draft 2020-12 or draft 7. `defineTool()` compiles the schema when you call it, so a broken tool throws at once.

- **Validation and repair.** Each call's arguments are coerced by three listed rules, such as `"42"` to `42` for an integer field, and then validated. An optional `repair` hook gets one chance to fix invalid input.
- **Errors the model can fix.** An unknown tool, invalid input or a throwing `execute` becomes an error result, never an exception. The model reads the failing JSON Pointer paths, the arguments it sent and an instruction not to substitute invented data. `formatError` replaces that text, and `redactErrors: true` keeps a thrown message out of the model's view and in `details`.
- **Calls that never run.** No call runs from a response that stopped at the output limit, ended in an error or was aborted, and no call starts once the run is cancelled. Each such call gets an error result instead; after a cut-off response, the model is asked to send the call again.
- **Write outcomes.** A tool that changes the world declares `effect: { kind: "write" }` and may return an `outcome`. The model reads the outcome's sentence and fields first, and every kind except `applied` marks the result as an error.
- **`SdkError` for mistakes in your code.** The SDK throws `SdkError`, with a typed `code`, for a bad tool definition, a malformed tool result or an invalid outcome. `isSdkError()` recognises it.

The SDK now needs Node 22.19 or later, the oldest release its validator, pi-schema 1.5.2, supports.
