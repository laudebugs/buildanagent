# Building agents with Cloudflare Agents: each agent is a Durable Object, and the AI SDK runs its loop

*Version `agents@0.33.0` with `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2`, on `ai@7.0.162`, TypeScript, November 2026. **[verified: NN]** marks a claim asserted by example `NN` in [`verify/cloudflare-agents/examples/`](../../../verify/cloudflare-agents/examples/), run offline in Cloudflare's local runtime (workerd, through Miniflare) on `MockLanguageModelV4` from `ai/test`. Other claims cite their upstream page in [`source/`](source/): `agents/…` and `think/…` paths sit under `source/agents/docs/` (the `cloudflare/agents` repo at tag `agents@0.33.0`, with Think at `@cloudflare/think@0.23.0`), and `cf/…` paths sit under `source/cloudflare-docs/src/content/docs/agents/` (`developers.cloudflare.com/agents/` at commit `6897a9f`). [fact-check.md](fact-check.md) rates those pages.*

The other five SDKs in this repo give you a loop that runs inside your process. Cloudflare Agents gives you a server instead: every agent is a Durable Object, a named, single-threaded instance with its own SQLite database, WebSockets and alarms, which Cloudflare starts on demand and puts to sleep when idle. The SDK builds on that layer: state that syncs to clients, SQL, scheduling, routing, MCP and hibernation. The model loop comes from the Vercel AI SDK. `AIChatAgent` hands you `streamText` to call yourself, and Think, its opinionated sibling, calls it for you. Two defaults reach further than a reader expects: agents send their instance name to each WebSocket client that connects, and Think offers the model `write`, `edit` and `delete` tools on its workspace in every turn. In this guide, I explain how the Agent class, its two chat subclasses and its MCP pieces fit together on Durable Objects. I then build a gated support-triage agent on Think, whose escalation tool waits for a person's approval.

## 1. An Agent is a Durable Object, so identity, storage and concurrency come from the platform

`Agent` extends Cloudflare's `DurableObject` class, "so every Agent is a globally addressable, single-threaded compute instance with durable KV/SQLite storage" (`agents/agent-class.md`). The name you address it by is its identity. One name always reaches the same instance, which owns its database alone, and the runtime constructs the instance whenever a call needs it (`agents/agent-class.md`, "RPC"; `agents/routing.md`). Public methods become RPC methods on the stub that `getAgentByName(env.MyAgent, "user-123")` returns. **[verified: 01–09]** The contrast with the other references explains the design. In the Vercel AI SDK, you keep `messages` yourself between calls, while a Cloudflare agent's memory, sessions and pending approvals live in its own SQLite rows and survive eviction.

The SDK ships as three packages, all MIT-licensed:
- **`agents`** holds `Agent`, routing, scheduling, the MCP client and server, workflows and the client SDK (`agents/index.md`).
- **`@cloudflare/ai-chat`** holds `AIChatAgent`, a chat-protocol adapter on the AI SDK (`agents/chat-agents.md`).
- **`@cloudflare/think`** holds `Think`, an experimental chat agent that runs the loop itself (`think/index.md`).

## 2. Install, then bind each Agent class as a SQLite-backed Durable Object

```bash
npm install agents @cloudflare/think ai zod
```

Each Agent class needs a Durable Object binding and a `new_sqlite_classes` migration in `wrangler.jsonc`, and the Worker entry must export the class (`think/index.md`, "Wrangler configuration"):

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": { "bindings": [{ "class_name": "MyAgent", "name": "MyAgent" }] },
  "migrations": [{ "new_sqlite_classes": ["MyAgent"], "tag": "v1" }]
}
```

Think declares `ai` 7 and `@cloudflare/computer` as peer dependencies, and it bundles `workers-ai-provider` so that `getModel()` can return a Workers AI model id as a string (`think/index.md`, "Dependencies"; `think/getting-started.md`). npm marks `workers-ai-provider@4.0.1` deprecated in favor of `createAI` from `agents/models/ai-sdk` (fact-check F18).

## 3. `setState` persists and broadcasts, and the first read of `initialState` fires `onStateChanged`

```ts
import { Agent } from "agents";

export class CounterAgent extends Agent<Env, { count: number }> {
  initialState = { count: 0 };
  increment() {
    this.setState({ count: this.state.count + 1 });
  }
  onStateChanged(state: { count: number } | undefined, source: unknown) {
    // runs after each update; source is "server" here
  }
}
```

`setState()` saves to SQLite, broadcasts to connected clients and then calls `onStateChanged()` (`agents/state.md`, "Updating State"). Each server-side `setState` fires the hook once with source `"server"`, and a WebSocket client first receives the current state, then every update. **[verified: 01]** The deprecated `onStateUpdate` still fires, with a console warning. **[verified: 01]**

> **Gotcha.** On a new agent, the first read of `this.state` persists `initialState`, and that write fires `onStateChanged(initialState, "server")` once, before any update. **[verified: 01]** The docs say only that `initialState` "is used and persisted" (`agents/state.md`, "When Initial State Applies"). A hook that sends email or webhooks therefore fires once per new agent with nothing changed, so write such hooks to tolerate one notification that carries the initial state (fact-check F2).

## 4. `this.sql` is a parameterized template tag over the agent's own database

```ts
this.sql`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`;
this.sql`INSERT INTO notes (body) VALUES (${body})`;
const rows = this.sql<{ id: number; body: string }>`SELECT id, body FROM notes WHERE body LIKE ${`%${term}%`}`;
```

`this.sql` wraps the Durable Object's synchronous SQLite API (`agents/agent-class.md`, "`this.sql`"). Interpolated values become bound parameters, so a string such as `x'); DROP TABLE notes; --` round-trips as data. **[verified: 02]** Rows come back as typed objects, and `this.ctx.storage.sql` sees the same rows. **[verified: 02]** The SDK keeps its own tables, such as `cf_agents_state` and `cf_agents_mcp_servers`, in the same database, so prefix your table names to avoid clashes. **[verified: 02]**

## 5. `routeAgentRequest` maps URLs to instances and resolves to `null` for everything else

`routeAgentRequest(request, env)` routes `/agents/<class-in-kebab-case>/<instance-name>` to that instance, for HTTP and WebSocket alike (`agents/routing.md`, "How Routing Works"). **[verified: 01]** For any other path it resolves to `null`, so the fallback must await it first:

```ts
export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

The Think page writes it this way (`think/index.md`, "Server"). The Agent class page on developers.cloudflare.com drops the `await` (`cf/agent-class/index.mdx`). A Promise is always truthy, so that handler returns `null` for a non-agent path and never reaches its 404. **[verified: 01]** (fact-check F6)

## 6. Scheduling runs callbacks on Durable Object alarms

`this.schedule(when, "method", payload)` runs a method of the agent later, and `when` decides the type (`agents/scheduling.md`, "Scheduling Modes"):
- A number of seconds gives a `delayed` task, and a `Date` gives a `scheduled` one. **[verified: 03]**
- A cron string gives a `cron` task. **[verified: 03]**
- `scheduleEvery(seconds, "method")` gives an `interval` task. Calling it again with the same callback, interval and payload returns the existing schedule. **[verified: 03]**

The callback ran with its payload through a Durable Object alarm in workerd, at or after the due time, and the one-shot row was then removed. **[verified: 03]** `listSchedules()` lists pending tasks, and `cancelSchedule(id)` returns `true`, or `false` for an unknown id. **[verified: 03]** Tasks live in a SQLite table and alarms wake the agent, so a schedule outlasts eviction (`agents/scheduling.md`, "Overview"). A failing callback retries three times by default, and the `retry` option changes that (`agents/scheduling.md`, "Retry on Failure"; `retry` in the package's default static options).

## 7. Hibernation drops memory but keeps state, SQL rows and WebSockets

"Agent WebSockets always use Cloudflare's Hibernation API", so an idle agent leaves memory while its clients stay connected (`agents/http-websockets.md`, "Hibernation"). Example 08 evicts an agent with a client attached and shows what survives. **[verified: 08]**
- **Reset.** A new instance starts, `onStart` runs again, and in-memory class fields reset.
- **Kept.** `this.state` and SQL rows reload from SQLite.
- **Still connected.** The WebSocket stays open and is still listed by `getConnections()`, and its `connection.state` survives.
- **Woken by the client.** The client's next message wakes the agent, and `onMessage` runs on the new instance.

Keep anything that must last in `this.state`, SQL or `connection.state`, never in class fields. Two pages document a `hibernate: false` option that 0.33.0 lacks, so it can't keep an agent in memory (fact-check F10).

## 8. `AIChatAgent` and Think both run the Vercel AI SDK loop, and they differ in who calls it

Both classes extend `Agent`, speak the same `cf_agent_chat_*` WebSocket protocol and persist the conversation in SQLite (`think/index.md`, "Think vs AIChatAgent"). They differ in ownership:
- **`AIChatAgent`** is a protocol adapter. You override `onChatMessage`, call `streamText` with `this.messages`, and return its `toUIMessageStreamResponse()`.
- **Think** runs the loop itself. You override `getModel()`, `getSystemPrompt()` and `getTools()`, and you steer turns with hooks such as `beforeTurn`, `beforeStep` and `beforeToolCall`.

```ts
export class SupportChat extends AIChatAgent<Env> {
  async onChatMessage() {
    const result = streamText({
      model, system: "You are a support agent.",
      messages: await convertToModelMessages(this.messages),
      tools: { lookupOrder }, stopWhen: stepCountIs(5),
    });
    return result.toUIMessageStreamResponse();
  }
}
```

`saveMessages()` starts a turn without a client. In example 04, it ran a full AI SDK tool loop: the server tool executed once and the model was called again with its result. **[verified: 04]** The user message, the tool part with its output and the final text persisted in `this.messages`, and a new stub to the same name sees them. **[verified: 04]** Because both classes sit on `streamText`, AI SDK knowledge transfers directly. Our [Vercel AI SDK guide](../vercel-ai-sdk/guide.md) covers `stopWhen`, structured output and the mock model.

On Think, `getSystemPrompt()` reaches the model as the system message, `getTools()` adds your tools, and `runTurn({ input })` waits for the turn and returns the persisted assistant message. **[verified: 05]** A `beforeToolCall` hook that returns `{ action: "block", reason }` skips the tool's `execute`, and the model receives the reason as the tool's output. **[verified: 05]** A `beforeTurn` hook that returns `output: Output.object({ schema })` with `activeTools: []` asks the model for JSON with no tools, and `TurnResult.output` holds the parsed object. **[verified: 05]**

> **Gotcha.** `RunTurnWait` accepts a `body`, but for a new turn `runTurn({ input, body })` never passes it to `beforeTurn`'s `ctx.body`; only the `continuation: true` path forwards it (`think.js`). **[verified: 05]** The lifecycle page gates structured output on "a body flag set by the caller" (`think/lifecycle-hooks.md`), and that gate never fires for a programmatic turn. Gate on an instance field instead, as examples 05 and 09 do (fact-check F1).

> **Gotcha.** Think adds workspace tools "on every turn with no configuration" (`think/tools.md`). With two tools from `getTools()`, the model in example 05 was offered nine: `read`, `ls`, `find`, `grep`, `write`, `edit` and `delete`, plus our two. **[verified: 05]** The tools act on the agent's SQLite-backed virtual `/workspace`, not on the host, but they still let the model change files without any gate you wrote. Restrict them with `activeTools` in `beforeTurn`, or block them in `beforeToolCall` (fact-check F4).

## 9. Tool approval reuses the AI SDK's `needsApproval`, and the client answers over the chat protocol

A tool with `needsApproval` pauses the turn before it runs (`agents/human-in-the-loop.md`, "AI Tool Approval with needsApproval"):

```ts
refund: tool({
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  needsApproval: async ({ amount }) => amount > 100,
  execute: async ({ orderId, amount }) => issueRefund(orderId, amount),
}),
```

The turn ends with the call persisted in state `approval-requested`, and the tool has not run. **[verified: 06]** A client answers with `addToolApprovalResponse` from `useAgentChat`, which sends a `cf_agent_tool_approval` frame over the WebSocket. With `approved: true`, the part moves to `output-available`, the tool runs exactly once, and `autoContinue` calls the model again. **[verified: 06]** With `approved: false`, the part moves to `output-denied` and the tool never runs. **[verified: 06]** The pause lives in SQLite, so the answer can arrive on a later connection, as it does in the example. The same flow works on Think (`think/tools.md`). **[verified: 09]**

In ai 7, `needsApproval` on `tool()` is marked `@deprecated` in favor of call-level `toolApproval` (our [Vercel AI SDK guide](../vercel-ai-sdk/guide.md), section 7). The Cloudflare docs still teach it, and it still works in 0.33.0 (fact-check F16).

## 10. Serve MCP with `createMcpHandler`, and connect to it with `addMcpServer`

The server side changed in this release. `McpAgent` "is deprecated, but existing servers keep working", and new servers use `createMcpHandler` from `agents/mcp/server` with an MCP SDK v2 `McpServer` (`agents/mcp-servers.md`). The handler is stateless and builds a fresh server per request from your factory:

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "orders", version: "1.0.0" });
  server.registerTool("lookupOrder", { inputSchema: z.object({ orderId: z.string() }) }, async ({ orderId }) => ({
    content: [{ type: "text", text: `Order ${orderId}: shipped` }],
  }));
  return server;
});
```

The handler answered an MCP `initialize` with 200. **[verified: 07]** On the client side, an agent calls `this.addMcpServer("orders", url)`, and the connection persists in its SQLite (`agents/mcp-client.md`). In example 07, it reached the state `ready`, `this.mcp.listTools()` returned the server's tool with the server's id, and `this.mcp.callTool()` ran it. **[verified: 07]** `this.mcp.getAITools()` converts the tools into AI SDK tools with namespaced names such as `tool_qYqSDmpU_lookupOrder`, ready for `streamText`. **[verified: 07]** Loopback URLs are allowed for development (`agents/mcp-client.md`, "URL Security"), which is how the example runs offline. The docs still teach `McpAgent` on several pages (fact-check F17).

## 11. Workflows add durable multi-step runs, but we did not verify them offline

For work that spans many steps or waits days for a person, an agent can start a Cloudflare Workflow. A class that extends `AgentWorkflow` gets typed access back to its agent, and `waitForApproval()` pauses until someone approves (`agents/workflows.md`, `agents/human-in-the-loop.md`, "Workflow-Based Approval"). Import these names from `agents/workflows`, as the workflows page does. The human-in-the-loop page and the package README import them from `agents`, which exports none of them (fact-check F7).

Our harness configures no Workflows binding, so none of this section is verified, and two doc blocks were skipped. Miniflare has a `workflows` option, so a later harness can cover it.

## 12. Tests run in workerd with a mock model

An Agent needs the Workers runtime, so a Node test can't construct one. The docs recommend Vitest with `@cloudflare/vitest-plugin`, which runs tests inside workerd (`cf/getting-started/testing-your-agent.mdx`). Our harness uses Miniflare directly, but the idea is the same:
- **Runtime.** esbuild bundles each example into a Worker, and Miniflare starts it with one SQLite-backed Durable Object binding per Agent class.
- **Model.** `MockLanguageModelV4` from `ai/test` plays scripted turns. Both chat classes call the AI SDK, so the mock sits below their real loops (`examples/lib/check.ts`). **[verified: 04–06, 09]**
- **Eviction.** Miniflare's `unsafeEvictDurableObject` evicts an agent with its WebSockets hibernated, which is how example 08 tests hibernation. **[verified: 08]**
- **Network.** Every outbound `fetch` goes to a handler that serves `localhost` and refuses every other host. **[verified: 07]**

> **Gotcha.** A stub from `getAgentByName()` types each method's result through `@cloudflare/workers-types`' RPC serialization types. A result that contains `unknown`, such as `UIMessage[]` or `TurnResult.output`, becomes `never`. A deeply nested one, such as an AI SDK prompt message, fails with TS2589, "Type instantiation is excessively deep". TypeScript 5.9.3 and 7.0.2 agree, and plain `Agent` subclasses are affected too. Chat agents hit it most, because their messages are `UIMessage`s, so the examples type such stubs by hand with `rpc<T>()` (fact-check F5).

## 13. Production agents need five decisions made up front

- **Identity.** `sendIdentityOnConnect` defaults to `true`, so the instance name, often a user id, goes to each WebSocket client that connects (`agents/routing.md`, "`Agent.options`"). Set `static options = { sendIdentityOnConnect: false }` when the name is sensitive. The SDK warns once per class only when the URL path hides the name, and with identity off, `addMcpServer` then needs an explicit `callbackPath` (fact-check F3).
- **Think's tools.** Decide which workspace tools the model may use, and limit them with `activeTools` or `beforeToolCall` (section 8).
- **Gates.** Put `needsApproval` on every state-changing tool, and expect to move to the AI SDK's call-level `toolApproval` when the SDK does (section 9).
- **Routing.** Await `routeAgentRequest` before the fallback (section 5).
- **Models and MCP.** Use `createAI` from `agents/models/ai-sdk` for Workers AI rather than the deprecated `workers-ai-provider`, and write new MCP servers with `createMcpHandler` (sections 2 and 10).

## 14. A gated triage agent on Think takes four settings

The capstone [`09-triage-agent.ts`](../../../verify/cloudflare-agents/examples/09-triage-agent.ts) builds the same support-triage agent as the other references, on one Think class:
1. **Tools.** `lookupCustomer` reads data and runs without approval. **[verified: 09]**
2. **`needsApproval: true` on `escalate`.** The escalation waits in state `approval-requested` and does not run while nobody answers. A `cf_agent_tool_approval` frame then runs it exactly once. **[verified: 09]**
3. **`beforeTurn`.** On the result turn, it returns `Output.object({ schema: TriageResult })` and `activeTools: []`, gated on an instance field rather than `body` (F1).
4. **`runTurn`.** The result turn returns a value that matches the schema and records the approved escalation. **[verified: 09]**

The run logged the identity warning from section 13, because the example keeps the default.

```bash
pnpm install && pnpm --filter @buildanagent/verify-cloudflare-agents test
```

## 15. Nine runnable examples back the [verified] claims

| File | Demonstrates |
|---|---|
| `01-state.ts` | `setState`, `onStateChanged`, state broadcast, the `initialState` notification, routing and the un-awaited fallback |
| `02-sql.ts` | `this.sql` parameters, typed rows, the shared database and the SDK's tables |
| `03-scheduling.ts` | `schedule` with seconds, `Date` and cron, `scheduleEvery`, `listSchedules`, `cancelSchedule` |
| `04-chat-agent.ts` | `AIChatAgent`, `onChatMessage` with `streamText`, server tools, `saveMessages`, persistence |
| `05-think.ts` | Think's overrides, `runTurn`, `beforeToolCall` blocking, structured output, the dropped `body`, the workspace tools |
| `06-tool-approval.ts` | `needsApproval`, `cf_agent_tool_approval`, approve and deny, `autoContinue` |
| `07-mcp.ts` | `createMcpHandler`, `addMcpServer`, `listTools`, `callTool`, `getAITools` |
| `08-hibernation.ts` | Eviction with hibernated WebSockets, and what survives it |
| `09-triage-agent.ts` | The capstone, combining Think, approval and structured output |

## Conclusion: let the Durable Object hold the state, and set the defaults yourself

Cloudflare Agents suits teams that want each agent to be a long-lived, addressable server: its state, conversation, schedules, MCP connections and pending approvals sit in one instance's SQLite, and they survive hibernation and eviction. The agent loop itself is the Vercel AI SDK's, so that SDK's knowledge carries over and its mock model tests both chat classes offline. The SDK matched its docs in 18 of 20 behavioral tests, and both misses were patterns the docs teach: an un-awaited router and a `body` flag that `runTurn` drops. The docs fare worse, because they span two sites and track branches rather than the release. Before you deploy, turn off `sendIdentityOnConnect` for sensitive names, decide which of Think's workspace tools the model gets, gate state-changing tools with `needsApproval`, and await `routeAgentRequest`. Then copy [`09-triage-agent.ts`](../../../verify/cloudflare-agents/examples/09-triage-agent.ts), swap in your tools and schema, and run `pnpm --filter @buildanagent/verify-cloudflare-agents test` to confirm the gate still holds.
