---
"@buildanagent/sdk": minor
---

Define your agent's tools with `defineTool()`, `outputTool()` and `clarificationTool()`. A tool's input schema is a Standard Schema, such as a Zod 4 schema, or raw JSON Schema (drafts 2020-12 and 7). Every failed call reaches the model as an error result it can act on, never as an exception.

- **Validation and repair.** Each call's arguments are coerced with a few listed rules, such as `"42"` to `42` for an integer field, then validated. An optional `repair` hook gets one chance to fix invalid input.
- **Errors the model can fix.** An unknown tool, invalid input or a throwing `execute` returns the failing JSON Pointer paths, the received arguments, and an instruction not to substitute invented data. `formatError` replaces that text, and `redactErrors: true` hides a thrown message from the model while keeping it in `details`.
- **Cut-off responses.** A call from a response that stopped at the output limit is not run; the model is asked to re-issue it.
- **Write outcomes.** A result may carry a write `outcome`. Any kind except `applied` marks the result as an error, and the model reads the outcome's sentence and fields first. A tool that changes the world declares `effect: { kind: "write" }`.
- **`SdkError`.** The SDK throws `SdkError`, with a typed `code`, only for programmer errors, such as an invalid tool name or a malformed tool result. `isSdkError()` recognises it.
