---
title: "Talking to a model: messages, streams, tokens, instructions and model choice"
summary: A model call sends the whole conversation and gets back one message, often as a stream of pieces, with a bill in four token classes. This chapter reads each part of that exchange, then shows what belongs in the system prompt, how to choose a model, and why thinking goes back to the model untouched.
opening: code
sources: [anthropic-working-with-messages, ai-sdk-prompts, anthropic-how-tool-use-works, ai-sdk-generating-text, ai-sdk-stream-text, langchain-streaming, copilot-streaming-events, anthropic-pricing, anthropic-thinking, anthropic-prompt-caching, anthropic-effective-context-engineering, ghosh-truthgate, anthropic-prefix-checks, openai-practical-guide-to-building-agents, anthropic-preserved-thinking, anthropic-glossary, buildanagent-gateway-readme, ovadia-knowledge-injection, gekhman-new-knowledge, map-measuring-agents, openai-optimizing-llm-accuracy, openai-model-optimization, anthropic-fine-tune-haiku, google-tuning-intro, anthropic-prompt-engineering-overview, medprompt, gepa, fireact, swe-rl, openai-pricing, openai-gpt-4-1-mini, openai-deprecations, google-model-versions, bedrock-model-lifecycle, qi-fine-tuning-safety, cursor-composer, cognition-swe-1-5, anthropic-model-deprecations, gemini-api-model-tuning]
glossary: [token, system-prompt, delta, prompt-cache, thinking-block, fine-tuning]
switchTo: [B4, B5]
---

:::listing[The second request of a conversation, copied from Anthropic's Messages API guide]{#second-turn}
```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello, Claude" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "user", "content": "Can you describe LLMs to me?" }
  ]
}
```
:::

Read the middle message of [[lst:second-turn]], a request copied from Anthropic's guide [Using the Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages). Your program is telling the model what the model said a moment ago. "Hello!" came back from the first request, and here it goes out again with the role `assistant`, between the user's two turns, because nothing on the other side kept it. Anthropic's documentation puts the rule in one line: the Messages API "is stateless, which means that you always send the full conversational history to the API" [@anthropic-working-with-messages]. Its message threads, in beta as of November 2026, can hold a conversation for a few minutes between requests, but every listing in this book sends the whole history each time. The same page adds that earlier turns need not come from Claude, since your code may write "synthetic `assistant` messages" of its own.

That small request holds most of this chapter. You send a list of messages, each with a role, and one message comes back, often as a stream of pieces. Every token in both directions lands on a bill, and the instructions at the top of the list are paid for on every call, so they should be short and stay the same. The model that reads them is a choice you can test, and when that model thinks before it answers, its thinking comes back too and must go out again untouched. By the end of the chapter you can read any model exchange in this book's replays, price it from its usage, and say what belongs in its system prompt.

## A call sends the whole conversation, and every message has a role

Each request is a list of messages, and each message has a role that says who is speaking. The AI SDK, whose listings this chapter uses most, types four roles. A `system` message holds the builder's instructions, a `user` message holds what a person asked, an `assistant` message holds an answer the model gave, and a `tool` message carries the result of a tool the model asked for, which [[ch:tools]] covers. Providers spell the roles their own way on the wire. Anthropic's API, for instance, takes the system prompt in its own `system` field beside the messages [@anthropic-working-with-messages], and it expects tool results back inside a `user` message [@anthropic-how-tool-use-works]. The SDK translates for you. Our gateway types three message roles instead: a user message, an assistant message and a tool result, with the system prompt in a `system` field of the call itself [@buildanagent-gateway-readme].

[[fig:resent-history]] shows what statelessness does to a conversation once a tool joins it. The run comes from the LangChain example that the next section streams. Its first request carries one message, the user's "Find it", and the model answers with a call to a `lookup`{checked=row-10} tool. The second request then carries three messages: the user's question again, the model's own tool call, and the tool's result, "found". Only with all three in hand does the model answer "Here it is."

:::figure[The second request carries the whole conversation again, each message with its role]{#resent-history}
::svg{alt="Two columns of message cards. Request 1 holds one card, user: Find it, and the model's reply below it is assistant: calls lookup. Request 2 holds three cards, user: Find it, assistant: calls lookup, and tool: found, and the model's reply below them is assistant: Here it is. Dashed arrows marked sent again lead from the first request's user card and from its reply to the matching cards of request 2."}
:::

Roles also tell the model whose words to trust, so the AI SDK guards the `system` role. Your code sets the system prompt through `instructions`{checked=row-11}, and a `system` message inside `messages` makes the call fail unless you opt in, as [[lst:system-in-messages]] shows.

:::listing[A system message inside the conversation is refused until you opt in]{#system-in-messages file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="system-in-messages" replay}
::note[A message with the role `system`, placed in the conversation itself instead of in `instructions`{checked=row-11}.]{#system-role}
::note[`generateText` throws `InvalidPromptError`, and no request reaches the model.]{#rejected}
::note[`allowSystemInMessages: true` accepts the same history, as you need when you resend a saved conversation that already holds system messages.]{#opt-in}
:::

The replay shows the refusal happening before anything reaches the network. The file's first call, from line 10, sends its request and gets its answer, and five checks on lines 15 to 19, outside this listing, confirm that answer. Next comes the check on line 39 that the error was thrown. No request event sits between the first call's answer and that check, so the refused call never reached the mock. Only the call with the opt-in goes out, carrying a system message and a user message, and it comes back with "A joke."

The AI SDK's documentation explains why the default refuses: opting in "can create a prompt injection risk where users can override or set the system prompt by injecting system messages", so "only trusted server-side code should set system instructions via the `instructions`{checked=row-11} property" [@ai-sdk-prompts]. We recommend the same rule when you store conversations: your code writes the system prompt, and nothing a user typed should go back to the model under that role.

[[lst:system-in-messages]] has no tab on our gateway, because the gateway refuses a message with the role `system` and has no option that opts in. Such a message is a type error there, since a `Message` has no such role, and one cast past the type is refused at run time with an `invalid_message`{checked=row-205} error. The `system` field of `ModelContext` is the only place its system prompt goes.

Because the model keeps nothing, everything it needs rides in each request, and that has two consequences. First, a request can grow only as large as the model's context window, "the amount of text a language model can look back on" [@anthropic-glossary], and [[ch:the-session-log-and-context]] covers what to do when a conversation outgrows it. Second, every token a request carries is billed on every call, the whole conversation, each tool result and the system prompt included. The section after next counts that bill.

## A stream hands you the answer in pieces, and the message at the end is the one that counts

Watch :analogy[a news ticker]{#news-ticker} crawl along the bottom of a television screen. The words arrive a few at a time, and you can start reading before the sentence is done. Nobody files the ticker, though. The record is the article published once the story is complete, and the crawl was only a way to see it early.

Streaming gives your code the ticker's head start. Instead of waiting for the whole answer, your code receives it as a run of deltas, small pieces of text sent as the model produces them, and folds them together as they arrive. [[lst:text-stream-ours]] and [[lst:text-stream]] each stream one answer, the first through our gateway's `stream()` and the second with the AI SDK's `streamText`. The first tab of this listing and of [[lst:stream-usage-ours]] runs on `@buildanagent/gateway`, and the second tab runs the same step on the AI SDK, so you can see what changes between SDKs and what stays. As of November 2026 the gateway is a `0.1.0` alpha release, so its names may still change.

::::tabs
:::listing[Our gateway]{#text-stream-ours file="packages/gateway/examples/01-text-stream.ts" region="text-stream" replay}
::note[`scripted` gives the gateway's own Anthropic adapter a scripted Messages stream, so the call needs no key and sends nothing over the network.]{#scripted}
::note[`model.stream(context)` yields events, and each `"text_delta"` event holds one piece of the text in `delta`. This loop keeps them in order.]{#deltas}
::note[The last event is `"done"`, or `"error"` when the call failed, and it carries the whole `AssistantMessage`.]{#closing}
:::
:::listing[AI SDK]{#text-stream file="verify/vercel-ai-sdk/examples/06-streaming.ts" region="text-stream" replay}
::note[`streamText` returns at once, without `await`. The call is already under way, and its text reaches you through the result's streams and promises.]{#returns-at-once}
::note[`result.textStream` yields each text delta as it arrives; this loop keeps them in order.]{#deltas}
:::
::::

The scripted answer, "Streams arrive in pieces.", reached the loop as four deltas, because this book's mock models split their text after each space. A real provider sends pieces of whatever size it produces. The AI SDK's documentation says `streamText` "immediately starts streaming" [@ai-sdk-generating-text]. The checks under the region then show the fold: the four deltas join to the full text, and `result.text`, a promise, resolves to that same text once the stream ends. So does `result.finishReason`{checked=row-22}, which says why the model stopped, something no single delta can tell you [@ai-sdk-stream-text]. Our tab's checks show the same fold: the deltas join to the full text, and the closing message holds that text and carries its `stopReason`{checked=row-137}.

The ticker's lesson holds in every SDK, though each one cuts the stream at its own grain. The three tabs below stream one run each:

- **AI SDK.** Besides bare text, `result.stream` yields typed parts. A `"start"` part opens the whole stream and a `"finish"` part closes it, while `"start-step"` and `"finish-step"` parts frame each step between them. Each `"text-delta"` part carries its piece of text in `text` [@ai-sdk-stream-text].
- **LangChain.** An agent's `stream()` in `streamMode: "updates"` yields one chunk per step of the agent, not per piece of text. Its run yields three chunks, named for the steps that ran: `"model_request"`, `"tools"`, `"model_request"`. LangChain's documentation sends token-sized pieces through a different mode, `"messages"` [@langchain-streaming].
- **Copilot SDK.** A session with `streaming: true`{checked=row-27} emits `"assistant.message_delta"` events, each holding a `deltaContent` piece, and then one `"assistant.message"` event with the whole text [@copilot-streaming-events].

:::tabs
::listing[AI SDK]{#stream-parts file="verify/vercel-ai-sdk/examples/06-streaming.ts" region="stream-parts"}
::listing[LangChain]{#langchain-updates file="verify/langchain/examples/08-streaming.ts" region="updates"}
::listing[Copilot SDK]{#copilot-deltas file="verify/copilot-sdk/examples/05-streaming.ts" region="deltas"}
:::

The Copilot SDK draws the line between the two kinds of event most sharply. Its documentation calls each delta "ephemeral": "streamed in real time but **not** persisted to the session log" and "Not replayed on session resume". The complete `"assistant.message"`, by contrast, is persisted [@copilot-streaming-events]. The example's own checks make the same point from the other side. With streaming on, the session emitted two deltas that join to the final message; with streaming off, it emitted none, and the final message was the same. Streaming changes how early you see the answer, never what the answer is.

A ticker and a stream differ in one way that matters. A news crawl reports facts that already happened, while a delta is provisional: the stream can stop short or end in an error, and only the message at the end says what the model finished saying. We recommend that your code show deltas to people as they arrive but store, bill and act on the final message alone. This book's own gateway, `@buildanagent/gateway`, builds that rule into its stream, as [[lst:text-stream-ours]] shows: as of November 2026, every stream ends with exactly one closing event, `"done"` or `"error"`, and that event carries the assistant message, with whatever content arrived before a failure.

## Every call runs a meter, and tokens fall into four classes with four prices

A model call has a fare, and the provider charges it like :analogy[a taxi meter that runs on both legs of the trip]{#taxi-meter}. The meter ticks on the way out, while your request rides to the model, and it keeps ticking on the way back, while the answer rides home, as [[fig:taxi-meter]] shows. This meter counts tokens, the small units a model reads and writes, each a word, part of a word or a character [@anthropic-glossary]. You pay for the input tokens you send and for the output tokens you get back, each class at its own rate.

:::figure[A taxi meter that runs on both legs of the trip: input tokens on the way out, output tokens on the way back]{#taxi-meter analogy="taxi-meter"}
::svg{alt="A taxi travels between two boxes, your code on the left and the model on the right. An arrow out to the model is labelled out: 3,000 input tokens, and an arrow back is labelled back: 200 output tokens. Below, the meter reads out leg: $0.0034, back leg: $0.0020, fare: $0.0054."}
:::

The input leg has more fare classes than a taxi does. A provider counts input three ways: tokens read from its prompt cache, tokens written to that cache for later calls, and the rest, which it reads uncached. With the output, that makes four token classes, and the bill for one call is each class's count times its rate, summed. The AI SDK reports the three input classes as `noCacheTokens`, `cacheReadTokens` and `cacheWriteTokens` in `usage.inputTokenDetails`, and the output beside them in `usage.outputTokens` [@ai-sdk-stream-text]. Our gateway names the same classes `uncachedInput`, `cacheRead` and `cacheWrite` in the `Usage` of the message that closes the stream, beside `output`. Its `cacheWrite` holds one count for each cache lifetime [@buildanagent-gateway-readme]. [[lst:stream-usage-ours]] and [[lst:stream-usage]] each stream one answer, read its usage and price it.

::::tabs
:::listing[Our gateway]{#stream-usage-ours file="packages/gateway/examples/02-stream-usage.ts" region="stream-usage" replay}
::note[The usage arrives on the stream's closing message, so it is readable only once the loop has ended.]{#usage-at-end}
::note[The four classes. The mock reports 1,000 uncached, 1,500 read from the cache and 500 written to the 5-minute cache, which `cacheWrite` counts under `"5m"`, plus 200 output.]{#four-classes}
::note[The gateway has already priced the message: `total` is 0.0054 dollars and `basis` is `"catalog"`, because the cost came from the catalog's rates for the model id.]{#priced}
:::
:::listing[AI SDK]{#stream-usage file="verify/vercel-ai-sdk/examples/10-streaming-usage.ts" region="stream-usage" replay}
::note[The usage arrives with the stream's last part, so this promise resolves only once the stream has ended.]{#usage-at-end}
::note[The three input classes. The mock reports 1,000 uncached, 1,500 read from the cache and 500 written to it.]{#input-classes}
::note[Each class times its own rate, from [[lst:sonnet-rates]]: the call costs 5,400,000 nano-dollars, or $0.0054.]{#price-the-classes}
:::
::::

::listing[Claude Sonnet 5.5's rates as of November 2026, in nano-dollars per token]{#sonnet-rates file="verify/vercel-ai-sdk/examples/lib/rates.ts" region="rates"}

The rates in [[lst:sonnet-rates]] are Anthropic's published prices for Claude Sonnet 5.5, as of November 2026. Our tab has no rates file, because the gateway's shipped price catalog holds the same four rates, copied from the same pricing page on 2026-11-19, and prices every message from them [@buildanagent-gateway-readme]. Per million tokens, an uncached input token costs $2, a five-minute cache write $2.50, a cache read $0.10 and an output token $10 [@anthropic-pricing]. Work the sum by hand once and the four classes stop being abstract. The 1,000 uncached tokens cost $0.002, the 1,500 cache reads $0.00015, the 500 cache writes $0.00125 and the 200 output tokens $0.002, which totals $0.0054. Billed as if none of the 3,000 input tokens touched the cache, the same call would cost $0.008, and the last check of each example confirms that the cached bill is lower.

[[fig:stream-fold]] puts the whole call on one page: the deltas, the message they fold into, and the usage that came with the stream's last part.

:::figure[One streamed call: eleven deltas fold into one message, and the usage splits into four priced classes]{#stream-fold}
::svg{alt="Eleven small boxes hold the deltas Prompt, caching, bills, a, cache, read, at, 0.05x, the, input and rate. An arrow labelled fold leads to one assistant message: Prompt caching bills a cache read at 0.05x the input rate. Below, four boxes give the usage: uncached 1,000 tokens $0.00200, cache read 1,500 tokens $0.00015, cache write 500 tokens $0.00125, and output 200 tokens $0.00200, for a total of $0.0054."}
:::

Two facts about these prices explain most agent bills. First, output costs five times as much as uncached input for this model, so a long answer adds up quickly. Second, an agent's input grows with every call, because every call resends the conversation, and the cache discounts exactly that resent front of the request. Anthropic bills a cache read on Claude Sonnet 5.5 and Opus 5.5 at 0.05 times the base input price, and on most other models at 0.1 times. A five-minute cache write costs 1.25 times the base price, which, in Anthropic's words, pays off "after one cache read" [@anthropic-pricing].

Thinking, which the last section covers, goes on the output side of the meter: Anthropic bills the tokens a model spends reasoning "as output tokens, even when the thinking text isn't returned to you" [@anthropic-thinking], and the AI SDK counts them in `usage.outputTokenDetails.reasoningTokens`{checked=row-48} [@ai-sdk-stream-text].

The replay beside either tab shows the token counts on the model's answer itself. Under the answer's text, the replay names the model id the mock reported, `claude-sonnet-5-5`. It also lists the four counts the answer's usage carried: 1,000 uncached input tokens, 1,500 read from the cache, 500 written to it and 200 output tokens. Because the example's script set those counts, the checks that follow repeat them: 3,000 input tokens in all, each class on its own, and a cost of $0.0054. The transcript also keys the request and the answer by `model-1`, its recorder's name for the first model the example called, and keeps the reported id beside that name.

The meter and the bill disagree at one point, the cache. A taxi has no fare for a stretch of road it drove an hour ago, but a model provider does: a cached input token is billed at a fraction of the uncached rate, and only while the cache holds it. By default a cache entry lives at least five minutes, and each read refreshes it [@anthropic-prompt-caching], so the discount rewards a conversation that keeps its front unchanged. The next section is about the part of the front that should never change.

## Keep the system prompt short, and freeze it for the session

A city tour guide carries :analogy[a briefing card on every tour]{#tour-guide-card}: the route, the meeting point, the three facts to tell at the cathedral, and which questions to pass on to the office. The card is short, because the guide reads it before every tour, and it stays the same all day. Today's weather and the size of this morning's group are not on it. The guide learns those at the meeting point.

The system prompt is that card. It sits at the front of every request, so the model reads it, and you pay for it, on every call. Anthropic's advice on writing one names the target as "the minimal set of information that fully outlines your expected behavior" and adds at once that "minimal does not necessarily mean short" [@anthropic-effective-context-engineering]. The post places a good prompt at the "right altitude" between two failure modes. One is "hardcoding complex, brittle logic", and the other is "vague, high-level guidance that fails to give the LLM concrete signals for desired outputs". It also recommends organizing the prompt "into distinct sections", marked with XML tags or Markdown headers, and giving the model "diverse, canonical examples" instead of a list of every edge case.

Take Chapter 1's order-status agent. In our view its card holds four things: who the agent is and whom it serves, the format of a reply, the policy it must follow, such as never promising a delivery date the carrier has not given, and one or two example exchanges. Three kinds of text stay off the card:

- **Facts that change**, such as today's date or the customer's name and orders. They go in a later message, as the weather reaches the guide at the meeting point.
- **Procedures for one kind of request**, such as handling a refund dispute. They load when that request arrives, so they do not cost tokens on every call.
- **Rules that must hold every time.** A sentence in a prompt asks; only code can refuse. A sentence still moves behavior, only not all the way. In [[paper:ghosh-truthgate]], appending a single sentence to the system prompt cut Claude Sonnet 5.5's cheating on a 60-task set from 22 cases to 8, not to none [@ghosh-truthgate]. A rule such as "never refund more than the order total" belongs in the refund tool's own check, which [[ch:tools]] and [[ch:approvals-guardrails-and-injection]] build.

The card stays frozen because two mechanisms read the front of the request as one unit. The first is the prompt cache. Anthropic builds its cache prefix in the order `tools`, `system`, then `messages`, and "Changes at each level invalidate that level and all subsequent levels" [@anthropic-prompt-caching]. With caching on, edit one word of the system prompt and the next call pays to write the system prompt and the whole conversation to the cache again. At Claude Sonnet 5.5's rates, as of November 2026, a 2,000-token system prompt read from the cache costs $0.0002, and written again it costs $0.005, twenty-five times as much, before the conversation behind it is counted [@anthropic-pricing].

The second mechanism is stricter, and it applies when the model thinks before it answers. On Claude 5 and later models, thinking is on by default, and the response carries the model's reasoning in thinking blocks [@anthropic-thinking], which [the chapter's last section](#thinking-comes-back-with-a-signature-and-it-goes-back-unchanged) reads in full. Two facts about them are enough for now. First, your code sends each block back on later calls, so that the model can build on its earlier reasoning [@anthropic-preserved-thinking]. Second, Anthropic's models with preserved thinking, Claude Opus, Sonnet and Haiku 5.5 among them as of November 2026, check each block against everything that came before it.

That prefix check reaches back to the system prompt, since it "fails if `system`, `tools`, or an earlier message changed after Claude produced a block" [@anthropic-prefix-checks]. Anthropic's own example is the one this section warns about: an app that puts today's date in its system prompt. "At midnight the date changes, and so does the prefix of the thinking already in the conversation", and the next request can fail. The fix the same page gives is the tour guide's: keep the system prompt as it was, and state the new date in a message at the end. On newer Claude models that message may even carry the `system` role, since a system message added mid-conversation "does not invalidate any cached prefix that came before it" [@anthropic-working-with-messages].

A guide can do two things with the card that you cannot do with a system prompt. A guide who finds a line on the card unclear can phone the office and ask; a model cannot ask what an instruction meant, so it acts on its best reading of the words. And a guide can cross out a line between tours at no cost, while a changed system prompt breaks the cache, and on some models the conversation's thinking, for every call that follows. Write the card carefully, then leave it alone until the session ends.

## Choose a model by starting with the most capable, then trying smaller ones against your evals

When a new play is cast, many directors follow :analogy[a casting habit with understudies]{#casting-understudies}: give the lead to the most experienced actor first, to learn what the part can be, then have understudies play the same scenes and keep whoever plays them well enough. Nobody casts the cheapest actor first and hopes. The part has to be seen played well before anyone can judge a cheaper performance of it.

OpenAI's guide to building agents casts models in that order. "An approach that works well is to build your agent prototype with the most capable model for every task to establish a performance baseline. From there, try swapping in smaller models to see if they still achieve acceptable results." The guide's reason is that "you don't prematurely limit the agent's abilities, and you can diagnose where smaller models succeed or fail". It sums the method up in three principles: "Set up evals to establish a performance baseline", "Focus on meeting your accuracy target with the best models available", and "Optimize for cost and latency by replacing larger models with smaller ones" [@openai-practical-guide-to-building-agents]. Anthropic's context-engineering post starts in the same place, "testing a minimal prompt with the best model available to see how it performs on your task" [@anthropic-effective-context-engineering].

The prices show why the second step is worth taking. [[tbl:claude-rates]] lists the three Claude 5.5 models as of November 2026, and the gap from the top of the table to the bottom is large.

:::table[Claude 5.5 rates per million tokens, as of November 2026]{#claude-rates}
| Model | Uncached input | Five-minute cache write | Cache read | Output |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 | $4 | $5 | $0.20 | $20 |
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 | $10 |
| Claude Haiku 5.5, prompts up to 100,000 tokens | $0.10 | $0.125 | $0.01 | $0.50 |
:::

Priced at Opus 5.5's rates, the call in [[lst:stream-usage]] costs $0.0108, twice the $0.0054 it costs on Sonnet 5.5. Haiku 5.5's rates are a twentieth of Sonnet's for uncached input and output, and Haiku is priced by prompt length: a request whose prompt is over 100,000 tokens pays $0.50 for input and $2.50 for output, still well under Sonnet [@anthropic-pricing]. Anthropic's own rule of thumb points the same way as OpenAI's method: "Choose Haiku for simple tasks, Sonnet for most production workloads, and Opus for the most complex reasoning."

A smaller model is the right choice only when it still passes. OpenAI's guide notes that "a simple retrieval or intent classification task may be handled by a smaller, faster model, while harder tasks like deciding whether to approve a refund may benefit from a more capable model", and that one workflow may use "a variety of models for different tasks" [@openai-practical-guide-to-building-agents]. The order-status agent of Chapter 1 shows the split. Sorting a message into "where is my order" or "something else" is classification, which a small model may handle. Deciding what to tell a customer whose parcel is held at customs is judgement, which may need the large one. We recommend comparing models by the cost of each task that passes your evals, not by the price of a call, because a cheap model that fails one task in five sends that task to a second attempt or to a person.

Rehearsal is where the casting habit stops fitting. An understudy improves with every run-through, but a model keeps nothing between calls, so the hundredth run of an eval meets the same model as the first. What improves between runs is everything around the model, the prompt and the evals that judge it, which is why the evals have to exist before the swap. This book's listings cannot run that comparison for you, since every model in them is a mock that plays back answers someone wrote. [[ch:testing-offline-and-a-first-agent]] shows what such checks prove and what only a real model can.

## Tune a model only for a behaviour gap that prompting could not close, and treat the tuned model as a new model

Picture a support team that sends a thousand tickets a day through a classifier, and the agent's labels are right nine times in ten. Choosing a model, the last section's job, does not settle what to do about the tenth. The team can write a better prompt, or it can train a model on its own examples. Training is called fine-tuning, or tuning for short: further training of a model's weights on your examples after its provider released it. Its product is a tuned model, with a new id. The choice resembles :analogy[sending an employee on a year-long course instead of handing a skilled contractor a clear brief]{#course-versus-brief}. The course changes the employee for good and takes months. The brief takes an afternoon and changes nothing about the contractor. Most jobs need only the brief, and the evidence below says which do not.

### Tuning changes how a model behaves more than what it knows

If the tenth ticket fails because the model lacks a fact, such as this month's refund policy, tuning is the wrong tool. [[paper:ovadia-knowledge-injection]] compared unsupervised fine-tuning with retrieval, which puts the relevant text into the request, on knowledge-heavy questions, using three open models of about 7 billion parameters. Retrieval "consistently outperforms it, both for existing knowledge encountered during training and entirely new knowledge" [@ovadia-knowledge-injection]. [[paper:gekhman-new-knowledge]] found a second cost, in one model on closed-book questions: training examples that carry new facts "are learned significantly slower", and once learned they "linearly increase the model's tendency to hallucinate" [@gekhman-new-knowledge]. Two of the 20 teams that [[paper:map-measuring-agents]] interviewed still tuned for domain knowledge, but the study reports their choice, not a comparison with retrieval [@map-measuring-agents].

If the tenth ticket fails because the model keeps answering in the wrong format or tone, tuning is the right tool. OpenAI's guide sends missing or stale knowledge to context and sends "inconsistent results with incorrect formatting" and the wrong "tone or style" to tuning [@openai-optimizing-llm-accuracy]. It lists classification and "Generating content in a specific format" as the jobs for supervised fine-tuning [@openai-model-optimization]. Anthropic published one such result, a vendor result on its own task: tuning Claude 3 Haiku to moderate forum comments raised classification accuracy from 81.5% to 99.6% and cut tokens per query by 85% [@anthropic-fine-tune-haiku].

### Prompt and measure first, and tune to move one job to a smaller model

All three providers say the same thing in order. OpenAI: "The prompt engineering process may be all you need" [@openai-model-optimization]. Google: "Start with prompting to find the optimal prompt. Then, move on to fine-tuning (if required)" [@google-tuning-intro]. Anthropic's prompting guide starts from success criteria and tests, and adds that "you can sometimes improve latency and cost more easily by choosing a different model" [@anthropic-prompt-engineering-overview].

Careful prompting has also beaten tuned models on benchmarks. In [[paper:medprompt]], GPT-4 steered by a combination of general prompting methods beat Med-PaLM 2, a model tuned on medical data, "by a large margin with an order of magnitude fewer calls", with a 27% lower error rate on the MedQA exam questions [@medprompt]. [[paper:gepa]], a prompt optimiser that reflects on a system's trajectories and rewrites its prompts, beat the reinforcement-learning method GRPO on five of six tasks by up to 19 points, and by about 6 points on average across all six, with up to 35 times fewer rollouts, in tests on Qwen3 8B [@gepa].

Where tuning pays is narrower: it teaches a small model to do one job that a large model does well. [[paper:fireact]] tuned Llama2-7B on 500 agent trajectories that GPT-4 had generated, and its exact-match score on HotpotQA rose 77% [@fireact]. [[paper:swe-rl]] trained a 70-billion-parameter Llama with reinforcement learning to a 41.0% solve rate on SWE-bench Verified, "comparable to leading proprietary LLMs like GPT-4o" [@swe-rl]. In our reading, these papers buy a small open model that does one agent's job, not a model better than the frontier of its day. Tuning is therefore a step after the last section's model choice. We suggest this order: swap in a smaller model, see whether it passes, and tune only if it almost does.

### A tuned model is a new model, with its own price and a short life

A tuned model has its own price. As of November 2026, OpenAI's tuned GPT-4.1 mini costs $0.80 per million input tokens and $3.20 per million output tokens, twice the base model's $0.40 and $1.60 [@openai-gpt-4-1-mini], and training costs $5 per million training tokens [@openai-pricing]. Take 1,000 examples of 2,000 tokens, trained for three epochs. That is 6 million tokens and a $30 training run, which we judge small next to an engineer's time. The price per token is where the money goes. [[lst:tuned-prices]] holds the two rate sets the next listing prices.

::listing[GPT-4.1 mini's base and tuned rates, in nano-dollars per token as of November 2026]{#tuned-prices file="verify/vercel-ai-sdk/examples/11-tuned-vs-cached.ts" region="price-table"}

Tuning saves money by removing a long block of instructions and examples from every request, but caching already discounts such a block. [[lst:tuned-vs-cached]] prices three scripted calls, each answering in 300 tokens: the base model uncached, the base model with its block cached, and the tuned model. The token counts are scripted usage, not text the example sends. The base model reports a 4,000-token block plus a 200-token question, and the tuned model reports the question alone.

:::listing[A tuned model priced against the same prompt cached]{#tuned-vs-cached file="verify/vercel-ai-sdk/examples/11-tuned-vs-cached.ts" region="compare" replay}
::note[A training run breaks even once its savings cover its cost. A call that saves nothing never does, so the function returns no count.]{#break-even}
:::

The base call costs $0.00216 uncached, the tuned call costs $0.00112, and the base call with its block cached costs $0.00096. Against the uncached prompt, the $30 run breaks even after 28,847 requests. Against the cached prompt it never does, because the tuned call costs more than the cached one. We recommend comparing a tuned model with your prompt as it runs in production, cached, not with the prompt as it runs on the first request. This listing prices a model that already exists and starts no tuning job.

A tuned model also lives only as long as its base. OpenAI says fine-tuned versions "follow the same shutdown schedule as their underlying base models", and GPT-4.1 mini shuts down on 14 January 2027, 21 months after the date in its snapshot id [@openai-deprecations]. The tunable base models that retired in 2026, or retire by January 2027, lasted 16 to 30 months: Gemini 2.5 Flash 16, GPT-4.1 mini 21 and Claude 3 Haiku on Amazon Bedrock 30. Each count runs from the model's release or snapshot date [@google-model-versions; @bedrock-model-lifecycle]. Each retirement means a new training set for the new base, a new run and a rerun of the evals. The teams in [[paper:map-measuring-agents]] named this cost when they called tuning "brittle to model upgrades" [@map-measuring-agents].

A tuned model needs a safety check, because tuning can undo what the provider trained in. [[paper:qi-fine-tuning-safety]] broke GPT-3.5 Turbo's safety guardrails by tuning it on 10 adversarial examples for less than $0.20 through OpenAI's API, and found that tuning on harmless data also weakened safety, though less [@qi-fine-tuning-safety]. We conclude that a tuned model needs the same safety and regression evals as any new model, while a changed prompt leaves the provider's training in place.

The analogy breaks in two places. First, a tuned model still needs the brief. Tuning changes a model's defaults, not its need for instructions, so the tuned classifier still gets a system prompt, as the system prompt section describes. Second, the course expires with the base model. When the base retires, the employee must take the course again, this time on a new base, and the data and the evals are what survive to make that cheap.

### Deployed agents mostly prompt, and the vendors that train inside their own harness say so

[[paper:map-measuring-agents]] interviewed 20 teams that run agents in production, and 14 of them used off-the-shelf models with no supervised fine-tuning or reinforcement learning [@map-measuring-agents]. That is the abstract's 70%, but the figure is 14 of 20 interviewed teams, found by snowball sampling, so it is not a survey figure. Five teams used supervised fine-tuning: two for business-specific domain knowledge, three selectively, where training data was available and the cost trade-offs made sense. One team used a model trained with reinforcement learning. Among the four teams with a bounded-latency requirement, three tuned, which the authors call "an observation rather than a prevalence claim". One team tuned an open model for a high-volume workload "where inference costs are prohibitive". Latency, volume, domain knowledge and cost are the reasons teams gave.

The coding-agent vendors that train with reinforcement learning do it inside their own harness. Cursor trained its Composer model so that it can "call any tool in the Cursor Agent harness", on "hundreds of thousands of concurrent sandboxed coding environments" [@cursor-composer]. Cognition trained SWE-1.5 with reinforcement learning "using our custom Cascade agent harness", and says that "models tuned for the other harnesses could perform just as well if not better (e.g. Sonnet in Claude Code)" [@cognition-swe-1-5]. Both are vendor results on their own benchmarks, and both concede quality to the frontier: Cursor's footnote says GPT-5 and Sonnet 4.5 "both outperform Composer", and Cognition claims "near-SOTA coding performance". Cognition also describes the tie: its team "made adjustments to tools and prompts, and then re-trained the model on the updated harness". By our inference from that account, a harness whose components must stay removable would turn each such change into a retraining job.

:::box[Who sells tuning, as of November 2026]{#tuning-offers-november-2026}
OpenAI is closing its tuning platform. Organisations that had never tuned lost access on 7 May 2026, and on 6 January 2027 existing customers can no longer create new jobs. Tuned models keep serving until their base models retire, and GPT-4.1 and GPT-4.1 mini retire on 14 January 2027 [@openai-deprecations].

Anthropic lists no tuning page in its documentation index, so we take it that its own API offers no tuning. Claude 3 Haiku was tunable in Amazon Bedrock from 1 November 2024 [@anthropic-fine-tune-haiku]. The Claude API retired that model on 20 April 2026 [@anthropic-model-deprecations], and Bedrock's lifecycle page gives it an end-of-life date of 10 September 2026 in us-west-2 [@bedrock-model-lifecycle].

Of these three providers, only Google still tunes models, and only on its enterprise platform, not in the Gemini API. It offers supervised fine-tuning, preference tuning and reinforcement learning fine-tuning on the Gemini models its tuning page lists, from 3.8 Flash down to the 2.5 models that retire in 2026 [@google-tuning-intro; @gemini-api-model-tuning].

When a later edition updates this book, this box is the one place that changes.
:::

Our rule is to prompt, retrieve and measure first. Tune only when all four conditions hold. An eval of real cases shows a repeated failure of behaviour. Better prompts, examples and a smaller model have each fallen short. The volume repays the training against a cached prompt. The base model's retirement date is far enough away to recover the work. Keep the training set and the eval, because they are what survive the next retirement.

## Thinking comes back with a signature, and it goes back unchanged

:::listing[A response that thought first: a thinking block, with its signature, before the text]{#thinking-block}
```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me break this down. The question has two parts, so I'll start with the simpler one and use its result to constrain the second...",
      "signature": "WaUjzkypQ2mUEVM36O2Txu...."
    },
    {
      "type": "text",
      "text": "Based on my analysis..."
    }
  ]
}
```
:::

[[lst:thinking-block]] is the content of a Claude response from a model that reasoned before it answered, as Anthropic's thinking guide prints it. The text block at the bottom is the answer. Above it sits a thinking block with two fields. The first, `thinking`{checked=row-81}, holds a summary of the model's reasoning, never its raw chain of thought. The second, `signature`{checked=row-80}, is "an encrypted copy of the full reasoning that you pass back unchanged in multi-turn and tool-use conversations" [@anthropic-thinking]. On Claude 5 and later models, thinking is on by default and its text is hidden unless you ask for it, so a thinking block often arrives with an empty `thinking`{checked=row-81} field and a full `signature`{checked=row-80}. You are still billed for every token of the full reasoning, as the usage section showed.

A thinking block matters most in the middle of a tool call. When the model asks for a tool, it pauses the response it is building, and when your code returns the tool's result, the model carries on with that same response. Its earlier reasoning therefore has to come back with the result. Anthropic's rule is exact: "Pass every `thinking`{checked=row-81} block back to the API complete and unmodified, alongside the `tool_use`{checked=row-83} block it accompanied." Inside the latest assistant message you may not rearrange, edit or partly drop the thinking blocks, and the API rejects a modified block with a 400 error [@anthropic-thinking].

The signature also explains why the system prompt section asked you to freeze the front of the request. Each signature records a fingerprint of everything that came before its block: `system`, `tools` and every earlier message [@anthropic-prefix-checks]. Change any of them and the blocks after the change fail the prefix check. On Claude Opus, Sonnet and Haiku 5.5, as of November 2026, a failed check may return a 400 error, or it may return no error. In that second case the stale blocks reach the model anyway: "Claude reads them like any other input, you're billed for them, and Claude works from reasoning about content that has since changed." The same page reduces the defence to three habits:

1. "Send each assistant turn back exactly as the API returned it, including thinking blocks whose text is empty."
2. "Build `system` and `tools` once for each conversation, and send that copy every time."
3. "Put every update in a new message at the end, and leave it there."

Two lessons from earlier sections meet here. From streaming: a thinking block streams as a run of thinking deltas closed by one signature delta, and Anthropic advises using your SDK's message-accumulation helper "instead of concatenating deltas yourself" [@anthropic-thinking], so that the block, signature included, goes back exactly as the API returned it. From model choice: when you switch a conversation to another model, keep sending the whole history, thinking included. A block the new model cannot read "never causes an error"; the API drops it for that request and does not bill it. A move from Claude Sonnet 5.5 to Haiku 5.5, for example, loses Sonnet's reasoning for Haiku's turns, yet a later move back to Sonnet reads it again, because the API never changes your messages. Anthropic's advice is blunt: "don't remove thinking, and don't keep a separate history for each model" [@anthropic-preserved-thinking].

An SDK that keeps the session for you keeps these blocks for you too. The Copilot SDK's complete `"assistant.message"` event, for one, keeps the provider's reasoning in a `reasoningBlocks`{checked=row-118} field. The SDK's pinned type declarations, as of November 2026, describe those blocks as "preserved verbatim for round-tripping". The streaming-events page lists only the event's `reasoningOpaque`{checked=row-118} field, "Encrypted extended thinking (Anthropic models); session-bound" [@copilot-streaming-events]. The declarations call that field "a lossy derived view" of the blocks, "retained for display" and "stripped on resume". Code that builds its own requests, as this book's harness will, has to follow the three habits itself. The harness's plan adopts them as rules: send each assistant turn back exactly as returned, build `system` and `tools` once per session, and announce a mid-session tool change in a system message instead of editing `tools`. So the chapter ends where it began: your program tells the model what the model said a moment ago, and from now on that includes what it thought, word for word.

## Exercises

1. **Price a recorded run, then move it to a smaller model.** Copy `verify/vercel-ai-sdk/examples/10-streaming-usage.ts` to `verify/vercel-ai-sdk/examples/10-haiku-usage.ts`. In the copy, import the `Rates` type from `./lib/rates.ts`. Next, write Haiku's four rates from the Haiku 5.5 row of [[tbl:claude-rates]] as a `Rates` object in nano-dollars per token, as [[lst:sonnet-rates]] does for Sonnet. Before you run anything, price the recorded usage by hand: 1,000 uncached, 1,500 cache-read and 500 cache-write input tokens, and 200 output tokens. Then make three changes to the copy. Pass your Haiku rates to `costNanos` instead of `SONNET_5_5`, pass `modelId: "claude-haiku-5-5"` to `scripted`, and replace the check that the four classes cost 5,400,000 nano-dollars with a `check()` of your own answer. That old check states Sonnet's price, so it has to go: `check()` throws at the first check that fails, and a run that kept it would stop before reaching yours. Predict which of the file's other checks still pass, run `pnpm test` in `verify/vercel-ai-sdk`, and explain each result. What do the checks that pass tell you about whether Haiku would answer this question as well as Sonnet? To clean up, delete the copy and the transcript its run wrote, `verify/vercel-ai-sdk/results/transcripts/10-haiku-usage.json`, then restore the results the run rewrote with `git checkout -- verify/vercel-ai-sdk/results` from the repository root.
2. **Count the deltas.** In the `stream-parts` block of `verify/vercel-ai-sdk/examples/06-streaming.ts`, count the `"text-delta"` parts the loop sees. Predict the count for the scripted answer "Typed parts." from how the mock splits text, write the prediction as a check, and run the harness's tests. Then change the answer to one with five words and predict again. When you are done, restore the example and its results with `git checkout -- verify/vercel-ai-sdk` from the repository root.
3. **Find the change that breaks the thinking.** A conversation on Claude Sonnet 5.5 holds several turns with thinking blocks. Between two calls, your code makes one of these changes: it appends a user message that states today's date; it rewrites the system prompt to include today's date; it raises `max_tokens`{checked=row-96}; it removes a tool from `tools`; it fixes a typo in the user's first message. For each change, say whether the next request passes the prefix check, using the three habits and the prefix-check page's list of what counts as a change.
