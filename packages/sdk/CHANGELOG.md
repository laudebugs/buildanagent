# @buildanagent/sdk

## 0.1.0-alpha.2

### Minor Changes

- 2d6d028: Define your agent's tools with `defineTool()`, `outputTool()` and `clarificationTool()`. This release only defines and checks tools: the loop that calls the model and runs them comes in a later release, and the rules below apply to every call it makes. A tool's input schema is either a Standard Schema that can describe itself as JSON Schema, such as a Zod 4.2 schema, or raw JSON Schema, draft 2020-12 or draft 7. `defineTool()` compiles the schema when you call it, so a broken tool throws at once.
  
  - **Validation and repair.** Each call's arguments are coerced by three listed rules, such as `"42"` to `42` for an integer field, and then validated. An optional `repair` hook gets one chance to fix invalid input.
  - **Errors the model can fix.** An unknown tool, invalid input or a throwing `execute` becomes an error result, never an exception. The model reads the failing JSON Pointer paths, the arguments it sent and an instruction not to substitute invented data. `formatError` replaces that text, and `redactErrors: true` keeps a thrown message out of the model's view and in `details`.
  - **Calls that never run.** No call runs from a response that stopped at the output limit, ended in an error or was aborted, and no call starts once the run is cancelled. Each such call gets an error result instead; after a cut-off response, the model is asked to send the call again.
  - **Write outcomes.** A tool that changes the world declares `effect: { kind: "write" }` and may return an `outcome`. The model reads the outcome's sentence and fields first, and every kind except `applied` marks the result as an error.
  - **`SdkError` for mistakes in your code.** The SDK throws `SdkError`, with a typed `code`, for a bad tool definition, a malformed tool result or an invalid outcome. `isSdkError()` recognises it.
  
  The SDK now needs Node 22.19 or later, the oldest release its validator, pi-schema 1.5.2, supports.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- ee97e50: Breaking Changes: a reply whose usage the provider never reported now costs `null`, not $0, and a `ScriptedModel` script without `usage` now reports no usage. To keep a known zero in a test, pass `usage: {}`. In a budget, handle `cost.total === null`. Retries now wait as long as the provider asks, and stop when it asks for more than 60 seconds.
  
  - **Unreported usage costs `null`, not $0.** A reply that ends without usage now has `usage.unreported: true` and a cost of `{ total: null, basis: "unknown" }`. Common cases are a request whose connection fails before any response, an OpenAI-compatible stream without its usage chunk, and an Anthropic stream that never reports its final `output_tokens` after content began. Before, these were priced as a known $0, which a budget would count as free. `unreportedUsage()` builds such a record for an adapter you write. A provider-billed total still wins, and an HTTP error response still counts as zero tokens.
  - **Retries honour `retry-after`.** Both adapters read `retry-after` (seconds or an HTTP date) and `retry-after-ms` from a failed response and put the hint on `error.retryAfterMs`. `createModel()` waits for the longer of its backoff and the hint, capped at 60 seconds. A hint over 60 seconds ends the call with the `retryable` error and no `retry` event, so you can wait and call again. `quota`, `overflow` and `fatal` errors are still never retried.
  - **`ScriptedModel` scripts without `usage` report none.** Such a response's usage is now `unreported`, so it is priced as unknown. Pass `usage: {}` to script a response that reports zero tokens.

### Patch Changes

- Updated dependencies [ee97e50]
  - @buildanagent/gateway@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- First public release, holding the testing export; the agent loop comes in a later release.
  
  - **`ScriptedModel`.** Plays back scripted responses, one per model call, and fails a test whose calls drift from the script: a call past the last step throws `UnexpectedModelCallError`, and `assertComplete()` throws if a step was never used.
  - **Deterministic helpers.** `fixedClock()` and `sequentialIds()` give the same clock readings and ids on every run.

### Patch Changes

- Updated dependencies
  - @buildanagent/gateway@0.1.0-alpha.0
