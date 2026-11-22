---
title: "The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost"
summary: A model gateway sits between your agent loop and every provider, so it is the one place that sees each call in the provider's terms. This chapter shows why one streaming method, retries, prompt caching, reasoning replay and cost accounting all live there, and what each of them must not do.
opening: code
sources: [buildanagent-gateway-readme-current, buildanagent-sdk-readme-current, buildanagent-agent-sdk-guide, anthropic-rate-limits, anthropic-streaming, openai-chat-completions-create, anthropic-errors, openai-rate-limits, anthropic-prompt-caching, anthropic-pricing, openai-prompt-caching, mcp-changelog-2026-07-28, anthropic-preserved-thinking, anthropic-prefix-checks, claude-agent-sdk-agent-loop]
glossary: [model-gateway, wire-protocol, delta, token]
switchTo: [B4, B5, B8, B9]
---

Under ten lines of code ask a model a question. The helper in [[lst:ask-helper-ours]] and [[lst:ask-helper]] hands a refund policy and a question to whatever model you give it, and returns the answer. In each tabbed listing, the first tab runs on our gateway, `@buildanagent/gateway`, or on our SDK, `@buildanagent/sdk`, when the step belongs to the loop. The second tab runs the same step on the AI SDK.

::::tabs
:::listing[Our gateway]{#ask-helper-ours file="packages/gateway/examples/04-retries-caching.ts" region="ask"}
::note[`cacheRetention` is the gateway's own caching option, so it asks every adapter for caching in that adapter's terms. The Anthropic adapter turns `"short"` into a mark on the request.]{#cache-mark}
::note[The call's own answer limit. Section five's budget example sets the same limit through `modelOptions`{checked=row-145}.]{#output-cap}
:::
:::listing[AI SDK]{#ask-helper file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="ask"}
::note[The `cacheControl` entry sits under the `anthropic` key, so it is a request to Anthropic's cache and nobody else's.]{#cache-mark}
::note[The call's own answer limit. Section five uses it to project what the call can cost.]{#output-cap}
:::
::::

Our tabs need no key either. The gateway's tabs run its own Anthropic adapter against a stub of the Messages API, and the SDK's tabs run `run()` over a scripted model that the gateway prices as Claude Sonnet 5.5, so no example sends anything over the network. As of November 2026 both packages are `0.1.0` alphas, so their names may still change.

Neither helper names an HTTP status, a wire format or a price, and each makes its only nod to caching in one option. Yet the examples behind them make a provider answer "overloaded" and carry on, read a long policy back from a cache at a fraction of its price, and refuse a call before it leaves the process. Each of those happens in a layer around the model that `ask` never sees. That layer is the model gateway: the code between your agent loop and the providers' APIs. Retries, caching, reasoning replay and cost accounting each need a view of every call in the provider's own terms, such as status codes, token classes and signatures. Your loop speaks only in messages, so it cannot hold that view, and a provider's API sees only its own terms. The gateway is the one place that sees both. This chapter takes its five jobs in turn: one streaming method over several wire protocols, retries, prompt caching, reasoning replay across providers, and cost with its pre-call budget. By the end you can say which of them belong in your own gateway, which the loop must keep, and what the next call will cost before you send it.

## One streaming method lets the loop call any provider, and each adapter hides one wire protocol

Call a company's switchboard and :analogy[a switchboard operator]{#switchboard-operator} connects you to any extension, whatever phone sits on that desk, and writes down the minutes. A gateway plays the operator for your loop. The loop asks for a model, the gateway connects it to Anthropic's or OpenAI's API, and the call's tokens and cost land in a log. Which provider answers is a detail of the connection.

The connection is one method. In our gateway, every provider adapter implements `stream()`{checked=row-6}, which sends one request and returns the events of the answer. The stream opens with a `start`{checked=row-7}. Each block of text, reasoning or tool input then gets its own start, some deltas and an end, and the stream closes with exactly one terminal event, `done`{checked=row-7} or `error`{checked=row-7} [@buildanagent-gateway-readme-current]. A non-streaming `complete()`{checked=row-8} folds that stream into its final message instead of being a second method to write. The design puts retries, usage, cost and caching in the gateway, so no adapter repeats them [@buildanagent-agent-sdk-guide]. [[fig:one-method]] shows the shape: one method faces the loop, and each adapter turns it into one provider's request.

:::figure[One gateway method in, one wire format out for each provider]{#one-method}
::svg{alt="Three columns of boxes. On the left, a box labelled agent loop has an arrow to a larger box in the middle labelled gateway, stream(), retries, cost. Two arrows lead from the gateway to the right column: one to a box labelled Anthropic adapter, POST /v1/messages, and one to a box labelled OpenAI adapter, POST /chat/completions. Text under the columns reads one method in and one wire format each."}
:::

The saving shows in a mock model. The AI SDK's model interface has two methods, one that returns a whole answer and one that streams it, so the scripted model in [[lst:scripted-two-methods]] must implement both. With a single streaming method, an adapter writes one code path and a test script plays it, as the scripted adapter in [[lst:scripted-two-methods-ours]] does: it writes `stream()` only, and the model that `createModel()` builds from it answers `complete()` as well.

::::tabs
:::listing[Our gateway]{#scripted-two-methods-ours file="packages/gateway/examples/03-scripted-adapter.ts" region="scripted"}
::note[`stream()` is the adapter's only method. It yields the answer's events, from `start` to the one terminal event, `done`.]{#one-method}
::note[`createModel()` binds the adapter to a model id. The model adds retries, middleware and the price, and the adapter repeats none of them.]{#derived}
::note[`complete()` reads that stream to its terminal event and returns its message, so no second method exists to write.]{#folds}
:::
:::listing[AI SDK]{#scripted-two-methods file="verify/vercel-ai-sdk/examples/lib/check.ts" region="scripted"}
::note[`doGenerate` returns the whole answer at once.]{#do-generate}
::note[`doStream` returns the same answer as a stream of parts. Every provider adapter written for this interface pays for both.]{#do-stream}
:::
::::

A wire protocol is the request and response format a provider's API speaks, and the same agent step looks different in each. [[tbl:wire-differences]] sets two first protocols side by side, as our gateway's two adapters send them.

:::table[How Anthropic's Messages API and OpenAI's Chat Completions API differ on one agent step, as of November 2026]{#wire-differences}
| One agent step | Anthropic Messages | OpenAI Chat Completions |
| --- | --- | --- |
| Where the request goes | `POST {baseURL}/v1/messages` | `POST {baseURL}/chat/completions` |
| The system prompt | A top-level `system`{checked=row-13} field | The first message, with role `system`{checked=row-13} |
| A tool's result | A `tool_result`{checked=row-14} block, and one turn's results share one user message | One `tool`{checked=row-14} message for each result |
| What "input tokens" counts | Only the tokens after the last cache breakpoint | The prompt, with its cached tokens reported as part of it |
| The final usage count | Cumulative counts on the stream's last `message_delta`{checked=row-18} event | Sent only when the request sets `stream_options.include_usage`{checked=row-19} |
:::

Anthropic's `input_tokens`{checked=row-15} leaves out what the cache supplied. Its rate-limit page gives the sum: total input is `cache_read_input_tokens`{checked=row-17}, `cache_creation_input_tokens`{checked=row-17} and `input_tokens`{checked=row-15} added together, and `input_tokens`{checked=row-15} counts only the tokens after the last breakpoint [@anthropic-rate-limits]. OpenAI's reference defines `prompt_tokens`{checked=row-24} as the "number of tokens in the prompt" and describes its cached tokens as "present in the prompt", which our adapter reads as a part of that count [@openai-chat-completions-create]. The two providers also report usage at different moments. Anthropic sends its closing counts on the stream's last `message_delta`{checked=row-18} event and calls them cumulative [@anthropic-streaming]. OpenAI sends a usage chunk only when the request asks for one, and warns that an interrupted stream may skip it [@openai-chat-completions-create]. One word, "input", therefore names two counts, and a call's usage may arrive late or never. A gateway that passes the providers' numbers through leaves every caller to reconcile them. Ours stores four token classes of its own and converts at the adapter [@buildanagent-gateway-readme-current].

The AI SDK's example runs the same `ask` over a second protocol. [[lst:wire-listing]] builds an Anthropic model with `createAnthropic`, whose `fetch` function answers in Messages format, and calls `ask` on it twice. The retry, the cache read and the budget refusal of the later sections then work unchanged, and the example's checks assert each of them over this wire as well as over the scripted model.

Our gateway's example uses only that second protocol. [[lst:wire-listing-ours]] puts the gateway's own Anthropic adapter on a stub transport that answers in Messages format, so every retry and cache read of the next sections happens on that wire format. The stub answers each request with a status the example queued, or with a Messages stream whose usage follows the request. `anthropicOver()` hands the stub to the gateway's `anthropic({ apiKey, transport })`{checked=row-143} adapter, and `sleep: instantly` replaces the gateway's 2 and 4 second waits, so the retries run at once.

:::tabs
::listing[Our gateway]{#wire-listing-ours file="packages/gateway/examples/04-retries-caching.ts" region="wire"}
::listing[AI SDK]{#wire-listing file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="wire"}
:::

Here the operator comparison stops holding: an operator only patches a call through, while a gateway also rewrites it. Anthropic wants a turn's tool results as blocks in one user message, and OpenAI wants a message for each, so the adapter reshapes the transcript on every call. It also keeps the transcript in one format of its own, so the loop never sees either provider's. That rewriting, and not the patching, is why a transcript recorded under one provider can continue under another, as the fourth section shows.

One method in and one wire format out give every later job a single place to run. A retry wraps one method, a price attaches to one terminal message, and a cache policy passes through one options object. Retries come first, because they decide what happens when the provider says no.

## A retry is safe only before the first output, and only for a failure that waiting can fix

You hang up on a busy line, wait, and dial again, waiting longer each time. That is :analogy[redialling a busy line]{#redial-busy-line}, and a gateway does it for a provider that answers "overloaded". By default, as of November 2026, our gateway retries a failed call twice, waiting 2 seconds before the first retry and 4 before the second, and each retry shows up in the stream as a `retry`{checked=row-25} event [@buildanagent-gateway-readme-current]. The wait doubles because a busy server needs room, and because resending at once only digs deeper: OpenAI's rate-limit guide warns that "unsuccessful requests contribute to your per-minute limit, so continuously resending a request won't work" [@openai-rate-limits]. [[lst:retry-once-ours]] and [[lst:retry-once]] show the happy case. In ours, the stub answers HTTP 529 once, and the gateway retries and returns the answer. In the AI SDK's, the scripted model throws an error that marks itself retryable. Either way, a retryable failure costs one retry and `ask` returns its answer.

::::tabs
:::listing[Our gateway]{#retry-once-ours file="packages/gateway/examples/04-retries-caching.ts" region="retry"}
::note[The stub answers 529 with an `overloaded_error`{checked=row-31} body, and the adapter sorts that failure as retryable. The model's `sleep` from [[lst:wire-listing-ours]] skips the 2-second wait.]{#retry-header}
::note[Two requests for one call: the failure and the retry that succeeded.]{#retry-count}
:::
:::listing[AI SDK]{#retry-once file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="retry"}
::note[The scripted failure is an overloaded error that marks itself retryable, with a `retry-after-ms`{checked=row-27} header of 0 so the example does not wait.]{#retry-header}
::note[Two attempts for one call: the failure and the retry that succeeded.]{#retry-count}
:::
::::

Two limits stop the redialling from doing harm. The first concerns output. Once a block of the answer has reached the caller, a second attempt would replay text the caller has already seen, so the gateway retries only a failure that arrives before any content [@buildanagent-gateway-readme-current]. Anthropic's errors page marks the same boundary from its side: an error that comes after a streaming response has returned 200 "doesn't follow these standard mechanisms" [@anthropic-errors]. The second limit concerns the failure itself, because a busy signal clears and some failures never do. Here the redialling picture stops holding: a rejected request fails every time you resend it. [[tbl:error-kinds]] shows the four kinds our gateway sorts a failure into, which it decides from the HTTP status and the provider's error code or message together.

:::table[The four kinds of failure, and what the gateway does with each, as of November 2026]{#error-kinds}
| Kind | Example from a provider | Retried? | Why |
| --- | --- | --- | --- |
| Retryable | HTTP 529 `overloaded_error`{checked=row-31}, a 429 rate limit, a dropped connection before any output | Yes, up to twice | Waiting changes the outcome |
| Quota | HTTP 402 `billing_error`{checked=row-31}, or a tier spend-cap 429 with `enforced_spend_limit_reached`{checked=row-31} | No | Waiting does not refill a budget |
| Overflow | HTTP 413 `request_too_large`{checked=row-31}, or "prompt is too long" | No | The same request overflows again; the loop must shrink it |
| Fatal | HTTP 401 `authentication_error`{checked=row-31}, any status the gateway does not know | No | A rejected request fails every time |
:::

A dropped connection is retried only while no content has reached the caller. After output has started, the gateway does not retry, and the retry is the loop's `turnRetries`{checked=row-37}, described below [@buildanagent-gateway-readme-current; @buildanagent-sdk-readme-current].

The quota row shows why a status code alone cannot decide. Anthropic's tier spend-cap response is a 429, the same status as a rate limit, but it "has no `retry-after`{checked=row-39} header" and "keeps failing until access resumes" [@anthropic-errors]. OpenAI's guide says outright: "Don't retry quota, billing, or other errors that require you to take action" [@openai-rate-limits]. So the gateway reads the code and message first, and treats a 429 as a rate limit only when they name none of the billing causes [@buildanagent-gateway-readme-current]. [[lst:retry-limits-ours]] and [[lst:retry-limits]] run the two refusals: a 401 fails after one attempt, and two 429s against one allowed retry end the call. The AI SDK's tab sets `maxRetries: 1`{checked=row-36} and ends with a retry error. Ours builds a model with `retries: 1`, and the call ends with an error message of kind `retryable`, which the gateway returns instead of throwing.

::::tabs
:::listing[Our gateway]{#retry-limits-ours file="packages/gateway/examples/04-retries-caching.ts" region="retry-limits"}
::note[A 401 is a `fatal` failure, and the example's check counts exactly one request for the call.]{#not-retryable}
::note[Two 429s are queued and one retry is allowed, so the second failure ends the call. The model's retry count is an option of `createModel()`, so this call uses a second model.]{#retry-cap}
:::
:::listing[AI SDK]{#retry-limits file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="retry-limits"}
::note[A 401 marks itself not retryable, and the example's check counts exactly one attempt for the call.]{#not-retryable}
::note[Two 429s are scripted and one retry is allowed, so the second failure ends the call with the reason `maxRetriesExceeded`.]{#retry-cap}
:::
::::

Waiting is the other thing a provider can tell you. As of November 2026, Anthropic's 429 responses may carry a `retry-after`{checked=row-39} header, and its docs say to wait that many seconds [@anthropic-rate-limits]. Our gateway waits for the longer of its backoff and the hint, capped at 60 seconds. When a hint asks for more than 60, it stops and returns the failure with the hint attached and no retry event, so your code can wait and call again [@buildanagent-gateway-readme-current]. OpenAI's guide asks for the same: when a valid server delay exceeds your maximum, "stop retrying and defer the request rather than retrying sooner" [@openai-rate-limits]. The AI SDK's default does the opposite. It honors a hint between 0 and 60 seconds and otherwise falls back to its own backoff, so a hint of five minutes gets its ordinary backoff, 2 seconds before the first retry and 4 before the second, as of `ai@7.0.162`{checked=row-34}. No single default suits every case, so read your SDK's rule before you rely on it. Our gateway adds no random jitter to its waits, which OpenAI's guide recommends so that many clients do not retry in step [@openai-rate-limits]. That is a limit of ours, and the right fix is a jitter option in the gateway, not a copy of the retry loop in every agent.

Retries also stack. The SDK's loop can retry a whole turn above the gateway, with `turnRetries`{checked=row-37} off by default. With the gateway's two retries and `turnRetries`{checked=row-37} set to 2, one call may send up to nine requests, and each failed one may be billed [@buildanagent-sdk-readme-current]. We counted retries in the gateway's cost for that reason: the final message sums every attempt's usage and cost, so a budget sees what the retries spent.

## Prompt caching pays only while the front of the request stays byte for byte the same

A job printer who keeps :analogy[the letterhead plate set]{#letterhead-plate} between jobs pays for the setup once. Every job on the same letterhead then runs at once and cheaply, until someone swaps the plate and the next job pays for setup again. A provider's prompt cache works the same way, and [[fig:letterhead-plate]] draws it. The provider stores the front of a request after reading it, and a later request that starts with exactly the same front skips that work and pays less for it.

:::figure[A printer that keeps the letterhead plate set between jobs: the second job reuses it, and a moved tool resets it]{#letterhead-plate analogy="letterhead-plate"}
::svg{alt="Three jobs in a row, each with an arrow down to a plate. Job 1, first request, leads to a plate marked plate set, prefix written, priced at write 1.25x. Job 2, same prefix, leads to a plate marked plate reused, prefix read, priced at read 0.05x. Job 3, a tool moved, leads to a dashed plate marked plate reset, prefix rewritten, priced at write 1.25x again. Text under the row reads price of the prefix, against the base input rate."}
:::

Anthropic's cache covers the prefix in a fixed order: `tools`{checked=row-49}, then `system`{checked=row-49}, then `messages`{checked=row-49}, up to the block you mark. Cache hits "require 100 percent identical prompt segments", and a change at one level invalidates that level and every level after it, while "modifying tool definitions (names, descriptions, parameters) invalidates the entire cache" [@anthropic-prompt-caching]. As of November 2026, an entry lives five minutes by default, and each read refreshes it, so the plate stays set only while jobs keep arriving. Prices follow: on Claude Sonnet 5.5 a five-minute cache write costs 1.25 times the base input price and a read costs 0.05 times, so the write pays for itself after one read [@anthropic-pricing]. As of the same date, the minimum is 512 tokens for Sonnet 5.5, and a prompt shorter than that cannot be cached at all [@anthropic-prompt-caching]. [[lst:cache-hit-ours]] and [[lst:cache-hit]] show both sides against a stub or a scripted model that caches the way a provider does.

::::tabs
:::listing[Our gateway]{#cache-hit-ours file="packages/gateway/examples/04-retries-caching.ts" region="cache" replay}
::note[The second call sends the same 3,973-token policy and reports that many tokens as read from the cache, where the first call reported them as written.]{#cache-read}
:::
:::listing[AI SDK]{#cache-hit file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="cache" replay}
::note[The second call sends the same 3,973-token policy and reports that many tokens as read from the cache, where the first call reported them as written.]{#cache-read}
:::
::::

At Sonnet 5.5's rates, the first call in the AI SDK's replay, with 3,973 tokens written, 14 uncached and 20 of output, costs $0.01016. The second, with the same prefix read back, 12 tokens uncached and 20 of output, costs $0.00062, where the same call with no cache, all 3,985 input tokens at the plain input rate, would cost $0.00817. Our replay counts only the user's own text as question tokens, 7 and then 5, so the gateway prices its two calls at $0.01015 and $0.00061, against $0.00816 with no cache. The gateway's catalog supplies those prices for each class of usage the stub reports. The cache costs a quarter more on the first call and saves most of the bill on every call after it. OpenAI's version needs no marking: caching, as of November 2026, is "enabled by default for supported OpenAI models", it reuses a prefix only when "the entire rendered prefix" matches, and the guide's advice is to put stable content first and anything dynamic last [@openai-prompt-caching].

Both providers ask for the same discipline, and a gateway is the right place to carry it, because the loop should not know where a provider puts its breakpoints. Our gateway takes one option, `cacheRetention`{checked=row-53}, with the values `"none"`, `"short"` and `"long"`, and each adapter maps it to its provider's controls. As of November 2026, the Anthropic adapter places up to three breakpoints, on the system prompt, the last tool and the last block of the last user message, under the API's limit of four. Our stub reads only the first of them, the mark on the system prompt, and the example checks that `cacheRetention` `"short"` sends it and `"none"` does not. The OpenAI adapter sends no caching field unless the model's flags ask for one [@buildanagent-gateway-readme-current]. The gateway also keeps each tool's wire name the same for a whole run, with a `ToolNameMap`{checked=row-54}, so that a renamed tool never resets the plate.

The prefix is easy to break from the loop's side. In [[lst:prepare-step-ours]] and [[lst:prepare-step]], a hook offers one tool on the first step and none on the second, and the replay shows the tool list shrinking between requests. Ours is our SDK's `beforeModelCall` hook, which returns `activeTools`; the AI SDK's is `prepareStep`{checked=row-58}, which also forces the first tool, a setting our SDK lacks. On Anthropic, by the rules above, the second request starts from a different front, so it reads nothing from the first's cache. That is our inference from two documented facts, not a measurement, because the example calls no provider. A loop that narrows tools per step buys focus and pays for it in cache reads. The better move, from [[ch:talking-to-a-model]], is to announce a change in a new message at the end and leave the front alone.

::::tabs
:::listing[Our SDK]{#prepare-step-ours file="packages/sdk/examples/11-prepare-step.ts" region="prepare-step" replay}
::note[Step 0 offers only `search`. The first request carries one tool, though the run holds two.]{#first-step}
::note[Step 1 offers no tools. The second request's tool list is empty, so its front differs from the first's.]{#second-step}
:::
:::listing[AI SDK]{#prepare-step file="verify/vercel-ai-sdk/examples/04-prepare-step.ts" region="prepare-step" replay}
::note[Step 0 offers only `search` and forces it. The first request carries one tool.]{#first-step}
::note[Step 1 offers no tools. The second request's tool list is empty, so its front differs from the first's.]{#second-step}
:::
::::

The tool list can also change without your code touching it, and the MCP specification now speaks to that. Its 2026-07-28 changelog lists, among its minor changes: "Servers **SHOULD** return tools from `tools/list`{checked=row-60} in a deterministic order to enable client-side caching and improve LLM prompt cache hit rates" [@mcp-changelog-2026-07-28]. The advice matters because tools lead the prefix. OpenAI's guide lists changes to tool "names, descriptions, schemas, ordering" among the settings that change the cached prefix, and Anthropic's exact-match rule covers the order too, though its page does not name order as such [@openai-prompt-caching; @anthropic-prompt-caching]. A server that lists the same tools in a shuffled order each call hands your agent a reset plate for free. We recommend that your registry sorts the tool list by name, or pins the first listing for the session, whatever order a server sends.

A real cache differs from the plate in two ways. A printer sees a swapped plate; a cache sees only identical bytes, so a reordered tool or a timestamp at the front of the system prompt resets it without a visible change. And a plate stays set until someone swaps it, while a cache entry expires after minutes without a read.

## Reasoning replays only on the model that wrote it, so the gateway drops every foreign signature

Your agent runs on Claude Sonnet 5.5, and at step ten Anthropic answers 529. Your fallback sends the next call to a model from another provider. The transcript already holds three reasoning blocks, each with the signature that [[ch:talking-to-a-model]] showed. Which of them may go in the new request? The loop cannot say, because the answer depends on the provider's rules, and so a gateway has to.

Anthropic ties each thinking block to three things. The first is what came before it: `system`, `tools` and every earlier message. The second is the model: "a model reads only some other models' thinking blocks". The third is the account that produced it [@anthropic-preserved-thinking]. Its switch table shows how uneven the second tie is. As of November 2026, a block written by Claude Haiku 5.5 is readable by Sonnet 5.5, but a block written by Sonnet 5.5 is not readable by Haiku 5.5. Sending a block the target cannot read never causes an error on Anthropic's side: "The API drops it for that request and doesn't bill it" [@anthropic-preserved-thinking]. Other providers give you no such promise. OpenAI's Chat Completions messages have no field for reasoning at all [@buildanagent-gateway-readme-current], so for them the question never reaches the API, and your gateway must answer it first.

Pi answers it in a function called before every request. Its `transformMessages`{checked=row-71} drops thinking from a different model, and the comment in its source reads "Signatures and encrypted reasoning are only valid for the model that produced them" (`@earendil-works/pi-ai@1.5.2`). Our gateway follows the same design, as its guide records, and adds rules of its own [@buildanagent-agent-sdk-guide]. Each reasoning block in our transcript carries a signature record naming the API, the provider and the model that wrote it, and `transformMessages()`{checked=row-68} judges every block against the model it is about to send to. [[tbl:reasoning-rules]] lists the rules.

:::table[What the replay pass does with a reasoning block, by target model, as of November 2026]{#reasoning-rules}
| The block and the target | What the pass does | Why |
| --- | --- | --- |
| Any block, and a target that does not reason | Drops it | The target has no use for it |
| A block another provider wrote | Drops it | Its signature is valid only where it was written |
| A block signed by Anthropic, and an Anthropic target | Keeps it exactly as recorded, empty text included | The API checks the block against its signature, and drops it unbilled if the model cannot read it |
| An unsigned block, and an Anthropic target | Drops it | We read the signature check as rejecting it; Anthropic's page does not say (unverified) |
| Any block, and the OpenAI Chat adapter | Never sends it | A Chat Completions message has no field for reasoning |
:::

One more rule comes from Anthropic's side. A request may leave out the oldest thinking, the newest, or all of it, but not a block between two that it keeps [@anthropic-prefix-checks]. So when our pass must drop one block for an Anthropic target, it drops every older block too, and the kept blocks stay one unbroken run [@buildanagent-gateway-readme-current]. The pass does four more jobs for the same reason, which are skipping failed turns, replacing images for a model that takes none, rewriting tool-call ids a provider would reject, and pairing every tool call with a result. None of them touches the transcript itself.

That last point is why the pass belongs in the gateway and returns a new list each time. Anthropic's advice on switching models is "don't remove thinking, and don't keep a separate history for each model": the next switch back to Sonnet 5.5 finds its reasoning again, because the API never changes your messages [@anthropic-preserved-thinking]. A pass that edited the transcript in place would lose that reasoning for good. Our pass never changes its input, gives the same answer for the same transcript every time, and gives the same answer again when run on its own output [@buildanagent-gateway-readme-current]. Those three properties keep the replayed front byte for byte the same from request to request, which is what the cache of the previous section needs. They also answer the warning on Anthropic's own page: if your requests pass through a gateway, compare what it sends with what you sent [@anthropic-prefix-checks].

Sometimes the check fails anyway. When a conversation's `system`, `tools` or an earlier message changed after a block was written, Anthropic may answer 400 with "The block is bound to a different conversation" [@anthropic-errors]. As of November 2026, our Anthropic adapter treats that one 400 as worth a retry. It streams a warning, sends the request once more with `drop_block`{checked=row-74}, the setting that tells the API to drop the failing blocks, and then keeps sending that setting on every later request of that conversation [@buildanagent-gateway-readme-current]. Anthropic accepts the setting only behind the beta header `thinking-binding-controls-2026-08-01`{checked=row-112}, and on Sonnet 5.5 and Haiku 5.5 only with adaptive thinking [@anthropic-errors]. The adapter's retry follows the second section's pattern with a different cure: it changes the request rather than waiting, because waiting cannot fix a transcript that changed. The cost is real, since dropped reasoning is reasoning the model works without, so treat each such warning as a bug in whatever edited the front.

## Every message carries its cost, and the budget checks the next call's worst case before it leaves

[[ch:talking-to-a-model]] split a call's usage into four token classes with four prices. A gateway is where that sum gets done, once, so no loop repeats it. Our gateway prices every response from a catalog of per-model rates, and each cost says where its number came from: the provider billed it, the catalog priced it, or nobody knows [@buildanagent-gateway-readme-current]. The last case matters most. When the catalog lacks a model, or a stream broke before the provider reported usage, the total is `null`, never zero, because "a budget that counts an unknown price as free never stops" [@buildanagent-gateway-readme-current]. A retried call adds its attempts' costs, and the sum is unknown if any attempt's is.

Prices can also depend on the request. As of November 2026, Claude Haiku 5.5, for one, charges higher rates for a request whose prompt passes 100,000 tokens, counting cache reads and writes in that length, and it prices each request on its own [@anthropic-pricing]. Our catalog records such tiers, and the gateway prices each attempt of a call in its own tier before it adds them up [@buildanagent-gateway-readme-current]. Every entry carries the date its rates were copied, and the repository's CI warns when one is older than 90 days.

A cost on each message tells you what a call did cost. A budget has to know what the next call can cost, before it sends the call. At the till, :analogy[a prepaid card]{#prepaid-card} gets checked before the shop hands anything over: the terminal compares your balance with the price, so the purchase that does not fit is declined and you never find out afterwards that you overspent. The pre-call budget does the same for model calls. Before each call, our loop asks the gateway's `projectCallCost()`{checked=row-90} for the most that call can cost and adds it to what the run has already spent. If the sum passes the cap, the loop ends the run with a `"budget"` stop reason and does not send the call [@buildanagent-gateway-readme-current; @buildanagent-sdk-readme-current].

:::figure[A pre-call budget check: spent plus projected is over the budget, so the call never leaves]{#budget-check}
::svg{alt="A horizontal bar drawn to scale in two parts. The first part, a solid box, is labelled spent, $0.0114. The second, a dashed box that continues the bar, is labelled projected, $0.0249. A dashed vertical line near the right end of the bar is labelled budget $0.0300 and passes through the projected box. Text under the bar reads spent plus projected equals $0.0363, over the budget, and the call is refused before it is sent."}
:::

The projection is a ceiling because, unlike a card terminal, the gateway cannot know the price: a model call's price is not known until it returns. So the gateway prices every input token at the highest input rate in the tier, whether uncached or a cache write, and the whole output limit at the output rate: the call's `maxOutputTokens`{checked=row-90}, or the model's own [@buildanagent-gateway-readme-current]. It estimates the input from the last call's reported usage plus a character-based estimate of what the loop added since, and the estimate errs high, so the check errs towards stopping.

Checking before the call, not after, keeps spend under the cap. The Claude Agent SDK compares spend with its cap after each response, and its docs say "spend can therefore pass the cap by up to the cost of that one response" [@claude-agent-sdk-agent-loop]. As of November 2026, on our SDK's scripted 30-step run, the pre-call check overshot by $0 on every cap, and a check after each response overshot by $0.0105 on average. The price is cap left unspent, $0.054 on average in that run, so lower `maxOutputTokens`{checked=row-90} to tighten the ceiling [@buildanagent-sdk-readme-current].

The AI SDK's example builds the same check in a few lines with a wrapper around the model. [[lst:budget-wrapper]] projects the worst case, refuses the call that would pass the budget, and records what each answer actually cost, so the next projection starts from the true spend. With our SDK no wrapper is needed, because the loop makes that projection and refusal itself, through the `budgetUsd` option of `run()`, which [[lst:budget-wrapper-ours]] sets.

::::tabs
:::listing[Our SDK]{#budget-wrapper-ours file="packages/sdk/examples/12-budget.ts" region="budget"}
::note[The worst case of every call prices its answer at `maxOutputTokens`, here 500 tokens, because the model's own limit is far higher.]{#project}
::note[The cap. The loop checks it before each model call, so a call that does not fit never reaches the model.]{#refuse-before}
::note[The run's cost is the sum of what each answer cost, priced class by class from the catalog, so the next projection starts from the true spend.]{#record-actual}
:::
:::listing[AI SDK]{#budget-wrapper file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="budget"}
::note[The worst case: the prefix priced as a cache write, the rest as uncached input, and an answer that fills `maxOutputTokens`{checked=row-90}. Rates come from [[lst:sonnet-rates]].]{#project}
::note[The refusal. The check runs before `doGenerate`, so the model never sees a call that does not fit.]{#refuse-before}
::note[After the answer, the real usage is priced class by class and added to the ledger.]{#record-actual}
:::
::::

[[lst:budget-refused-ours]] and [[lst:budget-refused]] then run the case the figure draws. In the AI SDK's tab the budget is $0.03, and the refused call, alone, projects $0.0249, so it would fit. But $0.0114 is already spent, so spent plus projected passes the cap, and the example's checks confirm that no request reached the model. Our tab sets a budget of $0.025. Its first call, a tool call, costs $0.01024, and the second call alone projects $0.021088, which fits. The two together come to $0.031328, so the run ends with the stop reason `"budget"` and the second call never goes out. The figure draws the AI SDK's amounts.

::::tabs
:::listing[Our SDK]{#budget-refused-ours file="packages/sdk/examples/12-budget.ts" region="refuse"}
::note[The result of a budget stop carries `spentUsd` and `projectedUsd`, the two numbers the loop compared with the cap.]{#numbers}
::note[The refused call never reached the model: the scripted model saw one request, not two.]{#refused}
:::
:::listing[AI SDK]{#budget-refused file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="refuse"}
::note[The refused call never reached the model: the count of model calls is unchanged.]{#refused}
:::
::::

The ceiling prices the prefix as a cache write, since that is the dearest way to send it. A call with a 3,973-token prefix, an 8-token question and a 20-token answer limit projects $0.0101485 in the example, where pricing the prefix at the plain input rate would give $0.0081620, at Sonnet 5.5's rates. Our tab's projection goes one step further than the wrapper. It prices every input token at the dearest of the three input rates, which for Sonnet 5.5 is the one-hour cache write at $4 per million. Its 4,022 estimated input tokens therefore project $0.016088, and the 500-token answer limit adds $0.005. The projection is never lower than what the call can cost. It also needs a price to project from: a budgeted run whose model has no price ends with an `unknown_price`{checked=row-98} error before its first call, because a cap against an unknown price is no cap [@buildanagent-sdk-readme-current].

Cost accounting is the fifth job that needs the gateway's view of both sides. The loop knows what the task has spent and what it plans to do next. The provider's terms give the rates, the tiers and the token classes. Only the gateway holds both, which is why the same layer retries, caches, replays reasoning and keeps the ledger.

## Exercises

1. **Project the next call, then let the budget decide.** In `verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts`, take the usage in the replay of [[lst:cache-hit]]: the first call wrote 3,973 tokens to the cache, used 14 uncached tokens and wrote 20 of output, and the second call read the prefix back. Work out by hand what the example's projection says for the second call: the prefix priced as a cache write, 12 uncached question tokens, and the 500-token answer limit, all at the rates in [[lst:sonnet-rates]]. Then print `ledger.projected`{checked=row-101} right after the `second` call and compare it with your figure (the answer is $0.0149565). Decide whether the $0.03 budget allows that call after the first call's $0.01016. Finally set `BUDGET_NANOS`{checked=row-101} to `25_000_000`{checked=row-101} and predict which `ask` the budget refuses first and which of the example's checks then fails. The refused call is the one after the first, and the check "an error that is not retryable fails at once" fails, because the budget refused it before the model could fail. When you are done, restore the example and its results with `git checkout -- verify/vercel-ai-sdk` from the repository root.
2. **Reorder the prefix and watch the plate reset.** At the end of the same file, add `const reordered = policy.split("\n").reverse().join("\n");`{checked=row-102} and `const third = await ask(model, "And for exchanges?", reordered);`{checked=row-102}. Before you run it, predict `third.usage.inputTokenDetails.cacheReadTokens`{checked=row-102} and `cacheWriteTokens`{checked=row-102}, and whether the call costs nearer $0.0006 or $0.0102. Run it with `pnpm test` in `verify/vercel-ai-sdk`. Then give the original prefix a fresh budget, with `const fresh = withBudget(scripted);`{checked=row-106} and `await ask(fresh.model, "And for exchanges?")`{checked=row-106}, and check that it still reads from the cache. The first ledger has spent $0.0216 by now, so a call on `model` would be refused. The scripted model decides a hit with one line, `seen.has(prefix)`{checked=row-102}, so this exercise shows our model of the exact-match rule and not a provider's behavior. Name one change to a real request, besides a reordered tool, that would reset a provider's cache in the same way. When you are done, restore the example and its results with `git checkout -- verify/vercel-ai-sdk` from the repository root.
3. **Sort ten failures, then place five jobs.** Write down what the gateway does with each of these failures, using [[tbl:error-kinds]]: a 529 `overloaded_error`{checked=row-31}; a 429 that carries `retry-after: 3`{checked=row-38}; a 429 that carries `retry-after: 300`{checked=row-38}; a 429 with `enforced_spend_limit_reached`{checked=row-31}; a 401; a 413; a dropped connection before any output; a dropped connection after half the answer has streamed; a 400 that says a thinking block "is bound to a different conversation"; and a streamed call whose usage never arrived. For each, say whether it is retried, who waits, and what cost the call records. Then, for your own agent, list which of the five jobs in this chapter (one streaming method, retries, prompt caching, reasoning replay, cost and budget) your loop does today, and which of them need a view of the provider's terms that your loop lacks.
