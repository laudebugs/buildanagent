# @buildanagent/gateway

The gateway lets your agent call any model through one transcript and one stream format, so switching providers never changes your agent code. Use it directly to call a model, or through `@buildanagent/sdk`, which runs the agent loop on top of it.

As of November 2026 the package holds the transcript types, the stream checker, `complete()`, `createModel()` with its retries and middleware, the price catalog that puts a cost on every message, the tool-name rule, the Anthropic Messages adapter, and `transformMessages()`, which prepares a transcript for the model you send it to. The OpenAI-compatible adapter is next.

## A conversation is a list of messages you own

A conversation is a list of `Message`s: user messages, assistant messages and tool results. Their content is a short list of blocks (`text`, `reasoning`, `image` and `tool_call`), so your code never handles a provider's wire format. A reasoning block may carry a signature that only the model that wrote it accepts.

Every `AssistantMessage` records its model, why it stopped (`stopReason`), any typed `error`, its `Usage` and its `Cost`. `Usage` has no field named `input`, because providers disagree on whether input includes cached tokens. The uncached part is `uncachedInput`, and `totalInput()` adds the cache reads and cache writes to it. `Cost.total` is `null` when the price is unknown, never a guessed zero.

## A transcript recorded on one model replays on another

You can start a conversation on one model and continue it on another, even from another provider. Before each request, `transformMessages()` turns your transcript into one that the target model accepts:

```ts
const messages = transformMessages(transcript, model.ref, model.caps);
```

The pass returns a new array and leaves your transcript as it was, so you keep the full record. It gives the same answer for the same transcript every time, and running it on its own output changes nothing. It changes five things:

- **Failed turns.** It leaves out every assistant message that stopped with `"error"` or `"aborted"`, and the tool results that answer its calls. A resumed call then asks the model again instead of building on a half-written answer.
- **Reasoning.** For a model that does not reason (`caps.reasoning` is `false`), the pass drops every reasoning block. Otherwise it drops reasoning that another provider wrote and removes any signature the target cannot check, because a reasoning signature is valid only for the provider, and often only for the model, that wrote it. An Anthropic target gets every Anthropic-signed thinking block exactly as recorded, empty ones included, and no unsigned reasoning. Another target keeps the text of reasoning it cannot verify, unless the text is empty.
- **Images.** For a model that takes no images (`caps.images` is `false`), each image becomes a short text note.
- **Tool-call ids.** Each id must be 1 to 64 letters, digits, `_` or `-`, and must not repeat. The pass rewrites any id that breaks the rule and updates the result that answers it.
- **Tool results.** Each result moves next to the call it answers, even when it was recorded after a later turn, and a result that answers no call is dropped. When several calls share an id, a result goes to the newest waiting call from a completed turn. It goes to a failed turn's call, and is dropped with that turn, only when no completed turn's call is waiting. A call that never got a result gets a synthetic one with `isError: true`, because providers reject a call left unanswered.

The pass also keeps every message to a shape both providers accept. It removes reasoning and tool calls from user messages, removes empty text blocks, and drops any message left with no content. It merges user messages that end up next to each other into one, and does the same for assistant messages. A merged assistant message keeps the later message's stop reason, usage and cost. If the earlier message has text or tool calls, the pass drops the later message's reasoning, so no reasoning block ends up after a block it did not follow before. When your transcript has a user message, the output starts with one: if the pass empties the first user message, a short `(continued)` note takes its place. A transcript left with nothing to send becomes `[]`.

When an Anthropic target must lose a reasoning block, the pass also drops every reasoning block before it, so the blocks it keeps are the newest unbroken run. As the transcript grows, a later drop can remove older thinking, but only ever as a leading run. Anthropic's thinking documentation allows exactly that: outside tool use, a request may omit prior turns' thinking, "but not a block between two that you keep" ([Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), linked from [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), as of November 2026). The same page says the API drops, without billing, the thinking blocks a target model cannot read, and uses each block's signature to verify that Claude wrote it. It does not say what happens to an unsigned thinking block; the pass drops those blocks on the reading that they cannot pass that check (unverified). Other targets check no such order, so they lose only the blocks they cannot accept.

## Every stream follows one rule

A provider adapter implements one method, `stream()`. The stream it returns follows four rules:

1. `start` comes first, once.
2. Each content block runs `*_start`, then any number of `*_delta`, then `*_end`, and keeps one kind.
3. Exactly one terminal event, `done` or `error`, ends the stream.
4. An error terminal has `stopReason` `"error"` or `"aborted"` and carries the content and usage so far. A `done` terminal has neither stop reason, and every block it started has ended.

A `warning` event may come anywhere between `start` and the terminal. It reports something the call survived, such as an option the provider would reject, with a snake_case `code` and a `message`. A warning is not output, so the gateway still retries a call that has only warned. A retry does not repeat a warning that an earlier attempt streamed with the same code and message.

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

The `cacheRetention` stream option sets how long the provider keeps the prompt cache: `"none"`, `"short"` or `"long"`. The gateway passes it to the adapter unchanged, and each adapter maps it to its provider's own cache controls. Leave it out to keep the adapter's default, which is `"short"` for the Anthropic adapter.

## One tool name works with every provider

A tool name must be 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. This canonical rule is the strictest intersection of the first providers' rules: OpenAI Chat Completions allows 64 characters, and Anthropic Messages allows the same characters at up to 128. [`src/names.md`](src/names.md) lists each provider's rule with its source and the date it was checked, as of November 2026. Names from other sources follow the same rule, so an MCP tool is named `mcp__<server>__<tool>`.

`assertCanonicalName(name)` throws a `GatewayError` with code `invalid_tool_name` for a name that breaks the rule. Call it when you define a tool, so a bad name fails there rather than when a provider rejects the request:

```ts
import { assertCanonicalName } from "@buildanagent/gateway";

assertCanonicalName("lookup_customer"); // passes
assertCanonicalName("lookup customer"); // throws: the space is not allowed
```

An adapter turns each tool name into its provider's wire name with a `ToolNameMap`, and turns the names the model sends back into your tool names. Build one with `createToolNameMap(rule, names)`, passing the run's tool names, and keep it for the whole run, so every request sends the same wire names and the prompt cache stays valid. `sanitize(name)` gives a tool's wire name, and `restore(wireName)` reverses it. For a name the map never issued, `restore()` returns `undefined`, so a tool the model invented never reaches one of your tools.

The map changes a name only when it must. A name the rule accepts keeps itself. Any other name has its disallowed characters replaced by `_`, is cut to fit, and ends in `_` and an 8-digit hash of the name. If that wire name is taken, the map salts the hash: it hashes the name with an attempt counter, counting up until the wire name is free. Because neither provider says whether names are case-sensitive, the map also never issues two wire names that differ only in case. Of two such names passed up front, the one that sorts later is salted. The map sorts the names you pass up front, so their wire names depend only on that set, not on its order. A name that `sanitize()` first sees later keeps itself if the rule accepts it and no issued wire name matches it, ignoring case. Otherwise the map salts it, because the earlier wire name may already have been sent. Every name keeps the wire name it gets first.

`TOOL_NAME_RULES` holds the rules of the two first wire protocols. Every canonical name meets both, so with these providers `sanitize()` changes only a name that differs in case alone from another. The map matters for a provider with a stricter rule: pass its `ToolNameRule` to `createToolNameMap()`.

## The Anthropic adapter speaks the Messages API at version 2026-10-21

`anthropic({ apiKey })` from `@buildanagent/gateway/anthropic` returns an adapter for Anthropic's Messages API. It calls `fetch` through your `transport`, posts to `{baseURL}/v1/messages`, streams every response, and sends `anthropic-version: 2026-10-21` on every request ([migration to 2026-10-21](https://platform.claude.com/docs/en/api/migration-2026-10-21), as of November 2026):

```ts
import { createModel } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";

const model = createModel({ adapter: anthropic({ apiKey }), id: "claude-opus-5-5" });
```

Version 2026-10-21 returns a 400 for `temperature`, `top_p` or `top_k` at any value, so the adapter never sends them. When you set one, the call streams a `warning` with code `unsupported_option` instead. The same version rejects a `document` block in an assistant message and `citations` on a user text block; the transcript has neither, and the adapter reports the 400 as a `fatal` error if a body you rewrite adds one.

Each request runs `transformMessages()` first, so a transcript from any model can be sent. The adapter keeps signed Anthropic thinking in the transcript even for a model whose caps say it does not reason, because the API checks a thinking block against its signature; the caps decide only whether the request asks for thinking. Tool results become `tool_result` blocks, and the results of one turn share one user message. Tool names pass through a `ToolNameMap`, and the names the model sends back are restored.

Each tool goes out with `strict: true` when its schema allows it: the adapter adds `additionalProperties: false` to every object and removes the keywords strict mode rejects, such as `minimum` and `maxLength` ([structured outputs, JSON Schema limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), as of November 2026). Optional properties stay optional, because strict mode accepts them, so the model never sends a `null` that lowering added. Two kinds of tool go out without `strict`. The first has a schema strict mode cannot express, such as an object that declares neither `properties` nor `additionalProperties`. The second would push the request past its limits of 20 strict tools, 24 optional properties or 16 union-typed parameters. The SDK still validates every call against your original schema.

Caching puts up to three breakpoints, on the system prompt, the last tool and the last block of the last user message, below the API's limit of four. `"short"` asks for the 5-minute cache, `"long"` for the 1-hour cache, and `"none"` sends no breakpoint ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), as of November 2026).

### Usage maps into the four token classes, and the catalog prices it

The [Messages API reference](https://platform.claude.com/docs/en/api/messages/create) (as of November 2026) defines total input as the sum of `input_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens`, so each field maps to one class:

| Anthropic `usage` field | `Usage` field |
| --- | --- |
| `input_tokens` | `uncachedInput` |
| `cache_read_input_tokens` | `cacheRead` |
| `cache_creation.ephemeral_5m_input_tokens` | `cacheWrite["5m"]` |
| `cache_creation.ephemeral_1h_input_tokens` | `cacheWrite["1h"]` |
| `output_tokens` | `output` |
| `output_tokens_details.thinking_tokens` | `reasoning` |

Reasoning is counted inside output. The reference calls `output_tokens` "the inclusive, authoritative total used for billing" and says `thinking_tokens` is "always ≤ `output_tokens`". When streaming, `thinking_tokens` arrives only on the final `message_delta` ([extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), as of November 2026), and the adapter reads it there. A response that reports cache writes without the TTL split counts them at the TTL the request asked for.

Responses carry no billed price, as of November 2026: the reference's `usage` object holds token counts only. The adapter therefore reports an unknown cost, and `createModel()` prices the usage from the catalog.

### Stop reasons and errors map onto the gateway's

`end_turn`, `stop_sequence` and `pause_turn` end with `"stop"`. `pause_turn` adds a `warning`: the provider paused a long-running server-tool turn, and because the adapter drops server-tool blocks, it cannot resume that turn. `tool_use` ends with `"tool_calls"`. `max_tokens` and `model_context_window_exceeded` end with `"length"`, and a tool call cut off by the limit keeps its partial JSON as a string in `input`. A `refusal` ends in a `fatal` error that names the refusal's category.

A failed request ends in an `error` terminal, never a throw. The adapter reads the error body's `error.type`, `error.message` and `error.details.error_code`, and `classifyError()` sorts it into the four kinds. An error event inside a stream that already returned 200 classifies like the HTTP status its type stands for, so a mid-stream `overloaded_error` is `retryable` and the gateway retries it while no content has arrived ([errors](https://platform.claude.com/docs/en/api/errors), as of November 2026).

### A changed transcript before a thinking block gets one retry

Anthropic's current models check each thinking block you send back against everything before it, and a block fails the check when `system`, `tools` or an earlier message changed after the model wrote it ([prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks), as of November 2026). The adapter handles both outcomes the page describes:

- **A 200 that let a failed block through.** Every request sends the `thinking-binding-controls-2026-08-01` beta header, so the response lists each such block in `input_transformations`. Each `thinking_mismatch_allowed` entry becomes a `warning` with code `thinking_mismatch_allowed`.
- **A 400 that says a block "is bound to a different conversation".** The adapter streams a `warning` with code `thinking_prefix_mismatch` and sends the request once more with `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`. The API applies that setting only to the request that carries it, so the adapter sends it on every later request of the same conversation. If the retry fails the same way, the call ends in a `fatal` error with `code: "thinking_prefix_mismatch"`.

The adapter recognises a conversation by a hash of its system prompt and the text of its first message, so two conversations that share both share the `drop_block` setting. The hash records that a message holds an image but not the image's data, so two first messages that differ only in an image also match. Pass `providerOptions: { anthropic: { conversationId } }` to name each conversation yourself, which keeps them apart and also keeps one alive when compaction rewrites its first message. The adapter remembers the 1,000 most recently used conversations that need `drop_block`; one it has forgotten pays one more 400 and is remembered again.

`providerOptions.anthropic.extraBody` adds fields to the request body, such as `thinking: { display: "summarized" }` to stream readable reasoning. It cannot change the fields the adapter sets itself: `model`, `max_tokens`, `stream`, `system`, `messages`, `tools` and, for a model with `reasoning: true`, `thinking.type`. An `extraBody` that sets one keeps the adapter's value and streams a `warning` with code `unsupported_option` that names it.

The adapter reads the model's caps from `options.caps`, which `createModel()` sets from its catalog, your own catalog included. A `Model`'s options, `ModelCallOptions`, have no `caps` field, and a `caps` passed anyway is replaced. For a model with `reasoning: true`, the adapter sends `thinking: { type: "adaptive" }`. A model the catalog lacks gets the adapter's default caps, which send no thinking setting, so the model's own default applies; a direct `adapter.stream()` call without `caps` gets the same defaults.

Headers in `config.headers` are sent with lower-case names. An `anthropic-beta` header is merged with the adapter's beta, and an `x-api-key` or `authorization` header is dropped, so `apiKey` stays the only key sent.

## Your key is the only key the gateway sends

Every adapter takes a `ProviderConfig` whose `apiKey` you pass in. The gateway never reads a key from the environment and never falls back to another credential, so a key left in your shell cannot reach a provider. An adapter made without a key, or with an empty one, throws a `GatewayError` with code `missing_api_key` before it sends anything.

## Retries happen only before the model streams output

A call that fails before the model has streamed any content is retried twice by default. The first retry waits 2 seconds and the second waits 4, and each retry streams a `retry` event with the attempt number, the delay and the error. Each wait doubles and is capped at 60 seconds. Set `retries` to change the count, or to 0 to turn retries off.

Three rules keep a retry from doing harm. First, once a content event has reached you, the gateway never retries, because a second attempt would replay text you have already seen. Second, only errors of kind `retryable` are retried, such as a rate limit or an overloaded server. A `quota` error, a context `overflow` or a `fatal` error ends the call at once, because waiting will not fix it. Third, aborting the signal during a wait ends the stream at once with `stopReason: "aborted"`.

A failed attempt still costs tokens, so the final message's `usage` and `cost` add up every attempt, not only the last, and `lastAttemptUsage` keeps the last attempt's usage on its own. If any attempt's cost is unknown, the total is unknown too. An attempt whose stream threw reported no usage, so it adds no tokens, but its cost is unknown, because the request may have reached the provider and been billed before the stream failed.

An adapter whose stream throws, for example on a dropped connection, is treated like one that ends with an error. A failed fetch, or a response body cut off mid-stream, is retried, and any other throw ends the call with a `fatal` error event, so an adapter's failure never makes `stream()` throw. A throwing `onRequest` hook runs inside the attempt, so it also ends the call with a `fatal` error. A middleware that throws runs outside the call, so its error makes `stream()` throw.

Adapters sort a failed request into the four kinds, `retryable`, `quota`, `overflow` and `fatal`, with `classifyError()`, from its HTTP status and the provider's error code or message.

## Middleware wraps every call, first one outermost

A `ModelMiddleware` can rewrite the request with `transformParams` and watch or change the events with `wrapStream`. With `middleware: [a, b]`, `a` runs first: its `transformParams` sees your request before `b`'s does, and its `wrapStream` wraps `b`'s. Middleware runs once per call, outside the retries, so a `wrapStream` sees the `retry` events too.

## You can see the exact request of every attempt

`onPayload` in the stream options lets you inspect or replace the wire body just before an adapter sends it. Return the new body, or `undefined` to send the body unchanged.

`onRequest` in `createModel()` receives the full request just before each HTTP request is sent. An Anthropic attempt that retries with `drop_block` sends two HTTP requests, so it is dumped twice under the same attempt number. A `warning` that the adapter streams before it sends, such as the one for `temperature`, doesn't add a dump. Each dump holds the attempt number, the model, the context, the stream options and the wire body after `onPayload`. The dump is a copy, so changing the context after the call doesn't change what it shows. Log it when a step misbehaves, and you see what the provider saw.

## Tests run offline

Start each test file with `import "@buildanagent/gateway/testing/setup"`. The setup blocks every request to a host other than your own machine, stops the run if a provider API key is set, and turns real model requests off. Your tests then never reach a real provider by accident.

To test an adapter's wire format, pass `mockTransport(api, script)` as its `transport`. The mock answers the n-th request with the n-th scripted response, splits each body into chunks of `chunkSize` bytes or at `splitAt` offsets, and records every request in `requests`. A request past the end of the script throws a `GatewayError` with code `unexpected_request`. `serverSentEvents(events)` writes a list of events as a stream body:

```ts
import { mockTransport, serverSentEvents } from "@buildanagent/gateway/testing";

const transport = mockTransport("anthropic-messages", [{ body: serverSentEvents(events), chunkSize: 7 }]);
```

Next: [@buildanagent/sdk](../sdk/README.md), which tests an agent against a scripted model.
