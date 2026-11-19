# @buildanagent/gateway

The gateway lets your agent call any model through one transcript and one stream format, so switching providers never changes your agent code. Use it directly to call a model, or through `@buildanagent/sdk`, which runs the agent loop on top of it.

As of November 2026 the package holds the transcript types, the stream checker, `complete()`, `createModel()` with its retries and middleware, the price catalog that puts a cost on every message, and `transformMessages()`, which prepares a transcript for the model you send it to. The Anthropic and OpenAI adapters are next.

## A conversation is a list of messages you own

A conversation is a list of `Message`s: user messages, assistant messages and tool results. Their content is a short list of blocks (`text`, `reasoning`, `image` and `tool_call`), so your code never handles a provider's wire format. A reasoning block may carry a signature that only the model that wrote it accepts.

Every `AssistantMessage` records its model, why it stopped (`stopReason`), any typed `error`, its `Usage` and its `Cost`. `Usage` has no field named `input`, because providers disagree on whether input includes cached tokens. The uncached part is `uncachedInput`, and `totalInput()` adds the cache reads and cache writes to it. `Cost.total` is `null` when the price is unknown, never a guessed zero.

## A transcript recorded on one model replays on another

You can start a conversation on one model and continue it on another, even from another provider. Before each request, `transformMessages()` turns your transcript into one that the target model accepts:

```ts
const messages = transformMessages(transcript, model.ref, model.caps);
```

The pass returns a new array and leaves your transcript as it was, so you keep the full record. It changes five things:

- **Failed turns.** It leaves out every assistant message that stopped with `"error"` or `"aborted"`. A resumed call then asks the model again instead of building on a half-written answer.
- **Reasoning.** A reasoning signature is valid only for the provider, and often only for the model, that wrote it. The pass drops reasoning that another provider wrote and removes any signature the target cannot check. An Anthropic model accepts thinking from any Anthropic model, so an Anthropic target gets every Anthropic thinking block exactly as recorded, empty ones included.
- **Images.** For a model that takes no images (`caps.images` is `false`), each image becomes a short text note.
- **Tool-call ids.** Each id must be 1 to 64 letters, digits, `_` or `-`, and must not repeat. The pass rewrites any id that breaks the rule and updates the result that answers it.
- **Tool results.** Each result moves next to the call it answers, and a result that answers no call is dropped. A call that never got a result gets a synthetic one with `isError: true`, because providers reject a call left unanswered.

When the pass must drop reasoning, it also drops every reasoning block before the newest one it drops, so the blocks it keeps are the newest unbroken run. Anthropic checks each thinking block against everything sent before it, and a gap in the middle would fail that check. The pass gives the same answer for the same transcript every time, and running it on its own output changes nothing, so an earlier message looks the same in every request.

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

## Every message carries its cost, priced from a catalog you can replace

The gateway prices each response from the price catalog, so every `AssistantMessage` arrives with a `cost`. The catalog lists each model's rates in USD per million tokens for every token class: uncached input, cache reads, 5-minute and 1-hour cache writes, and output. Reasoning tokens are part of output, so they cost the output rate. The cost's `basis` tells you where its number came from:

- `"provider"`: the adapter reported a total the provider billed, and that total wins over the catalog.
- `"catalog"`: the gateway multiplied each token class by its catalog rate, and `catalogAsOf` gives the date those rates were copied.
- `"unknown"`: the catalog doesn't list the model, or an attempt's stream threw before it reported usage, so `total` is `null`. The gateway never guesses a zero, because a budget that counts an unknown price as free never stops.

A retried call's cost sums its attempts, and the sum takes the weakest basis among them. It is `"unknown"` if any attempt's cost is unknown, and `"catalog"`, with `catalogAsOf`, if any attempt was priced from the catalog. It is `"provider"` only when the provider billed every attempt.

Some models charge more for long prompts. Their entries list several rate tiers, and each request pays the tier its total input selects, cache reads and writes included. The gateway prices each attempt of a call on its own before it adds them up, so a retried call pays each request's own tier. `model.price(usage)` applies the same rates to one request's usage.

`createModel()` uses the catalog that ships with the package, `defaultCatalog`, unless you pass your own. A catalog you pass replaces the shipped one, so spread the shipped entries into it to keep them:

```ts
import { createModel, defaultCatalog, parseCatalog } from "@buildanagent/gateway";

const catalog = parseCatalog({ models: [...defaultCatalog.models, myEntry] });
const model = createModel({ adapter, id: "my-model", catalog });
```

Each entry records its rate tiers, `contextWindow`, `maxOutputTokens`, the `asOf` date it was copied, and the provider page each number came from. `contextWindow` is the most input one request can send, so a model whose page caps input below its full window, such as `gpt-5.4-mini`, records the input cap. `parseCatalog()` checks a catalog read from JSON and throws a `GatewayError` with code `invalid_catalog` that names the first bad field. `createModel()` runs the same check on a catalog you pass, so a typed catalog with tiers out of order or a negative rate throws too.

Prices change often, so refresh the shipped catalog before every minor release. Copy each number from the provider's own pricing and model pages, record each page in the entry's `sources`, and set `asOf` to the day you copied them. The repository's CI warns about any shipped entry older than 90 days, and `staleCatalogEntries(catalog, now)` runs the same check on a catalog you maintain.

## You can project a call's cost before you send it

`projectCallCost(model, context, options)` returns the most the next call can cost, so a budget can stop a run before the call that would cross its cap. It prices every input token at the highest input rate in its tier, the uncached rate or either cache-write rate, and the full output limit at the output rate: the call's `maxOutputTokens`, or else the model's. The input comes from `estimateInputTokens(context)`. When an earlier assistant message in the context reports its usage, the estimate starts from that request's input and output and adds the messages that came after it. A retried call's `usage` sums every attempt, so the estimate reads its `lastAttemptUsage`, the usage of the one request that produced the message. Otherwise it estimates the whole context from its length in characters. The estimate assumes the system prompt and tools are unchanged since that request, so grow them and the growth goes uncounted. Otherwise each estimate errs high, so a budget errs towards stopping.

A caller that holds a token count instead of a `ModelContext` calls `projectCost({ inputTokens, maxOutputTokens }, entry)` directly, with an entry from `findCatalogEntry()`. Both functions use one formula, so they return the same cost for the same tokens.

## One caching option covers every provider

The `cacheRetention` stream option sets how long the provider keeps the prompt cache: `"none"`, `"short"` or `"long"`. The gateway passes it to the adapter unchanged, and each adapter maps it to its provider's own cache controls. Leave it out to keep the adapter's default.

## Your key is the only key the gateway sends

Every adapter takes a `ProviderConfig` whose `apiKey` you pass in. The gateway never reads a key from the environment and never falls back to another credential, so a key left in your shell cannot reach a provider. An adapter made without a key, or with an empty one, throws a `GatewayError` with code `missing_api_key` before it sends anything.

## Retries happen only before the model streams output

A call that fails before the model has streamed any content is retried twice by default. The first retry waits 2 seconds and the second waits 4, and each retry streams a `retry` event with the attempt number, the delay and the error. Each wait doubles and is capped at 60 seconds. Set `retries` to change the count, or to 0 to turn retries off.

Three rules keep a retry from doing harm. First, once a content event has reached you, the gateway never retries, because a second attempt would replay text you have already seen. Second, only errors of kind `retryable` are retried, such as a rate limit or an overloaded server. A `quota` error, a context `overflow` or a `fatal` error ends the call at once, because waiting will not fix it. Third, aborting the signal during a wait ends the stream at once with `stopReason: "aborted"`.

A failed attempt still costs tokens, so the final message's `usage` and `cost` add up every attempt, not only the last, and `lastAttemptUsage` keeps the last attempt's usage on its own. If any attempt's cost is unknown, the total is unknown too. An attempt whose stream threw reported no usage, so it adds no tokens, but its cost is unknown, because the request may have reached the provider and been billed before the stream failed.

An adapter whose stream throws, for example on a dropped connection, is treated like one that ends with an error. A failed fetch is retried, and any other throw ends the call with a `fatal` error event, so an adapter's failure never makes `stream()` throw. A throwing `onRequest` hook runs inside the attempt, so it also ends the call with a `fatal` error. A middleware that throws runs outside the call, so its error makes `stream()` throw.

Adapters sort a failed request into the four kinds, `retryable`, `quota`, `overflow` and `fatal`, with `classifyError()`, from its HTTP status and the provider's error code or message.

## Middleware wraps every call, first one outermost

A `ModelMiddleware` can rewrite the request with `transformParams` and watch or change the events with `wrapStream`. With `middleware: [a, b]`, `a` runs first: its `transformParams` sees your request before `b`'s does, and its `wrapStream` wraps `b`'s. Middleware runs once per call, outside the retries, so a `wrapStream` sees the `retry` events too.

## You can see the exact request of every attempt

`onPayload` in the stream options lets you inspect or replace the wire body just before an adapter sends it. Return the new body, or `undefined` to send the body unchanged.

`onRequest` in `createModel()` receives the full request of each attempt before it is sent: the attempt number, the model, the context, the stream options and the wire body after `onPayload`. The dump is a copy, so changing the context after the call doesn't change what it shows. Log it when a step misbehaves, and you see what the provider saw.

## Tests run offline

Start each test file with `import "@buildanagent/gateway/testing/setup"`. The setup blocks every request to a host other than your own machine, stops the run if a provider API key is set, and turns real model requests off. Your tests then never reach a real provider by accident.

Next: [@buildanagent/sdk](../sdk/README.md), which tests an agent against a scripted model.
