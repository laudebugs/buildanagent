# @buildanagent/gateway

## 0.1.0-alpha.1

### Minor Changes

- ee97e50: Breaking Changes: a reply whose usage the provider never reported now costs `null`, not $0, and a `ScriptedModel` script without `usage` now reports no usage. To keep a known zero in a test, pass `usage: {}`. In a budget, handle `cost.total === null`. Retries now wait as long as the provider asks, and stop when it asks for more than 60 seconds.
  
  - **Unreported usage costs `null`, not $0.** A reply that ends without usage now has `usage.unreported: true` and a cost of `{ total: null, basis: "unknown" }`. Common cases are a request whose connection fails before any response, an OpenAI-compatible stream without its usage chunk, and an Anthropic stream that never reports its final `output_tokens` after content began. Before, these were priced as a known $0, which a budget would count as free. `unreportedUsage()` builds such a record for an adapter you write. A provider-billed total still wins, and an HTTP error response still counts as zero tokens.
  - **Retries honour `retry-after`.** Both adapters read `retry-after` (seconds or an HTTP date) and `retry-after-ms` from a failed response and put the hint on `error.retryAfterMs`. `createModel()` waits for the longer of its backoff and the hint, capped at 60 seconds. A hint over 60 seconds ends the call with the `retryable` error and no `retry` event, so you can wait and call again. `quota`, `overflow` and `fatal` errors are still never retried.
  - **`ScriptedModel` scripts without `usage` report none.** Such a response's usage is now `unreported`, so it is priced as unknown. Pass `usage: {}` to script a response that reports zero tokens.

## 0.1.0-alpha.0

### Minor Changes

- First public release. The gateway calls a model through one transcript and one stream format, whichever provider serves it.
  
  - **Transcript types.** `Message`, its content blocks and `AssistantMessage`, which records the model, the stop reason, a typed error, the token `Usage` and the `Cost` of every reply.
  - **`createModel()`.** Binds an adapter to a model id, retries a failed call only before the model streams output, runs `ModelMiddleware` around every call, and hands `onRequest` a copy of each request it sends.
  - **The price catalog.** `defaultCatalog` prices every message's usage, `projectCallCost()` estimates a call before you send it, and an unknown price is `null`, never zero.
  - **`transformMessages()`.** Prepares a transcript recorded on one model for another: it drops failed turns and reasoning the target can't read, and pairs every tool call with its result.
  - **The tool-name rule.** `createToolNameMap()` and `TOOL_NAME_RULES` keep one tool name valid for every provider.
  - **Two adapters.** `anthropic()` from `@buildanagent/gateway/anthropic` speaks the Anthropic Messages API, and `openaiChat()` from `@buildanagent/gateway/openai-chat` speaks Chat Completions to OpenAI and to servers that copy it.
  - **Offline testing.** `@buildanagent/gateway/testing` holds `mockTransport()`, the stream-contract check and seeded randomness, and importing `@buildanagent/gateway/testing/setup` keeps a test file offline: it blocks requests to any host but the local machine and stops a run that finds a provider API key.
