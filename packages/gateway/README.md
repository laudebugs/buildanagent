# @buildanagent/gateway

The gateway lets your agent call any model through one transcript and one stream format, so switching providers never changes your agent code. Use it directly to call a model, or through `@buildanagent/sdk`, which runs the agent loop on top of it.

As of November 2026 the package holds the transcript types, the stream checker and `complete()`. Model creation, retries, pricing and the Anthropic and OpenAI adapters are next.

## A conversation is a list of messages you own

A conversation is a list of `Message`s: user messages, assistant messages and tool results. Their content is a short list of blocks (`text`, `reasoning`, `image` and `tool_call`), so your code never handles a provider's wire format. A reasoning block may carry a signature that only the model that wrote it accepts.

Every `AssistantMessage` records its model, why it stopped (`stopReason`), any typed `error`, its `Usage` and its `Cost`. `Usage` has no field named `input`, because providers disagree on whether input includes cached tokens. The uncached part is `uncachedInput`, and `totalInput()` adds the cache reads and cache writes to it. `Cost.total` is `null` when the price is unknown, never a guessed zero.

## Every stream follows one rule

A provider adapter implements one method, `stream()`. The stream it returns follows four rules:

1. `start` comes first, once.
2. Each content block runs `*_start`, then any number of `*_delta`, then `*_end`, and keeps one kind.
3. Exactly one final event, `done` or `error`, ends the stream.
4. An `error` event has `stopReason` `"error"` or `"aborted"` and carries the content and usage so far. A `done` event has neither stop reason, and every block it started has ended.

This check reads a stream and throws a `StreamContractError` at the first broken rule:

```ts
import { assertStreamContract } from "@buildanagent/gateway/testing";

const events = await assertStreamContract(adapter.stream(model, context, {}));
```

`complete()` folds a stream into its final message. It returns an `error` message instead of throwing, so a failed call still gives you its partial content and usage.

## Tests run offline

Start each test file with `import "@buildanagent/gateway/testing/setup"`. The setup blocks every request to a host other than your own machine, stops the run if a provider API key is set, and turns real model requests off. Your tests then never reach a real provider by accident.

Next: [@buildanagent/sdk](../sdk/README.md), which tests an agent against a scripted model.
