// A custom in-process tool via createSdkMcpServer, auto-approved with allowedTools.
// Docs: custom-tools.md "Create a custom tool", "Configure allowed tools"
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";

const calls: unknown[] = [];
const weather = createSdkMcpServer({
  name: "weather",
  version: "1.0.0",
  tools: [
    tool("get_temperature", "Get the current temperature at a location", {
      latitude: z.number(),
      longitude: z.number(),
    }, async (args) => {
      calls.push(args);
      return { content: [{ type: "text", text: "Temperature: 21°C" }] };
    }),
  ],
});

const { messages, result } = await collect(query({
  prompt: "What's the temperature in Lisbon?",
  options: {
    mcpServers: { weather },
    allowedTools: ["mcp__weather__get_temperature"], // tool names are mcp__<server>__<tool>
    maxTurns: 4,
  },
}));

check(calls.length === 1, "custom tool handler ran exactly once");
check(typeof (calls[0] as any).latitude === "number", "handler received Zod-validated arguments");
const toolResultTurn = messages.find((m) => m.type === "user" && Array.isArray((m as any).message.content) && (m as any).message.content.some((b: any) => b.type === "tool_result"));
check(toolResultTurn, "SDK yielded a UserMessage carrying the tool_result");
check(result?.subtype === "success", "run finished with success");
