// Hitting maxTurns yields an error_max_turns result, then query() throws (by design).
// Docs: agent-loop.md "Turns and messages", "Handle the result"
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";

const srv = createSdkMcpServer({
  name: "kb",
  version: "1.0.0",
  tools: [
    tool("search", "Search the knowledge base", { q: z.string() }, async () => ({
      content: [{ type: "text", text: "3 hits" }],
    })),
  ],
});
// #region max-turns
const { result, thrown } = await collect(
  query({
    prompt: "Search for refund policy and summarise.", // book:note task
    // maxTurns: 1 leaves no turn for the final answer after the tool call.
    options: { mcpServers: { kb: srv }, allowedTools: ["mcp__kb__search", "ToolSearch"], maxTurns: 1 }, // book:note max-turns
  }),
);
// #endregion
check(result?.subtype === "error_max_turns", "result subtype is error_max_turns");
check(!("result" in (result ?? {})) || (result as any).result === undefined, "no `result` text on the error variant");
check(
  typeof result?.session_id === "string" && typeof result?.total_cost_usd === "number",
  "error results still carry session_id and cost",
);
check(
  thrown && /maximum number of turns/i.test(thrown.message),
  "query() throws 'Reached maximum number of turns' after yielding the result",
);
