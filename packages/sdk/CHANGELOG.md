# @buildanagent/sdk

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
