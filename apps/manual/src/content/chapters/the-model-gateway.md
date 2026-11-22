---
title: "The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost"
summary: A model gateway sits between your agent loop and every provider, so it is the one place that sees each call in the provider's terms. This chapter shows why one streaming method, retries, prompt caching, reasoning replay and cost accounting all live there, and what each of them must not do.
opening: code
sources: [buildanagent-gateway-readme, buildanagent-agent-sdk-guide, anthropic-rate-limits, anthropic-streaming, openai-chat-completions-create, anthropic-errors, openai-rate-limits, anthropic-prompt-caching, anthropic-pricing, openai-prompt-caching, mcp-changelog-2026-07-28, anthropic-preserved-thinking, anthropic-prefix-checks]
glossary: [model-gateway, wire-protocol, delta, token]
switchTo: [B4, B5, B8, B9]
---

Nine lines of code ask a model a question. The helper in [[lst:ask-helper]] hands a refund policy and a question to whatever model you give it, and returns the answer.

:::listing[The helper that every example in this chapter calls]{#ask-helper file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="ask"}
::note[The `cacheControl` entry sits under the `anthropic` key, so it is a request to Anthropic's cache and nobody else's.]{#cache-mark}
::note[The call's own answer limit. Section five uses it to project what the call can cost.]{#output-cap}
:::

The helper names no HTTP status, no wire format, no cache and no price. Yet the example that holds it makes a provider answer "overloaded" and carries on, reads a long policy back from a cache at a fraction of its price, and refuses a call before it leaves the process. Each of those happens in a layer around the model that `ask` never sees. That layer is the model gateway: the code between your agent loop and the providers' APIs. Your loop should not hold it, and a provider's API cannot, because retries, caching, reasoning replay and cost accounting each need a view of every call in the provider's own terms, such as status codes, token classes and signatures, while the loop speaks only in messages. The gateway is the one place that sees both. This chapter takes its five jobs in turn: one streaming method over several wire protocols, retries, prompt caching, reasoning replay across providers, and cost with its pre-call budget. You will leave able to say which of them belong in your own gateway, which the loop must keep, and what the next call will cost before you send it.

## One streaming method lets the loop call any provider, and each adapter hides one wire protocol

Call a company's switchboard and :analogy[a switchboard operator]{#switchboard-operator} connects you to any extension, whatever phone sits on that desk, and writes down the minutes. A gateway plays the operator for your loop. The loop asks for a model, the gateway connects it to Anthropic's or OpenAI's API, and the call's tokens and cost land in a log. Which provider answers is a detail of the connection.

The connection is one method. In our gateway, every provider adapter implements `stream()`{checked=row-6}, which sends one request and returns the events of the answer: a `start`{checked=row-7}, then a start, some deltas and an end for each block of text, reasoning or tool input, and exactly one terminal event, `done`{checked=row-7} or `error`{checked=row-7} [@buildanagent-gateway-readme]. A non-streaming `complete()`{checked=row-8} folds that stream into its final message instead of being a second method to write. The design puts retries, usage, cost and caching in the gateway, so no adapter repeats them [@buildanagent-agent-sdk-guide]. [[fig:one-method]] shows the shape: one method faces the loop, and each adapter turns it into one provider's request.

:::figure[One gateway method in, one wire format out for each provider]{#one-method}
::svg{alt="Three columns of boxes. On the left, a box labelled agent loop has an arrow to a larger box in the middle labelled gateway, stream(), retries, cost. Two arrows lead from the gateway to the right column: one to a box labelled Anthropic adapter, POST /v1/messages, and one to a box labelled OpenAI adapter, POST /chat/completions. Text under the columns reads one method in and one wire format each."}
:::

The saving shows in a mock model. The AI SDK's model interface has two methods, one that returns a whole answer and one that streams it, so the scripted model in [[lst:scripted-two-methods]] must implement both. With a single streaming method, an adapter writes one code path and a test script plays it.

:::listing[The AI SDK's scripted model implements two methods for one answer]{#scripted-two-methods file="verify/vercel-ai-sdk/examples/lib/check.ts" region="scripted"}
::note[`doGenerate` returns the whole answer at once.]{#do-generate}
::note[`doStream` returns the same answer as a stream of parts. Every provider adapter written for this interface pays for both.]{#do-stream}
:::

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

Anthropic's `input_tokens`{checked=row-15} leaves out what the cache supplied. Its rate-limit page gives the sum: total input is `cache_read_input_tokens`{checked=row-17}, `cache_creation_input_tokens`{checked=row-17} and `input_tokens`{checked=row-15} added together, and `input_tokens`{checked=row-15} counts only the tokens after the last breakpoint [@anthropic-rate-limits]. OpenAI's reference defines `prompt_tokens`{checked=row-24} as the "number of tokens in the prompt" and describes its cached tokens as "present in the prompt", which our adapter reads as a part of that count [@openai-chat-completions-create]. The two providers also report usage at different moments. Anthropic sends its closing counts on the stream's last `message_delta`{checked=row-18} event and calls them cumulative [@anthropic-streaming]. OpenAI sends a usage chunk only when the request asks for one, and warns that an interrupted stream may skip it [@openai-chat-completions-create]. One word, "input", therefore names two counts, and a call's usage may arrive late or never. A gateway that passes the providers' numbers through leaves every caller to reconcile them. Ours stores four token classes of its own and converts at the adapter [@buildanagent-gateway-readme].

The example runs the same `ask` over the second protocol. [[lst:wire-listing]] builds an Anthropic model with `createAnthropic`, whose `fetch` function answers in Messages format, and calls `ask` on it twice. The retry, the cache read and the budget refusal of the later sections then work unchanged, and the example's checks assert each of them over this wire as well as over the scripted model.

::listing[The same helper over Anthropic's wire format, against a stub that answers like the API]{#wire-listing file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="wire"}

The operator analogy breaks at one point: an operator only patches a call through, while a gateway also rewrites it. Anthropic wants a turn's tool results as blocks in one user message, and OpenAI wants a message for each, so the adapter reshapes the transcript on every call. It also keeps the transcript in one format of its own, so the loop never sees either provider's. That rewriting, and not the patching, is why a transcript recorded under one provider can continue under another, as the fourth section shows.

One method in and one wire format out give every later job a single place to run. A retry wraps one method, a price attaches to one terminal message, and a cache policy passes through one options object. The next section starts with the job that needs the most care: what to do when the provider says no.

## A retry is safe only before the first output, and only for a failure that waiting can fix

Dial a busy line and you hang up, wait, and dial again, waiting longer each time. That is :analogy[redialling a busy line]{#redial-busy-line}, and a gateway does it for a provider that answers "overloaded". By default our gateway retries a failed call twice, waiting 2 seconds before the first retry and 4 before the second, and each retry shows up in the stream as a `retry`{checked=row-25} event [@buildanagent-gateway-readme]. The wait doubles because a busy server needs room, and because resending at once only digs deeper: OpenAI's rate-limit guide warns that "unsuccessful requests contribute to your per-minute limit, so continuously resending a request won't work" [@openai-rate-limits]. [[lst:retry-once]] shows the happy case. The scripted model fails once with a retryable error, and `ask` returns its answer anyway.

:::listing[A retryable failure costs one retry, and the caller sees only the answer]{#retry-once file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="retry"}
::note[The scripted failure is an overloaded error that marks itself retryable, with a `retry-after-ms`{checked=row-27} header of 0 so the example does not wait.]{#retry-header}
::note[Two attempts for one call: the failure and the retry that succeeded.]{#retry-count}
:::

Two limits stop the redialling from doing harm. The first concerns output. Once a block of the answer has reached the caller, a second attempt would replay text the caller has already seen, so the gateway retries only a failure that arrives before any content [@buildanagent-gateway-readme]. Anthropic's errors page marks the same boundary from its side: an error that comes after a streaming response has returned 200 "doesn't follow these standard mechanisms" [@anthropic-errors]. The second limit concerns the failure itself, because a busy signal clears and some failures never do. The analogy breaks there: a rejected request fails every time you resend it. [[tbl:error-kinds]] shows the four kinds our gateway sorts a failure into, which it decides from the HTTP status and the provider's error code or message together.

:::table[The four kinds of failure, and what the gateway does with each, as of November 2026]{#error-kinds}
| Kind | Example from a provider | Retried? | Why |
| --- | --- | --- | --- |
| Retryable | HTTP 529 `overloaded_error`{checked=row-31}, a 429 rate limit, a dropped connection | Yes, up to twice | Waiting changes the outcome |
| Quota | HTTP 402 `billing_error`{checked=row-31}, or a 429 with `enforced_spend_limit_reached`{checked=row-31} | No | Waiting does not refill a budget |
| Overflow | HTTP 413 `request_too_large`{checked=row-31}, or "prompt is too long" | No | The same request overflows again; the loop must shrink it |
| Fatal | HTTP 401 `authentication_error`{checked=row-31}, any status the gateway does not know | No | A rejected request fails every time |
:::

The quota row shows why a status code alone cannot decide. Anthropic's spend-cap response is a 429, the same status as a rate limit, but it "has no `retry-after`{checked=row-39} header" and "keeps failing until access resumes" [@anthropic-errors]. OpenAI's guide says outright: "Don't retry quota, billing, or other errors that require you to take action" [@openai-rate-limits]. So the gateway reads the code and message first, and treats a 429 as a rate limit only when they name none of the billing causes [@buildanagent-gateway-readme]. [[lst:retry-limits]] runs the two refusals: a 401 fails after one attempt, and two 429s against `maxRetries: 1`{checked=row-36} end the call with a retry error.

:::listing[A failure that waiting cannot fix is not retried, and a retry count is a ceiling]{#retry-limits file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="retry-limits"}
::note[A 401 marks itself not retryable, and the example's check counts exactly one attempt for the call.]{#not-retryable}
::note[Two 429s are scripted and one retry is allowed, so the second failure ends the call with the reason `maxRetriesExceeded`.]{#retry-cap}
:::

Waiting is the other thing a provider can tell you. Anthropic's 429 responses may carry a `retry-after`{checked=row-39} header, and its docs say to wait that many seconds [@anthropic-rate-limits]. Our gateway waits for the longer of its backoff and the hint, capped at 60 seconds, and when a hint asks for more than 60 it stops and returns the failure with the hint attached, with no retry event, so your code can wait and call again [@buildanagent-gateway-readme]. OpenAI's guide asks for the same: when a valid server delay exceeds your maximum, "stop retrying and defer the request rather than retrying sooner" [@openai-rate-limits]. The AI SDK's default does the opposite. It honors a hint between 0 and 60 seconds and otherwise falls back to its own backoff, so a hint of five minutes gets the next retry after 4 seconds, as of `ai@7.0.162`{checked=row-34}. No default is wrong everywhere, so read your SDK's rule before you rely on it.

Retries also stack. The SDK's loop can retry a whole turn above the gateway, with `turnRetries`{checked=row-37} off by default. With the gateway's two retries and `turnRetries`{checked=row-37} set to 2, one call may send up to nine requests, and each failed one may be billed [@buildanagent-gateway-readme]. We counted retries in the gateway's cost for that reason: the final message sums every attempt's usage and cost, so a budget sees what the retries spent. Our gateway adds no random jitter to its waits, which OpenAI's guide recommends so that many clients do not retry in step [@openai-rate-limits]. That is a limit of ours, and the right fix is a jitter option in the gateway, not a copy of the retry loop in every agent.

## Prompt caching pays only while the front of the request stays byte for byte the same

A job printer who keeps :analogy[the letterhead plate set]{#letterhead-plate} between jobs pays for the setup once. Every job on the same letterhead then runs at once and cheaply, until someone swaps the plate and the next job pays for setup again. A provider's prompt cache works the same way, and [[fig:letterhead-plate]] draws it. The provider stores the front of a request after reading it, and a later request that starts with exactly the same front skips that work and pays less for it.

:::figure[A printer that keeps the letterhead plate set between jobs: the second job reuses it, and a moved tool resets it]{#letterhead-plate analogy="letterhead-plate"}
::svg{alt="Three jobs in a row, each with an arrow down to a plate. Job 1, first request, leads to a plate marked plate set, prefix written, priced at write 1.25x. Job 2, same prefix, leads to a plate marked plate reused, prefix read, priced at read 0.05x. Job 3, a tool moved, leads to a dashed plate marked plate reset, prefix rewritten, priced at write 1.25x again. Text under the row reads price of the prefix, against the base input rate."}
:::

Anthropic's cache covers the prefix in a fixed order: `tools`{checked=row-49}, then `system`{checked=row-49}, then `messages`{checked=row-49}, up to the block you mark. Cache hits "require 100 percent identical prompt segments", and a change at one level invalidates that level and every level after it, while "modifying tool definitions (names, descriptions, parameters) invalidates the entire cache" [@anthropic-prompt-caching]. An entry lives five minutes by default, and each read refreshes it, so the plate stays set only while jobs keep arriving. Prices follow as of November 2026: on Claude Sonnet 5.5 a five-minute cache write costs 1.25 times the base input price and a read costs 0.05 times, so the write pays for itself after one read [@anthropic-pricing]. A prompt shorter than the model's minimum cannot be cached at all, and the minimum is 512 tokens for Sonnet 5.5 [@anthropic-prompt-caching]. [[lst:cache-hit]] shows both sides on a scripted model that caches the way a provider does.

:::listing[The first call writes a prefix to the cache, and the second reads it back]{#cache-hit file="verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts" region="cache" replay}
::note[The second call sends the same 3,973-token policy and reports that many tokens as read from the cache, where the first call reported them as written.]{#cache-read}
:::

At Sonnet 5.5's rates the replay's numbers price out as follows. The first call, with 3,973 tokens written, 14 uncached and 20 of output, costs $0.01016. The second, with the same prefix read back, 12 tokens uncached and 20 of output, costs $0.00062, where the same call with no cache would cost $0.00815. The cache costs a quarter more on the first call and saves most of the bill on every call after it. OpenAI's version needs no marking: caching is "enabled by default for supported OpenAI models", it reuses a prefix only when "the entire rendered prefix" matches, and the guide's advice is to put stable content first and anything dynamic last [@openai-prompt-caching].

Both providers ask for the same discipline, and a gateway is the right place to carry it, because the loop should not know where a provider puts its breakpoints. Our gateway takes one option, `cacheRetention`{checked=row-53}, with the values `"none"`, `"short"` and `"long"`, and each adapter maps it to its provider's controls. The Anthropic adapter places up to three breakpoints, on the system prompt, the last tool and the last block of the last user message, under the API's limit of four. The OpenAI adapter sends no caching field unless the model's flags ask for one [@buildanagent-gateway-readme]. The gateway also keeps each tool's wire name the same for a whole run, with a `ToolNameMap`{checked=row-54}, so that a renamed tool never resets the plate.

The prefix is easy to break from the loop's side. In [[lst:prepare-step]], `prepareStep`{checked=row-58} offers one tool on the first step and none on the second, and the replay shows the tool list shrinking between requests. On Anthropic, by the rules above, the second request starts from a different front, so it reads nothing from the first's cache. That is our inference from two documented facts, not a measurement, because the example calls no provider. A loop that narrows tools per step buys focus and pays for it in cache reads. The better move, from [[ch:talking-to-a-model]], is to announce a change in a new message at the end and leave the front alone.

:::listing[A loop that changes the tool list between steps]{#prepare-step file="verify/vercel-ai-sdk/examples/04-prepare-step.ts" region="prepare-step" replay}
::note[Step 0 offers only `search` and forces it. The first request carries one tool.]{#first-step}
::note[Step 1 offers no tools. The second request's tool list is empty, so its front differs from the first's.]{#second-step}
:::

The tool list can also change without your code touching it, and the MCP specification now speaks to that. Its 2026-07-28 changelog lists, among its minor changes: "Servers **SHOULD** return tools from `tools/list`{checked=row-60} in a deterministic order to enable client-side caching and improve LLM prompt cache hit rates" [@mcp-changelog-2026-07-28]. The advice matters because tools lead the prefix. OpenAI's guide lists changes to tool "names, descriptions, schemas, ordering" among the settings that change the cached prefix, and Anthropic's exact-match rule covers the order too, though its page does not name order as such [@openai-prompt-caching; @anthropic-prompt-caching]. A server that lists the same tools in a shuffled order each call hands your agent a reset plate for free. We recommend that your registry sorts the tool list by name, or pins the first listing for the session, whatever order a server sends.

The analogy breaks in two places. A printer sees a swapped plate; a cache sees only identical bytes, so a reordered tool or a timestamp at the front of the system prompt resets it without a visible change. And a plate stays set until someone swaps it, while a cache entry expires after minutes without a read.

## Reasoning replays only on the model that wrote it, so the gateway drops every foreign signature

Your agent runs on Claude Sonnet 5.5, and at step ten Anthropic answers 529. Your fallback sends the next call to a model from another provider. The transcript already holds three reasoning blocks, each with the signature that [[ch:talking-to-a-model]] showed. Which of them may go in the new request? The loop cannot say, because the answer depends on the provider's rules, and so a gateway has to.

Anthropic ties each thinking block to three things. The first is what came before it: `system`, `tools` and every earlier message. The second is the model: "a model reads only some other models' thinking blocks". The third is the account that produced it [@anthropic-preserved-thinking]. Its switch table shows how uneven the second tie is. A block written by Claude Haiku 5.5 is readable by Sonnet 5.5, but a block written by Sonnet 5.5 is not readable by Haiku 5.5, as of November 2026. Sending a block the target cannot read never causes an error on Anthropic's side: "The API drops it for that request and doesn't bill it" [@anthropic-preserved-thinking]. Other providers give you no such promise. OpenAI's Chat Completions messages have no field for reasoning at all [@buildanagent-gateway-readme], so for them the question never reaches the API, and your gateway must answer it first.

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

One more rule comes from Anthropic's side. A request may leave out the oldest thinking, the newest, or all of it, but not a block between two that it keeps [@anthropic-prefix-checks]. So when our pass must drop one block for an Anthropic target, it drops every older block too, and the kept blocks stay one unbroken run [@buildanagent-gateway-readme]. The pass does four more jobs for the same reason, which are skipping failed turns, replacing images for a model that takes none, rewriting tool-call ids a provider would reject, and pairing every tool call with a result. None of them touches the transcript itself.

That last point is why the pass belongs in the gateway and returns a new list each time. Anthropic's advice on switching models is "don't remove thinking, and don't keep a separate history for each model": the next switch back to Sonnet 5.5 finds its reasoning again, because the API never changes your messages [@anthropic-preserved-thinking]. A pass that edited the transcript in place would lose that reasoning for good. Our pass never changes its input, gives the same answer for the same transcript every time, and gives the same answer again when run on its own output [@buildanagent-gateway-readme]. Those three properties keep the replayed front byte for byte the same from request to request, which is what the cache of the previous section needs. They also answer the warning on Anthropic's own page: if your requests pass through a gateway, compare what it sends with what you sent [@anthropic-prefix-checks].

Sometimes the check fails anyway. When a conversation's `system`, `tools` or an earlier message changed after a block was written, Anthropic may answer 400 with "The block is bound to a different conversation" [@anthropic-errors]. Our Anthropic adapter treats that one 400 as worth a retry: it streams a warning and sends the request once more with `drop_block`{checked=row-74}, the setting that tells the API to drop the failing blocks, and then sends it on every later request of that conversation [@buildanagent-gateway-readme]. It is the retry of the second section with a different cure. The adapter changes the request rather than waiting, because waiting cannot fix a transcript that changed. The cost is real, since dropped reasoning is reasoning the model works without, so treat each such warning as a bug in whatever edited the front.

## Exercises

1. **Draft.** Placeholder.
