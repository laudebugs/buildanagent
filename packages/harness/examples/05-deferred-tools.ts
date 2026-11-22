// Deferred tools on our harness: an MCP server's tools are registered deferred by default, so a request sends none of
// their definitions until the model calls `tool_search` and names a match. A second copy of the same server opts out
// with `exposure: "direct"`. The book's Chapter 13 lists it beside the Claude Agent SDK's deferred tools. The model is
// a scripted one, so the example runs offline.
import type { ModelContext } from "@buildanagent/gateway";
import { createMcpManager } from "@buildanagent/harness/mcp";
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry, toolSearchInterceptors, toolSearchTool } from "@buildanagent/harness/tools";
import { check, memoryLock, scripted } from "./lib/check.js";
import { weatherServer } from "./lib/mcp-servers.js";

const registry = createToolRegistry();
const activated = new Set<string>();
registry.register({ name: "tool_search", source: "builtin", definition: toolSearchTool(registry, { activated }) });

// #region deferred-server
const manager = createMcpManager({
  registry,
  servers: [
    // Deferred by default: a request names none of these tools until tool search finds one.
    { name: "weather", transport: { kind: "in_process", channel: weatherServer() } }, // book:note deferred-default
    // exposure: "direct" puts every definition of this copy into every request.
    { name: "weather-eager", transport: { kind: "in_process", channel: weatherServer() }, exposure: "direct" }, // book:note always-load
  ],
});
await manager.connect();
// #endregion

const call = (callId: string, name: string, input: object) => ({
  content: [{ type: "tool_call" as const, callId, name, input }],
});
const names = (context?: ModelContext) => context?.tools.map((tool) => tool.name) ?? [];
const deferred = (context?: ModelContext) => names(context).filter((name) => name.startsWith("mcp__weather__"));

// #region deferred-checks
const { adapter, model } = scripted([
  call("c1", "tool_search", { query: "forecast" }),
  call("c2", "mcp__weather__get_forecast", { city: "Lisbon" }),
  { content: [{ type: "text", text: "Sunny in Lisbon." }] },
]); // book:note scripted
const harness = createHarness({
  registry,
  model,
  system: "You use tools.",
  interceptors: toolSearchInterceptors(registry, activated),
});
const session = await openSession({
  store: memoryStore(),
  index: memoryIndex(),
  lock: memoryLock(),
  key: { userId: "ada", sessionId: "deferred" },
});
await runTurn(session, harness, { input: "Use get_forecast for Lisbon." });
const [first, second] = adapter.calls.map((entry) => entry.context);
check(deferred(first).length === 0, "the first request holds no deferred definition"); // book:note no-definition
check(!JSON.stringify(first).includes("mcp__weather__"), "and does not name one either"); // book:note names-hidden
check(
  names(first).filter((name) => name.startsWith("mcp__weather-eager__")).length === 3,
  "the eager copy sent all three",
); // book:note eager-sent
check([...activated].join() === "mcp__weather__get_forecast", "tool search matched one tool by its words"); // book:note select-one
check(deferred(second).join() === "mcp__weather__get_forecast", "after the search, exactly one of the three is sent"); // book:note one-loaded
// #endregion
const everSent = new Set(adapter.calls.flatMap((entry) => deferred(entry.context)));
check(everSent.size === 1, "the other two definitions never reach the model");
await session.close();
await manager.close();
adapter.assertComplete();
