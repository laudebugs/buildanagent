---
name: langchain
description: Use when writing, reviewing or testing TypeScript that imports `langchain`, `@langchain/core` or `@langchain/langgraph` for agents (createAgent, tool, createMiddleware, humanInTheLoopMiddleware, Command resume, responseFormat, MemorySaver, thread_id, recursionLimit, runtime.store, fakeModel). Gives the verified 1.x setup, the interrupt-and-resume flow, the gotchas from our fact-check, and how to test offline with fakeModel().
---

# LangChain.js (`langchain@1.6.6`, `@langchain/core@1.4.1`, `@langchain/langgraph@1.7.4`)

`createAgent` compiles a two-node LangGraph graph (`model_request` → `tools`) in your process. Every feature beyond the loop is middleware; threads, interrupts and memory come from LangGraph's checkpointer and store. Full reference: [`docs/reference/langchain/guide.md`](../../../docs/reference/langchain/guide.md); verified examples: [`verify/langchain/examples/`](../../../verify/langchain/examples/).

## When to use it

Choose it for the most ready-made middleware (approval, summarisation, call limits, PII) and durable threads with interrupts. Choose the Vercel AI SDK for the thinnest loop, and the OpenAI Agents SDK for guardrails and handoffs ([comparison](../../../docs/comparison/deep-comparison.md)).

## Minimal setup

```bash
pnpm add langchain @langchain/core @langchain/langgraph @langchain/anthropic zod   # in this repo: pnpm only, exact pins
```

```ts
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgent, humanInTheLoopMiddleware, tool } from "langchain";
import { z } from "zod";

const lookupCustomer = tool(async ({ email }) => JSON.stringify({ email, plan: "pro" }), {
  name: "lookup_customer", description: "Look up a customer by email", schema: z.object({ email: z.string() }),
});
const escalate = tool(async () => "escalated", {
  name: "escalate", description: "Escalate to on-call", schema: z.object({ reason: z.string() }),
});
const Triage = z
  .object({ category: z.enum(["bug", "billing", "question"]), summary: z.string() })
  .meta({ title: "Triage" });                         // the title names the structured-output tool

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",               // always "provider:model"
  tools: [lookupCustomer, escalate],
  systemPrompt: "Look up the customer, escalate a checkout failure to on-call once, then classify it either way.",
  middleware: [humanInTheLoopMiddleware({ interruptOn: { escalate: { allowedDecisions: ["approve", "reject"] } } })],
  responseFormat: Triage,
  checkpointer: new MemorySaver(),                    // interrupts need a checkpointer…
});
const config = { configurable: { thread_id: "ticket-42" }, recursionLimit: 12 };   // …and a thread_id

const first: any = await agent.invoke({ messages: [{ role: "user", content: "Checkout fails for user@example.com" }] }, config);
if (first.__interrupt__) {
  const done = await agent.invoke(new Command({ resume: { decisions: [{ type: "reject" }] } }), config);
  console.log(done.structuredResponse);
}
```

## Patterns that hold (verified)

- **`result.messages`** holds the thread, ending with the model's answer; `systemPrompt` becomes the system message.
- **`tool(fn, { name, description, schema })`** gets Zod-parsed input (defaults applied); the result returns as a `ToolMessage`. The second argument of `fn` is the runtime.
- **Six middleware hooks** via `createMiddleware({ name, … })`: `beforeAgent`, `beforeModel`, `afterModel`, `afterAgent`, `wrapModelCall`, `wrapToolCall`. Hooks run in loop order. A `wrapToolCall` that returns its own `new ToolMessage({ content, tool_call_id: request.toolCall.id })` instead of `handler(request)` blocks the tool.
- **Human approval:** `humanInTheLoopMiddleware` returns `result.__interrupt__[0].value.actionRequests` before the tool runs. Resume the same thread with `new Command({ resume: { decisions: [{ type: "approve" | "reject" | "edit" | "respond" }] } })`. Approve runs the tool once; reject never runs it and the model gets a tool message.
- **`responseFormat`** yields a typed `result.structuredResponse`. With a model whose profile supports native structured output it uses JSON mode; otherwise the schema becomes a tool named after its title.
- **Threads:** a checkpointer keeps history per `configurable.thread_id`; a new id starts empty.
- **Recursion limit:** 25 graph super-steps by default (≈13 model calls with tools), then `GraphRecursionError`. Set `recursionLimit` at the top level of the config, not in `configurable`.
- **Streaming:** `agent.stream(input, { streamMode: "updates" })` yields `{ model_request }`, `{ tools }`, …; `"values"` yields full states.

## Gotchas (from the fact-check)

- **Bare model ids must match a known prefix** (`gpt-3/4/5`, `o1/o3/o4`, `claude`, `gemini`, …). The docs' `"gpt-6.1-sol"` throws "Unable to infer model provider". Always write `"openai:…"` or `"anthropic:…"`.
- **A checkpointed agent throws without a `thread_id`.** Pass one on every call.
- **`runtime.store` is LangGraph's store at run time** (`get`, `put`), but `ToolRuntime` from `@langchain/core/tools` types it as core's `BaseStore` (`mget`/`mset`). Cast it: `runtime.store as unknown as InMemoryStore`.
- **`message.content` is `string | ContentBlock[]`.** Narrow it before string use; read `tool_calls` only from an `AIMessage`.
- **`result.__interrupt__` is missing from the typed result.** Read it through `any` or a cast.
- **`initChatModel()` returns a Promise.** Await it.
- **The JS docs can run ahead of your release.** `modelRefusalMiddleware` and `ModelRefusalError` were missing in 1.6.1 and first ship in 1.6.4 (1.6.6 has them). `runtime.executionInfo` exists at run time in 1.6.6 but not on the `ToolRuntime` type that a tool's second argument has, so cast. `runtime.serverInfo` is `undefined` outside the Agent Server (locally), so check it before you read a field from it. Compile copied examples against your pinned version.
- **Old approval flags** (`allowAccept`, `allowEdit`) are gone; use `allowedDecisions`.
- **A call rejected by `humanInTheLoopMiddleware` never reaches `wrapToolCall`**, so an audit built on `wrapToolCall` misses it. Audit requested calls in `afterModel` (from the model's `tool_calls`) if you need them all. The rejection reaches the model as a `ToolMessage` named after the tool.

## Test offline

Use `fakeModel()` from `langchain`, passed straight in as `createAgent({ model: fakeModel()… })`: `.respond(new AIMessage("…"))` queues a text turn, `.respondWithTools([{ name, args, id }])` queues a tool-call turn, `.alwaysThrow(err)` tests errors, and `model.calls[i].messages` / `model.callCount` record requests. Each call takes the next queued turn, and an unscripted call throws "no response queued". For `responseFormat`, `fakeModel()` takes the tool path, so script the final turn as `respondWithTools([{ name: "<schema title>", args: {…}, id: "c3" }])` (pass an `id` on every tool call). Don't use core's `FakeStreamingChatModel` for agents: it replays its first response and drops tool calls. `check()`, `kind()` and `text()` helpers live in [`verify/langchain/examples/lib/check.ts`](../../../verify/langchain/examples/lib/check.ts) (import with the `.ts` extension).

Run one new file offline, without touching committed results, from `verify/langchain`: `node scripts/run-examples.mjs <dir> --only <name>` (it prints only the outcome and runs through tsx without type-checking; run the file with tsx to see its output, and type-check it yourself, since `pnpm test` covers only `examples/`). Run the verified examples with:

```bash
pnpm --filter @buildanagent/verify-langchain test
```
