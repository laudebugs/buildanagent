// Deferred tools: a tool's definition reaches the model only when the model asks for it.
// With tool search on (the default), the SDK sends the names of MCP tools but not their schemas.
// The model loads one by calling the built-in ToolSearch tool; `alwaysLoad` opts a server out.
// The mock model stands in for that choice, so this run is deterministic and offline. The tools
// are read-only and in-process, and the run keeps every other built-in tool out of the model's reach.
// Docs: tool-search.md, custom-tools.md (alwaysLoad: sdk.d.ts, McpSdkServerConfigWithInstance)
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";
import { modelRequests } from "./lib/mock-log.ts";

const handled: string[] = [];
const noteCall = (name: string) => async () => {
  handled.push(name);
  return { content: [{ type: "text" as const, text: `${name}: ok` }] };
};

// #region deferred-server
const stationTools = [
  tool("get_forecast", "Five-day forecast for a city", { city: z.string() }, noteCall("get_forecast")),
  tool("lookup_station", "Find the nearest weather station", { city: z.string() }, noteCall("lookup_station")),
  tool("set_units", "Switch between Celsius and Fahrenheit", { units: z.enum(["C", "F"]) }, noteCall("set_units")),
];
// Deferred by default: the model sees these tools' names, not their schemas.
const deferred = createSdkMcpServer({ name: "weather", version: "1.0.0", tools: stationTools });
// alwaysLoad: true sends every definition in the first request, so no ToolSearch round trip is needed.
const eager = createSdkMcpServer({ name: "weather", version: "1.0.0", tools: stationTools, alwaysLoad: true });
// #endregion

const options = (server: typeof deferred) => ({
  mcpServers: { weather: server },
  tools: ["ToolSearch"], // the only built-in tool: no Bash, Edit or Read to call
  allowedTools: ["mcp__weather__get_forecast", "mcp__weather__lookup_station", "mcp__weather__set_units"],
  settingSources: [],
  maxTurns: 6,
});
const prompt = "Use get_forecast for Lisbon.";
const isWeatherTool = (t: { name: string }) => t.name.startsWith("mcp__weather__");

// #region deferred-run
const before = modelRequests().length;
const { result } = await collect(query({ prompt, options: options(deferred) }));
const deferredRequests = modelRequests(before);
// #endregion

check(result?.subtype === "success", "deferred run finished with success");
const [first, second] = deferredRequests;
check(
  first.tools.some((t) => t.name === "ToolSearch"),
  "the first request offers ToolSearch",
);

// #region deferred-checks
check(!first.tools.some(isWeatherTool), "the first request holds no weather tool definition"); // book:note no-definition
check(first.text.includes("mcp__weather__set_units"), "the model still sees the tool's name"); // book:note names-only
check(!first.text.includes("Switch between Celsius"), "but not its description or schema");
const search = second.blocks.find((b) => b.type === "tool_use" && b.name === "ToolSearch");
check(/select:mcp__weather__/.test(JSON.stringify(search?.input)), "the model asked ToolSearch for one tool by name"); // book:note select
const loaded = second.tools.filter(isWeatherTool);
check(loaded.length === 1, "after ToolSearch, exactly one of the three definitions reached the model"); // book:note one-loaded
// #endregion

check(
  deferredRequests.every((r) => r.tools.filter(isWeatherTool).length <= 1),
  "the other two definitions never reached the model in any request",
);
check(handled.length === 1 && `mcp__weather__${handled[0]}` === loaded[0].name, "only the loaded tool's handler ran");
check(
  deferredRequests.at(-1)?.blocks.some((b) => b.type === "tool_result" && JSON.stringify(b).includes(": ok")),
  "the tool result went back to the model",
);

// #region eager-run
const beforeEager = modelRequests().length;
const eagerRun = await collect(query({ prompt, options: options(eager) }));
const eagerRequests = modelRequests(beforeEager);
// #endregion

check(eagerRun.result?.subtype === "success", "alwaysLoad run finished with success");
check(
  eagerRequests[0].tools.filter(isWeatherTool).length === 3,
  "alwaysLoad: all three definitions are in the first request",
);
check(
  !eagerRequests.some((r) => r.tools.some((t) => t.name === "ToolSearch")),
  "alwaysLoad: with nothing left to defer, ToolSearch is not offered and the model never calls it",
);
const size = (tools: unknown[]) => JSON.stringify(tools).length;
check(
  size(loaded) < size(eagerRequests[0].tools),
  "one loaded definition is smaller than the three definitions alwaysLoad sends up front",
);
