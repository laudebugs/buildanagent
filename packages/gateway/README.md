# @buildanagent/gateway

The gateway lets your agent call any model through one transcript and one stream format, so switching providers never changes your agent code. Use it directly to call a model, or through `@buildanagent/sdk`, which runs the agent loop on top of it.

As of November 2026 the package holds the transcript types, the stream checker, `complete()` and `createModel()` with its retries and middleware. Pricing and the Anthropic and OpenAI adapters are next.

## A conversation is a list of messages you own

A conversation is a list of `Message`s: user messages, assistant messages and tool results. Their content is a short list of blocks (`text`, `reasoning`, `image` and `tool_call`), so your code never handles a provider's wire format. A reasoning block may carry a signature that only the model that wrote it accepts.

Every `AssistantMessage` records its model, why it stopped (`stopReason`), any typed `error`, its `Usage` and its `Cost`. `Usage` has no field named `input`, because providers disagree on whether input includes cached tokens. The uncached part is `uncachedInput`, and `totalInput()` adds the cache reads and cache writes to it. `Cost.total` is `null` when the price is unknown, never a guessed zero.

## Every stream follows one rule

A provider adapter implements one method, `stream()`. The stream it returns follows four rules:

1. `start` comes first, once.
2. Each content block runs `*_start`, then any number of `*_delta`, then `*_end`, and keeps one kind.
3. Exactly one terminal event, `done` or `error`, ends the stream.
4. An error terminal has `stopReason` `"error"` or `"aborted"` and carries the content and usage so far. A `done` terminal has neither stop reason, and every block it started has ended.

This check reads a stream and throws a `StreamContractError` at the first broken rule:

```ts
import { assertStreamContract } from "@buildanagent/gateway/testing";

const events = await assertStreamContract(adapter.stream(model, context, {}));
```

`complete()` folds a stream into its terminal message. It returns an error terminal's message instead of throwing, so a failed call still gives you its partial content and usage.

## A model is an adapter object plus a model id

`createModel()` binds one adapter to one model id. You always pass the adapter as an object that you made with your own API key, so a bare id such as `"claude-x"` is a type error and the gateway never guesses a provider:

```ts
const model = createModel({ adapter, id: "my-model", catalog });
const message = await model.complete(context);
```

`model.stream()` yields the adapter's events, and `model.complete()` folds them into the final message. `model.caps` holds the context window, the output limit, and whether the model takes images and reasoning. The gateway reads these caps from the model's catalog entry. For a model the catalog lacks, it uses the adapter's default caps, and it refuses a model that has neither.

## Your key is the only key the gateway sends

Every adapter takes a `ProviderConfig` whose `apiKey` you pass in. The gateway never reads a key from the environment and never falls back to another credential, so a key left in your shell cannot reach a provider. An adapter made without a key, or with an empty one, throws a `GatewayError` with code `missing_api_key` before it sends anything.

## Retries happen only before the model streams output

A call that fails before the model has streamed any content is retried twice by default. The first retry waits 2 seconds and the second waits 4, and each retry streams a `retry` event with the attempt number, the delay and the error. Set `retries` to change the count, or to 0 to turn retries off.

Three rules keep a retry from doing harm. First, once a content event has reached you, the gateway never retries, because a second attempt would replay text you have already seen. Second, only errors of kind `retryable` are retried, such as a rate limit or an overloaded server. A `quota` error, a context `overflow` or a `fatal` error ends the call at once, because waiting will not fix it. Third, aborting the signal during a wait ends the stream at once with `stopReason: "aborted"`.

A failed attempt still costs tokens, so the final message's `usage` adds up every attempt, not only the last. An adapter whose stream throws, for example on a dropped connection, is treated like one that ends with an error. A failed fetch is retried; any other throw ends the call with a `fatal` error event, so an adapter's failure never makes `stream()` throw. A middleware or `onRequest` hook that throws is your code failing, and its error reaches you from `stream()`.

Adapters sort a failed request into these four kinds with `classifyError()`, from its HTTP status and the provider's error code or message.

## Middleware wraps every call, first one outermost

A `ModelMiddleware` can rewrite the request with `transformParams` and watch or change the events with `wrapStream`. With `middleware: [a, b]`, `a` runs first: its `transformParams` sees your request before `b`'s does, and its `wrapStream` wraps `b`'s. Middleware runs once per call, outside the retries, so a `wrapStream` sees the `retry` events too.

## You can see the exact request of every attempt

`onPayload` in the stream options lets you inspect or replace the wire body just before an adapter sends it. Return the new body, or `undefined` to send the body unchanged.

`onRequest` in `createModel()` receives the full request of each attempt before it is sent: the attempt number, the model, the context, the stream options and the wire body after `onPayload`. The dump is a copy, so changing the context after the call doesn't change what it shows. Log it when a step misbehaves, and you see what the provider saw.

## Tests run offline

Start each test file with `import "@buildanagent/gateway/testing/setup"`. The setup blocks every request to a host other than your own machine, stops the run if a provider API key is set, and turns real model requests off. Your tests then never reach a real provider by accident.

Next: [@buildanagent/sdk](../sdk/README.md), which tests an agent against a scripted model.
