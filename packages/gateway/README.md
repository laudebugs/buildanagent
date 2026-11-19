# @buildanagent/gateway

The model gateway gives the buildanagent SDK one provider-neutral way to call any model: a transcript it owns, one streaming method per provider, and a stream rule every adapter must follow. As of November 2026 it holds the core types, the stream checker and `complete()` (todo B2). Retries and middleware (B4), pricing (B5) and the Anthropic and OpenAI adapters (B8, B9) come next. The design is in the [SDK plan §3.2](../../docs/plans/build-sdk.md#32-gateway-api).

## The transcript belongs to us, not to a provider

A conversation is a list of `Message`s: user messages, assistant messages and tool results. Their content is a short list of `ContentBlock`s (`text`, `reasoning`, `image` and `tool_call`), so the loop never handles a vendor's wire format. A reasoning block may carry an `OpaqueToken` signature, which is valid only for the model that produced it.

Every `AssistantMessage` records its model, a `stopReason`, an optional typed `error`, its `Usage` and its `Cost`. `Usage` has no field named `input`, because providers disagree on whether input includes cached tokens. The uncached part is named `uncachedInput`, and `totalInput()` adds cache reads and both cache-write lifetimes to it. `Cost.total` is `null` when the price is unknown, never a guessed zero.

## Every stream follows one rule

An adapter implements one method, `stream(model, context, options)`, behind `specificationVersion: "v1"`. The stream it returns must follow four rules:

1. `start` comes first, once.
2. Each content index runs `*_start`, then any number of `*_delta`, then `*_end`, and keeps one kind (text, reasoning or tool input).
3. Exactly one terminal event, `done` or `error`, ends the stream, and nothing follows it.
4. An `error` terminal has `stopReason` `"error"` or `"aborted"` and carries any partial content and usage. A `done` terminal has neither stop reason, and every block it started has ended.

`assertStreamContract()` consumes a stream and throws a `StreamContractError` at the first broken rule, with the event's position. Adapter and test-model tests run every stream through it.

`complete()` folds a stream into its terminal message. It returns an `error` terminal instead of throwing, so a failed call still yields its partial content and usage.

## Tests run offline

Every test file starts with `import "@buildanagent/gateway/testing/setup"`. The setup blocks `fetch` to any host other than loopback and fails the run if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, so no test can reach a real provider. Run the tests with `pnpm test` from the repo root.
