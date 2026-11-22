// Connecting an MCP server to our harness: `createMcpManager()` connects it, negotiates its era and registers its tools
// as `mcp__<server>__<tool>`; the model then calls one like any other tool. The server runs in this process, over the
// real server library. The book's Chapter 13 lists it beside the AI SDK's, Cloudflare's and the Copilot SDK's clients.
// The model is a scripted one, so the example runs offline.
import { createMcpManager } from "@buildanagent/harness/mcp";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { check, memoryLock, scripted } from "./lib/check.js";
import { ordersServer } from "./lib/mcp-servers.js";

// #region mcp-client
const registry = createToolRegistry();
const manager = createMcpManager({
  registry,
  servers: [{ name: "orders", transport: { kind: "in_process", channel: ordersServer() } }], // book:note connect
});
const [status] = await manager.connect();
if (status?.status !== "connected") throw new Error("the orders server did not connect");
check(status.era === "2026-07-28", "the server answered server/discover, so it connects in the new era"); // book:note era
check(status.tools.join() === "mcp__orders__order_status", "the tool is registered under a namespaced name"); // book:note name
check(registry.get("mcp__orders__order_status")?.exposure === "deferred", "an MCP tool is deferred by default"); // book:note exposure
registry.setExposure("mcp:orders", "direct"); // book:note direct
const { adapter, model } = scripted([
  { content: [{ type: "tool_call", callId: "c1", name: "mcp__orders__order_status", input: { orderId: "A-1" } }] },
  { content: [{ type: "text", text: "Your order shipped." }] },
]); // book:note scripted
const pipeline = createPermissionPipeline(
  { mode: "default", allow: [{ tool: "mcp__orders__*" }], interactive: false, policyVersion: "p1" },
  registry,
); // book:note gate
const harness = createHarness({ registry, model, system: "You help.", pipeline });
const store = memoryStore();
const key = { userId: "ada", sessionId: "orders" };
const session = await openSession({ store, index: memoryIndex(), lock: memoryLock(), key });
await runTurn(session, harness, { input: "Where is order A-1?" }); // book:note loop
const reply = adapter.calls[1]?.context.messages.at(-1);
check(JSON.stringify(reply).includes("order A-1: shipped"), "the server's result goes back to the model");
const logged = [];
for await (const entry of store.load(key)) logged.push(entry);
check(
  logged.some((entry) => entry.type === "permission_decision" && entry.tool === "mcp__orders__order_status"),
  "the pipeline decided the call and the log recorded it",
); // book:note decided
check(registry.get("mcp__orders__order_status")?.outputTrust === "untrusted", "and the registry marks it untrusted"); // book:note untrusted
// #endregion
await session.close();
await manager.close();
adapter.assertComplete();
