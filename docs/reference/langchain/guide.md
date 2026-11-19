# Building agents with LangChain.js: a middleware-driven loop on a LangGraph graph

*Version `langchain@1.6.1` with `@langchain/core@1.3.4` and `@langchain/langgraph@1.6.0`, TypeScript, November 2026. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/langchain/examples/`](../../../verify/langchain/examples/), run offline on LangChain's own `fakeModel()`. Other claims cite their upstream page in [`source/src/oss/`](source/src/oss/), mirrored from `langchain-ai/docs` at commit `9d9747d` (2026-11-17); [fact-check.md](fact-check.md) rates those pages.*

LangChain 1.x rebuilt its agent around one function, `createAgent`, which compiles a small LangGraph graph: a model node, a tools node and the edges between them. Every customisation is middleware that hooks into that graph, and every durable feature, such as threads, interrupts and long-term memory, comes from LangGraph's checkpointer and store. The design gives LangChain the widest built-in feature set of the five SDKs in this repo, including summarisation, call limits, PII handling and human approval. Its docs serve Python and JavaScript from the same pages, and the JavaScript pages run ahead of the npm release in several places. In this guide, I explain how `createAgent`, middleware and the LangGraph runtime fit together, and I build a gated support-triage agent on them. That agent pins its model with a provider prefix, gates its risky tool with `humanInTheLoopMiddleware` and sets its own recursion limit.

## 1. `createAgent` compiles a two-node graph that middleware extends

`createAgent` from `langchain` returns a compiled LangGraph graph (`langchain/agents.mdx`). Its loop has two nodes, `model_request` and `tools`, and streaming with `streamMode: "updates"` shows them in order: model, tools, model. **[verified: 08]** The loop runs in your process:
1. The model node calls the model with the state's messages and the bound tools.
2. If the response has tool calls, the tools node runs them and appends `ToolMessage`s; otherwise the run ends.
3. LangGraph stops the run with `GraphRecursionError` once it reaches the recursion limit.

The contrast with the other references explains the design. The Vercel AI SDK keeps a thin loop and leaves state to you; LangChain instead puts the loop on a graph runtime, so threads, pauses and replays come from LangGraph. The package split follows the same line: `@langchain/core` holds messages, tools and model interfaces; provider packages such as `@langchain/anthropic` hold chat models; `@langchain/langgraph` holds the runtime; and `langchain` holds `createAgent`, the middleware and `fakeModel()`.

## 2. Install, then give every model id a provider prefix

```bash
npm install langchain @langchain/core @langchain/langgraph @langchain/anthropic zod
```

All five packages are MIT-licensed. A model can be an instance, such as `new ChatAnthropic({ model: "claude-sonnet-4-5" })`, or a string that `initChatModel` resolves, such as `"anthropic:claude-sonnet-4-5"` (`langchain/models.mdx`).

> **Gotcha.** Without a `provider:` prefix, `initChatModel` infers the provider from the name, and in 1.6.1 it knows only names starting with `gpt-3`, `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, `claude`, `gemini` and a few others (`chat_models/universal.js`). The docs' default model, `"gpt-6.1-sol"`, matches none of them, so the overview page's first example throws "Unable to infer model provider". The same rule holds in the newest release, 1.6.6. Thirteen of our doc runs failed this way, and 12 of them passed once prefixed (fact-check F1). Always write `"openai:gpt-…"` or `"anthropic:claude-…"`.

LangSmith tracing is opt-in: it starts only when you set `LANGSMITH_TRACING=true` and an API key (`langchain/overview.mdx`).

## 3. A run returns the thread's messages, and `systemPrompt` becomes the system message

```ts
import { createAgent } from "langchain";

const agent = createAgent({ model: "anthropic:claude-sonnet-4-5", tools: [], systemPrompt: "You are terse." });
const result = await agent.invoke({ messages: [{ role: "user", content: "Say hello." }] });
console.log(result.messages.at(-1)?.content);
```

`result.messages` holds the whole exchange, ending with the model's answer, and `systemPrompt` reaches the model as a system message. **[verified: 01]** A message's `content` is a string *or* an array of content blocks, so code that treats it as a string needs a check first; nine doc blocks skip that check and fail to type-check (fact-check F5).

## 4. Tools take Zod schemas, and the loop runs until the model stops calling them

```ts
import { tool } from "langchain";
import { z } from "zod";

const getWeather = tool(async ({ city, unit }) => `${city}: 21${unit}`, {
  name: "get_weather",
  description: "Get the weather for a city",
  schema: z.object({ city: z.string(), unit: z.enum(["C", "F"]).default("C") }),
});
```

The tool function receives the input after the schema parses it, defaults included, and its result returns to the model as a `ToolMessage` on the next call. **[verified: 02]** The loop keeps going until a response has no tool calls. **[verified: 02]** A tool's second argument is its runtime: it carries the agent's context, state and store (`langchain/tools.mdx`, `langchain/runtime.mdx`).

## 5. Middleware has six hooks, and `wrapToolCall` can replace a tool call

Custom middleware comes from `createMiddleware` with up to six hooks, and the docs and the package agree on all six (`langchain/middleware/custom.mdx`, fact-check Tier 3):
- `beforeAgent` and `afterAgent` run once per invocation.
- `beforeModel` and `afterModel` run around each model call.
- `wrapModelCall` and `wrapToolCall` wrap each call and decide whether to call `handler(request)`.

In example 07, the hooks ran in loop order: `beforeModel`, `wrapToolCall`, `beforeModel` again, then `afterAgent`. **[verified: 07]** A `wrapToolCall` that returns its own `ToolMessage` instead of calling the handler blocks the tool, and the model receives that message. **[verified: 07]** This is LangChain's closest equivalent of Pi's `tool_call` gate.

The package also exports 21 built-in middleware factories, from `summarizationMiddleware` and `modelCallLimitMiddleware` to `piiMiddleware` and `toolRetryMiddleware`. The built-in page documents 14 of them, plus `createFilesystemMiddleware` from the separate `deepagents` package. One it documents, `modelRefusalMiddleware`, arrived after 1.6.1 (fact-check F3).

## 6. Human approval interrupts the graph and resumes with a `Command`

`humanInTheLoopMiddleware` pauses the run before a gated tool executes (`langchain/human-in-the-loop.mdx`):

```ts
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgent, humanInTheLoopMiddleware } from "langchain";

const agent = createAgent({
  model, tools: [executeSql],
  middleware: [humanInTheLoopMiddleware({ interruptOn: { execute_sql: { allowedDecisions: ["approve", "reject"] } } })],
  checkpointer: new MemorySaver(),                       // interrupts need a checkpointer
});
const config = { configurable: { thread_id: "t1" } };    // …and a thread
const first = await agent.invoke({ messages: [{ role: "user", content: "Delete old records" }] }, config);
// first.__interrupt__[0].value.actionRequests[0].name === "execute_sql"
await agent.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config);
```

The first call returns with `__interrupt__` holding the action request, and the tool hasn't run. **[verified: 03]** Resuming the same thread with `approve` runs the tool exactly once; `reject` skips it, and the model receives a tool message about the rejection. **[verified: 03]** The decisions are `approve`, `edit`, `reject` and `respond`. The pause lives in the checkpointer, so a person can decide later from another process, provided the checkpointer is durable. Two typing gaps remain: the typed result has no `__interrupt__` field, and the guardrails page still uses the old `allowAccept`-style flags (fact-check F6).

## 7. `responseFormat` returns a typed `structuredResponse`

```ts
const Triage = z.object({ category: z.enum(["bug", "billing", "question"]), urgent: z.boolean() }).meta({ title: "Triage" });
const result = await createAgent({ model, tools: [], responseFormat: Triage }).invoke({ messages });
result.structuredResponse;   // { category, urgent }, typed
```

A plain schema uses the provider's native JSON mode when the model's profile says it supports structured output; otherwise `createAgent` offers the schema as a tool named after its title (`agents/responses.js`). **[verified: 04]** Wrap the schema in `providerStrategy()` or `toolStrategy()` to choose explicitly (`langchain/structured-output.mdx`). In example 04, the structured-output tool call ended the run after one model call. **[verified: 04]**

## 8. Threads need a checkpointer and a `thread_id`; long-term memory needs a store

A checkpointer, such as `MemorySaver`, keeps each thread's state between invocations that pass the same `configurable.thread_id`. A new thread id starts empty. **[verified: 05]** Once an agent has a checkpointer, every invocation must pass a `thread_id`, or LangGraph throws "missing a required thread_id". **[verified: 05]** One short-term-memory example omits it and fails (fact-check F2).

Long-term memory uses a store passed to `createAgent`. Tools reach it as `runtime.store`, and at run time it is LangGraph's store with `get()` and `put()`. **[verified: 09]**

> **Gotcha.** `ToolRuntime` from `@langchain/core/tools` declares `store` as core's key-value `BaseStore`, which has `mget()` and `mset()` but no `get()` or `put()`. The docs call `runtime.store.get(...)` and `put(...)` in 31 blocks, which therefore fail to type-check, although they work at run time. Cast to LangGraph's store type, as example 09 does (fact-check F4).

## 9. The recursion limit counts graph steps, not model calls

LangGraph stops a run after 25 super-steps by default and throws `GraphRecursionError` (`langgraph/graph-api.mdx`). **[verified: 06]** Each model call and each tools step counts as a super-step, so the default allowed 13 model calls in our test, and `recursionLimit: 5` allowed 3. **[verified: 06]** Pass `recursionLimit` at the top level of the invocation config, not under `configurable`. For limits that read naturally in model calls, use `modelCallLimitMiddleware` or `toolCallLimitMiddleware` instead.

## 10. Streaming offers graph-level modes

`agent.stream(input, { streamMode })` yields graph events (`langchain/streaming.mdx`). `"updates"` yields one chunk per step, keyed by node name, and `"values"` yields the full state after each step. **[verified: 08]** `"messages"` streams model tokens with metadata, and `"custom"` carries events that tools write.

## 11. MCP, multi-agent patterns and Deep Agents sit beside the core

Three features come from other packages or patterns (`langchain/mcp/index.mdx`, `langchain/multi-agent/index.mdx`):
- **MCP.** `@langchain/mcp-adapters` turns MCP servers' tools into LangChain tools; it is outside our pinned set, so its examples were skipped.
- **Multi-agent.** The docs describe subagents (an agent wrapped as a tool), handoffs, routers and skills, each built from tools and middleware.
- **Deep Agents.** `create_deep_agent` pre-assembles filesystem, summarisation, subagent and prompt-caching middleware into a coding-style harness (`langchain/agents.mdx`).

## 12. `fakeModel()` makes agents testable offline

`langchain` exports `fakeModel()`, a scripted chat model (`langchain/test/unit-testing.mdx`):

```ts
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "langchain";

const model = fakeModel()
  .respondWithTools([{ name: "get_weather", args: { city: "Lisbon" }, id: "call_1" }])
  .respond(new AIMessage("It is 21C in Lisbon."));
// model.calls[i].messages and model.callCount record every request
```

Each call takes the next queued response, and an unscripted call throws "no response queued". `alwaysThrow(error)` tests error handling, and `structuredResponse(value)` serves `withStructuredOutput`. All ten of our examples run on it with no API key. **[verified: 01–10]** Core's older `FakeStreamingChatModel` can't drive a tool loop, because it always replays its first response and drops its tool calls (`@langchain/core/utils/testing`).

## 13. Production agents need four decisions made up front

- **Models.** Use instances or `provider:model` strings, never a bare id the SDK must guess.
- **Durability.** Use a persistent checkpointer, such as Postgres or MongoDB, for any agent that interrupts, and pass a `thread_id` on every call.
- **Gates.** Put `humanInTheLoopMiddleware` on every state-changing tool, or block calls in `wrapToolCall`.
- **Limits.** Set `recursionLimit`, or a call-limit middleware, explicitly.

## 14. A gated triage agent takes five settings

The capstone [`10-triage-agent.ts`](../../../verify/langchain/examples/10-triage-agent.ts) builds the same support-triage agent as the other references:
1. **Tools.** `lookup_customer` reads data, and `escalate` changes state.
2. **`humanInTheLoopMiddleware`** interrupts before `escalate`; a person rejects it on resume, and it never runs. **[verified: 10]**
3. **A custom middleware** audits every tool call through `wrapToolCall`. **[verified: 10]**
4. **`responseFormat`** returns a typed triage record after the resume. **[verified: 10]**
5. **A checkpointer, a `thread_id` and `recursionLimit: 12`** make the pause possible and bound the run.

```bash
pnpm install && pnpm --filter @buildanagent/verify-langchain test
```

## 15. Ten runnable examples back every [verified] claim

| File | Demonstrates |
|---|---|
| `01-hello-agent.ts` | `createAgent`, `systemPrompt`, `fakeModel()` |
| `02-tool-loop.ts` | `tool()` with Zod, `ToolMessage` results, loop termination |
| `03-human-in-the-loop.ts` | `humanInTheLoopMiddleware`, `__interrupt__`, `Command` resume with approve and reject |
| `04-structured-output.ts` | `responseFormat` and `structuredResponse` |
| `05-thread-memory.ts` | `MemorySaver`, `thread_id`, the missing-thread error |
| `06-recursion-limit.ts` | The 25-step default, `GraphRecursionError`, `recursionLimit` |
| `07-middleware.ts` | `createMiddleware`, hook order, blocking in `wrapToolCall` |
| `08-streaming.ts` | `streamMode` `"updates"` and `"values"` |
| `09-long-term-store.ts` | `runtime.store` as LangGraph's store, and the type mismatch |
| `10-triage-agent.ts` | The capstone, combining all of the above |

## Conclusion: pin the model, the thread and the limit, and the middleware does the rest

LangChain suits teams that want the most features ready-made: approvals, summarisation, limits and guardrails as middleware, and threads and interrupts from LangGraph. Its JavaScript docs are its weak point. They share pages with Python, they run ahead of the npm release, and 78 of 713 blocks disagree with the 1.6.1 types, most often over the long-term store and message content. Behavior matched the docs in every test we ran, though. To build on it, give every model id a provider prefix, pass a `thread_id` with a durable checkpointer, and set the recursion limit yourself. Then copy [`10-triage-agent.ts`](../../../verify/langchain/examples/10-triage-agent.ts), swap in your tools, and run `pnpm --filter @buildanagent/verify-langchain test` to confirm the gate still holds.
