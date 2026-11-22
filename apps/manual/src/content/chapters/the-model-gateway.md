---
title: "The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost"
summary: A model gateway sits between your agent loop and every provider, so it is the one place that sees each call in the provider's terms. This chapter shows why one streaming method, retries, prompt caching, reasoning replay and cost accounting all live there, and what each of them must not do.
opening: code
sources: [buildanagent-gateway-readme, buildanagent-agent-sdk-guide, anthropic-rate-limits, anthropic-streaming, openai-chat-completions-create]
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

## Exercises

1. **Draft.** Placeholder.
