---
name: cloudflare-agents
description: Use when writing, reviewing or testing TypeScript that imports the Cloudflare `agents` package, `@cloudflare/think` or `@cloudflare/ai-chat` (Agent, AIChatAgent, Think, getAgentByName, routeAgentRequest, state/setState, this.sql, schedule, createMcpHandler, addMcpServer, needsApproval, runTurn, beforeTurn, hibernation). Gives the verified 0.33.0 setup, the approval flow, the gotchas from our fact-check, and how to test offline in workerd with a mock model.
---

# Cloudflare Agents (`agents@0.33.0`, `@cloudflare/think@0.23.0`, `@cloudflare/ai-chat@0.12.2`, on `ai@7.0.162`)

Every agent is a Durable Object: a named, single-threaded instance with its own SQLite database, WebSockets and alarms, which Cloudflare wakes on demand and evicts when idle. The model loop is the Vercel AI SDK's. `AIChatAgent` hands you `streamText` to call yourself, while Think calls it for you. Full reference: [`docs/reference/cloudflare-agents/guide.md`](../../../docs/reference/cloudflare-agents/guide.md); verified examples: [`verify/cloudflare-agents/examples/`](../../../verify/cloudflare-agents/examples/).

## When to use it

Choose it when each agent should be a long-lived, addressable server whose state, conversation, schedules and pending approvals live in its own database, and you will deploy on Workers. Choose the Vercel AI SDK for the same loop in your own process with state you keep, and LangChain.js or the OpenAI Agents SDK for durable threads without Workers ([feature table](../../../docs/comparison/feature-table.md)).

## Minimal setup

Install with `pnpm add agents @cloudflare/think @cloudflare/computer ai zod` (in this repo: pnpm only, exact pins). In `wrangler.jsonc`, declare the Workers AI binding and bind each Agent class as a SQLite-backed Durable Object: `"compatibility_flags": ["nodejs_compat"]`, `"ai": { "binding": "AI" }`, `"durable_objects": { "bindings": [{ "class_name": "TriageAgent", "name": "TriageAgent" }] }` and `"migrations": [{ "new_sqlite_classes": ["TriageAgent"], "tag": "v1" }]`. This agent follows the capstone [`09-triage-agent.ts`](../../../verify/cloudflare-agents/examples/09-triage-agent.ts), which runs it on a mock model. Two settings are additions the capstone leaves at their defaults: identity off (F3) and the `activeTools` list (F4, documented in `think/tools.md`, not run). The block type-checks against the pinned packages.

```ts
import { Think } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { Output, tool } from "ai";
import { z } from "zod";

type Env = { TriageAgent: DurableObjectNamespace<TriageAgent>; AI: Ai };
const TriageResult = z.object({ priority: z.enum(["p1", "p2", "p3"]), escalated: z.boolean(), summary: z.string() });

export class TriageAgent extends Think<Env> {
  static override options = { sendIdentityOnConnect: false }; // keep the instance name from clients (F3)
  structured = false;                                         // gate structured output on a field, not body (F1)

  override getModel() { return "@cf/moonshotai/kimi-k2.7-code"; }   // Workers AI through the AI binding
  override getSystemPrompt() { return "Triage support tickets. Look the customer up before escalating."; }
  override getTools() {
    return {
      lookupCustomer: tool({
        description: "Read a customer's plan", inputSchema: z.object({ customerId: z.string() }),
        execute: async ({ customerId }) => ({ customerId, plan: "enterprise" }),
      }),
      escalate: tool({
        description: "Page the on-call team", inputSchema: z.object({ customerId: z.string(), reason: z.string() }),
        needsApproval: true,                                  // waits in "approval-requested" for a client
        execute: async () => ({ ticket: "ESC-1" }),
      }),
    };
  }
  override beforeTurn() {
    if (this.structured) return { output: Output.object({ schema: TriageResult }), activeTools: [] };
    return { activeTools: ["lookupCustomer", "escalate", "read"] }; // allowlist: drops ls, find, grep, write, edit, delete (F4)
  }
  async result() {
    this.structured = true;
    try { return (await this.runTurn({ input: "Return the triage result." })).output; } finally { this.structured = false; }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 }); // await (F6)
  },
} satisfies ExportedHandler<Env>;
```

## Patterns that hold (verified)

- **Identity is the name.** `getAgentByName(env.TriageAgent, "ticket-42")` always reaches the same instance; its public methods are RPC methods on the stub. `routeAgentRequest` serves `/agents/<kebab-class>/<name>` for HTTP and WebSocket, and resolves to `null` for any other path.
- **State:** `setState()` saves to SQLite, broadcasts `cf_agent_state` to connected clients, then calls `onStateChanged(state, "server")`. A new client first receives the current state.
- **SQL:** ``this.sql`SELECT … WHERE id = ${id}` `` binds interpolations as parameters and returns typed rows. The SDK keeps `cf_agents_*` tables in the same database, so prefix your own.
- **Scheduling:** `schedule(seconds | Date | cron, "method", payload)` and `scheduleEvery(seconds, "method")` run on alarms and outlast eviction; `listSchedules()` and `cancelSchedule(id)` manage them.
- **Hibernation** resets class fields and reruns `onStart`; `this.state`, SQL rows, open WebSockets and `connection.state` survive. Keep nothing that must last in a class field.
- **Chat:** on `AIChatAgent`, override `onChatMessage` and return `streamText(…).toUIMessageStreamResponse()`; `saveMessages()` starts a turn without a client. On Think, override `getModel`, `getSystemPrompt` and `getTools`; `runTurn({ input })` returns the persisted turn, and `beforeToolCall` returning `{ action: "block", reason }` skips the tool and sends the reason as its output.
- **Approval:** a `needsApproval` tool ends the turn with its part in `approval-requested`. A `cf_agent_tool_approval` frame (`useAgentChat`'s `addToolApprovalResponse`) with `approved: true` runs it exactly once and, with `autoContinue`, calls the model again; `approved: false` leaves `output-denied` and, with `autoContinue`, also calls the model again. The frame is `{ type: "cf_agent_tool_approval", toolCallId, approved, autoContinue }`; take `toolCallId` from the `approval-requested` part in `getMessages()`. Think's `approveExecution`, `rejectExecution` and `pendingApprovals` are for codemode and durable-pause actions, not `needsApproval` tools. The pause lives in SQLite, so the answer can come on a later connection.
- **MCP:** serve with `createMcpHandler(() => new McpServer(…))` from `agents/mcp/server`; connect with `this.addMcpServer(name, url)`, then `this.mcp.listTools()`, `this.mcp.callTool()` or `this.mcp.getAITools()` for `streamText`.

## Gotchas (from the fact-check)

- **F1. `runTurn({ input, body })` drops `body`,** so a `beforeTurn` gated on `ctx.body` never fires for a programmatic turn. Gate on an instance field, as above.
- **F2. The first read of `initialState` fires `onStateChanged` once,** with nothing changed. Make notifying hooks tolerate it.
- **F3. `sendIdentityOnConnect` defaults to `true`,** sending the instance name (often a user id) to every WebSocket client. With it off, `addMcpServer` needs an explicit `callbackPath`.
- **F4. Think offers seven workspace tools on every turn:** `read`, `ls`, `find` and `grep`, plus the mutating `write`, `edit` and `delete`, all on its virtual `/workspace`. An `activeTools` allowlist from `beforeTurn` removes the rest (verified by the K4 fresh-agent build), or block them in `beforeToolCall`.
- **F5. Stub types collapse to `never`.** A stub method returning `unknown`-bearing data (`UIMessage[]`, `TurnResult.output`) types as `never`, or fails with TS2589. Cast with `rpc<T>()` from the examples' `lib/check.ts`.
- **F6. The docs' un-awaited `routeAgentRequest(…) || 404` returns `null`.** Await it first.
- **F7, F10. Two documented names are wrong.** Import `AgentWorkflow` from `agents/workflows`, because `agents` does not export it. `static options = { hibernate: false }` is silently ignored, because every agent hibernates.
- **F16–F18. Deprecated but still taught:** `needsApproval` (ai 7 prefers call-level `toolApproval`; it still works here), `McpAgent` (use `createMcpHandler`) and `workers-ai-provider` (use `createAI` from `agents/models/ai-sdk`).

## Test offline

An Agent cannot be constructed in Node, so tests run inside workerd through Miniflare. Each example exports its Agent classes and `test(env, h)`; the harness bundles it with esbuild into `.tmp/`, binds every Agent class as a SQLite-backed Durable Object named after the class (`env.TriageAgent`), and refuses every non-`localhost` fetch. Create the model inside the agent with `scripted(turns)` from [`examples/lib/check.ts`](../../../verify/cloudflare-agents/examples/lib/check.ts) (a `MockLanguageModelV4`, one per instance), and return `this.mock.model` from `getModel()` or pass it to `streamText`. A turn is a string or `{ tools: [{ name, input }] }`, or a function `(n, req) => Turn`; answer `req.responseFormat?.type === "json"` with a JSON string for structured output. `h.until(fn, ms)` polls for alarms and approvals, and `h.evict(className, name)` hibernates an agent. Type stubs with `rpc<T>()` (F5). The shims in `shims/` mock `@ai-sdk/*`, `workers-ai-provider` and `agents/models/ai-sdk`, and the mock denies host-sounding tools (`bash`, `write`, `edit`, `delete`) but not Think's read-only ones. To approve from a test, open a WebSocket with `await routeAgentRequest(new Request("http://x/agents/<kebab-class>/<name>", { headers: { Upgrade: "websocket" } }), env)`, call `res.webSocket.accept()`, and send the approval frame. For state on Think, declare `Think<Env, State>` and set `initialState`; `runTurn` returns `{ status, message, output }`.

Run one new file without touching committed results, from `verify/cloudflare-agents`: `node scripts/run-examples.mjs examples --only <name>` (no type-check; run `pnpm typecheck` too). Run the verified examples with:

```bash
pnpm --filter @buildanagent/verify-cloudflare-agents test
```
