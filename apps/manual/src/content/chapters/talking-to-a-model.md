---
title: "Talking to a model: messages, streams, tokens, instructions and model choice"
summary: A model call sends the whole conversation and gets back one message, often as a stream of pieces, with a bill in four token classes. This chapter reads each part of that exchange, then shows what belongs in the system prompt, how to choose a model, and why thinking goes back to the model untouched.
opening: code
sources: [anthropic-working-with-messages, ai-sdk-prompts, anthropic-how-tool-use-works]
glossary: []
switchTo: [B4, B5]
---

:::listing[The second request of a conversation, as Anthropic's Messages API takes it]{#second-turn}
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

Read the middle message of [[lst:second-turn]]. Your program is telling the model what the model said a moment ago. "Hello!" came back from the first request, and here it goes out again with the role `assistant`, between the user's two turns, because nothing on the other side kept it. Anthropic's documentation puts the rule in one line: the Messages API "is stateless, which means that you always send the full conversational history to the API" [@anthropic-working-with-messages]. The same page adds that earlier turns need not come from Claude at all, since your code may write "synthetic `assistant` messages" of its own.

That small request holds most of this chapter. You send a list of messages, each with a role, and one message comes back, often as a stream of pieces. Every token in both directions lands on a bill, and the instructions at the top of the list are paid for on every call, so they should be short and stay the same. The model that reads them is a choice you can test, and when that model thinks before it answers, its thinking comes back too and must go out again untouched. By the end of the chapter you can read any model exchange in this book's replays, price it from its usage, and say what belongs in its system prompt.

## A call sends the whole conversation, and every message has a role

Picture :analogy[a pharmacist who sees only the prescription slip in front of them]{#pharmacist-slip}. Whatever your doctor said last week, and whatever you told this counter yesterday, the pharmacist works from the slip you hand over now. If yesterday matters, it has to be written on today's slip. A model call works the same way: the request is the slip, and the model knows only what that request carries.

Each request is a list of messages, and each message has a role that says who is speaking. The AI SDK, whose listings this chapter uses most, types four roles. A `system` message holds the builder's instructions, a `user` message holds what a person asked, an `assistant` message holds an answer the model gave, and a `tool` message carries the result of a tool the model asked for, which [[ch:tools]] covers. Providers spell the roles their own way on the wire. Anthropic's API, for instance, takes the system prompt in its own `system` field beside the messages [@anthropic-working-with-messages], and it expects tool results back inside a `user` message [@anthropic-how-tool-use-works]. The SDK translates for you.

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

Step through the replay and you can see the refusal happen before the network. The file's first call, from line 10, sends its request and gets its answer. The next event is the check on line 39 that the error was thrown, with no request in between, so the refused call never reached the mock. Only the call with the opt-in goes out, carrying a system message and a user message, and it comes back with "A joke." The AI SDK's documentation explains the default: opting in "can create a prompt injection risk where users can override or set the system prompt by injecting system messages", so "only trusted server-side code should set system instructions via the `instructions`{checked=row-11} property" [@ai-sdk-prompts]. We recommend the same rule when you store conversations: your code writes the system prompt, and nothing a user typed should go back to the model under that role.

The pharmacist's slip has a size limit that a request does not. A request can carry a whole conversation, every tool result and a long system prompt, and the model reads all of it. Every word of it is also billed, on every call, and the section after next counts that bill.

## Exercises

1. Exercises follow once every section is drafted.
