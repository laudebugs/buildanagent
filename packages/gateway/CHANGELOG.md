# @buildanagent/gateway

## 0.1.0-alpha.25

### Patch Changes

- e4395da: Document every export, so the generated API reference has a description for each function, class, interface and type

## 0.1.0-alpha.24

No changes in this release.

## 0.1.0-alpha.23

No changes in this release.

## 0.1.0-alpha.22

No changes in this release.

## 0.1.0-alpha.21

No changes in this release.

## 0.1.0-alpha.20

### Minor Changes

- 5e87946: Breaking Changes: mockTransport() now records credential header values and URL keys as `[redacted]`, so `requests[n].headers["x-api-key"]` no longer holds the key an adapter sent. A test that needs it wraps the transport in a function that reads `request.headers` before passing the request on.

## 0.1.0-alpha.19

No changes in this release.

## 0.1.0-alpha.18

No changes in this release.

## 0.1.0-alpha.17

No changes in this release.

## 0.1.0-alpha.16

### Minor Changes

- 7840c5b: `run_start` now carries a real `defaultsHash` and `capabilities` instead of the reserved empty values. The SDK exports both: `DEFAULTS_HASH`, a SHA-256 over every default value, built-in prompt and tool description the SDK uses, and `CAPABILITIES`, the thirteen behaviours this release supports, such as `steering_v1`. A future change to a default changes the hash and is named in the changelog. Both packages now ship an `llms.txt` that indexes the README and lists every public export. The gateway README's `assertStreamContract()` example now passes `model.ref`, as `ModelAdapter.stream()` requires. No default, prompt or tool text changed.

## 0.1.0-alpha.15

### Minor Changes

- a1a0e6a: Breaking Changes: `ModelEvent` gains a `raw` member, `{ type: "raw"; event: unknown }`, so a `switch` over a model event's `type` that must stay exhaustive needs a `raw` case. No stream emits one unless you ask: `StreamOptions` gains `includeRaw` (default off), and with it off every stream is unchanged. With it on, the Anthropic and OpenAI Chat adapters stream one raw event per server-sent event, as `{ event, data }` with `data` unparsed, before the normalized events it produced. A raw event is not output, so the gateway still retries a call that failed before any content, and the `retry` event marks the failed attempt's raw events superseded. Adapters still declare `specificationVersion: "v1"`.

## 0.1.0-alpha.14

### Minor Changes

- b7c1318: Export the retry rules the SDK's loop reuses: `retryDelay()`, `retryHintMs()`, `abortableSleep`, `MAX_RETRY_DELAY_MS` and `DEFAULT_INITIAL_RETRY_DELAY_MS`.

## 0.1.0-alpha.13

No changes in this release.

## 0.1.0-alpha.12

### Minor Changes

- 46f4a9c: New in `@buildanagent/gateway/testing`: `startMockServer({ api, script, log })` serves a `mockTransport()` script over HTTP on 127.0.0.1, refuses to bind to a non-loopback address, and appends each request to a JSON Lines log with its credential headers redacted. Its `transport` lets an in-process adapter reach it while real model requests are off. `CREDENTIAL_HEADERS`, `isCredentialName()`, `redactHeaders()`, `redactUrl()` and `stripCredentials()` are the credential strippers every recorder uses; the server also redacts key-carrying query parameters such as `?key=`.

## 0.1.0-alpha.11

### Minor Changes

- adddc21: Add an optional `retires` date to `CatalogEntry`, for the day a provider says a model stops answering. `parseCatalog()` checks it like `asOf`.

## 0.1.0-alpha.10

No changes in this release.

## 0.1.0-alpha.9

No changes in this release.

## 0.1.0-alpha.8

No changes in this release.

## 0.1.0-alpha.7

No changes in this release.

## 0.1.0-alpha.6

No changes in this release.

## 0.1.0-alpha.5

No changes in this release.

## 0.1.0-alpha.4

No changes in this release.

## 0.1.0-alpha.3

### Minor Changes

- 1adde94: Breaking Changes: the gateway's `StreamContractError` and `ModelRequestsDisabledError`, and the SDK's `UnexpectedModelCallError`, now extend their package's error class, which changes four things you may rely on:
  
  - `isGatewayError()` now returns true for `StreamContractError` and `ModelRequestsDisabledError`, and `isSdkError()` for `UnexpectedModelCallError`. If you check the guard before the class, check the class first, or switch on `code`: `stream_contract`, `model_requests_disabled` or `unexpected_model_call`.
  - `GatewayErrorCode` and `SdkErrorCode` have new members, so an exhaustive `switch` over either needs a case for each.
  - `GatewayError.name` and `SdkError.name` are typed `string`, not a string literal, because the subclasses set their own names. Compare `name` with a string, or use the guards.
  - The constructors of `ModelRequestsDisabledError` and `UnexpectedModelCallError` take one required `message` and no `ErrorOptions`. Pass the message alone.
  
  Run your agent with `run()`. The loop sends your system prompt and the user's message to the model, runs each tool the model calls, one at a time and in order, and sends the results back until the model answers without calling a tool. A tool whose `exposure` is `"deferred"` or `"hidden"` is never sent to the model.
  
  - **Stop reasons, not exceptions.** A run ends with a result whose `stopReason` is `done`, `max_steps`, `error`, `aborted` or `stopped`, the last when a `clarificationTool()` asked the user a question. `maxSteps` counts model calls and defaults to 20; reaching it emits a `warning` event with `code: "max_steps"`. An `error` result copies the failed call's `kind`, such as `overflow`, with its message and HTTP status. Only the `done` result carries `output`, so TypeScript rejects `result.output` until you have checked the stop reason. Every result carries the summed `usage` and `cost`, the messages the run added, and a `context` to continue from.
  - **Output tools end the run.** Pass an `outputTool()` as `output`: once the model calls it with input that passes the schema, the run ends `done` with the validated answer as `result.output`. A call that fails the schema spends one model call.
  - **`runOrThrow()` and `continueRun()`.** `runOrThrow(run)` returns a `done` result and throws a `RunStoppedError`, carrying the result and its context, for any other. `RunStoppedError.isInstance()` recognises it. `continueRun(context, options)` goes on from a stored context.
  - **Aborts leave a well-formed transcript.** `run.abort()` or the `signal` option stops the run. Every tool call keeps a result, calls that hadn't started get an error result, and the last message is an assistant message with `stopReason: "aborted"`.
  - **One closed set of events.** Iterating a run streams its events from the first one: `run_start`, the step and model-call events, the text, reasoning and tool-input deltas, the tool-call events, `retry`, `warning`, `error`, `abort`, `agent_settled` and `run_end`. `AGENT_EVENT_TYPES` lists every type, and a run emits no other.
  - **Errors you can recognise by code.** `SdkError` gains the codes `invalid_run_options`, `invalid_model_stream`, `run_stopped` and `unexpected_model_call`; `UnexpectedModelCallError` is now an `SdkError`. In the gateway, `StreamContractError` and `ModelRequestsDisabledError` are now `GatewayError`s, with the codes `stream_contract` and `model_requests_disabled`, so `isGatewayError()` returns true for them. The gateway also exports `addCost()`, which adds two costs by the rule a retried call's cost already follows.
  - **`ScriptedModel.assertComplete()` catches over-runs.** It now also throws when the model was called after its last scripted step. Behind `createModel()`, a run reports such a call as an `error` result, not a throw, so this check is what fails the test.

## 0.1.0-alpha.2

No changes in this release.

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
