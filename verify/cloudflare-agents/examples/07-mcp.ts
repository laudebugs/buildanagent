// MCP both ways, offline: the Worker serves an MCP SDK v2 server with createMcpHandler (the
// documented replacement for the deprecated McpAgent), and an Agent connects to it as a client
// with addMcpServer() over loopback (localhost is an allowed MCP URL), lists its tools, calls one,
// and gets AI SDK tools from it. Docs: agents/docs/agents/mcp-servers.md ("Create a server"),
// agents/docs/agents/mcp-client.md ("Adding MCP Servers", "URL Security", "Using MCP Capabilities").
import { McpServer } from "@modelcontextprotocol/server";
import { Agent, getAgentByName } from "agents";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { check, type Harness } from "./lib/check.ts";

type Env = { McpUser: DurableObjectNamespace<McpUser> };

function createServer() {
  const server = new McpServer({ name: "orders", version: "1.0.0" });
  server.registerTool(
    "lookupOrder",
    { description: "Look up an order", inputSchema: z.object({ orderId: z.string() }) },
    async ({ orderId }) => ({ content: [{ type: "text", text: `Order ${orderId}: shipped` }] }),
  );
  return server;
}
const handler = createMcpHandler(createServer);

export class McpUser extends Agent<Env> {
  async link() {
    // Not named connect(): a Durable Object stub reserves connect() (TCP sockets) and fetch().
    const r = await this.addMcpServer("orders", "http://localhost/mcp");
    return { state: r.state, id: r.id };
  }
  tools() {
    return this.mcp.listTools().map((t) => ({ name: t.name, serverId: t.serverId }));
  }
  aiToolNames() {
    return Object.keys(this.mcp.getAITools());
  }
  async call(serverId: string, orderId: string) {
    const r: any = await this.mcp.callTool({ serverId, name: "lookupOrder", arguments: { orderId } });
    return r.content?.[0]?.text as string;
  }
  servers() {
    return Object.values(this.getMcpServers().servers).map((s) => ({ name: s.name, state: s.state }));
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, env, ctx);
  },
};

export async function test(env: Env, _h: Harness) {
  // The server answers a raw initialize, so the endpoint works before any client is involved.
  // (A Request built inside a Worker has no Host header, which the handler requires; add it.)
  const init = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    }),
    env,
    {} as ExecutionContext,
  );
  check(init.status === 200, `createMcpHandler serves /mcp (initialize -> ${init.status})`);

  const agent = await getAgentByName(env.McpUser, "client");
  const conn = await agent.link();
  check(conn.state === "ready", `addMcpServer to a localhost URL connects (state ${conn.state})`);
  const tools = await agent.tools();
  check(tools.length === 1 && tools[0].name === "lookupOrder", "listTools() returns the server's tool");
  check(tools[0].serverId === conn.id, "each tool records the id of the server it came from");
  const aiNames = await agent.aiToolNames();
  check(aiNames.length === 1 && aiNames[0].includes("lookupOrder"), `getAITools() namespaces it (${aiNames[0]})`);
  check((await agent.call(conn.id, "A1")) === "Order A1: shipped", "callTool() runs the remote tool");
  // Harness self-check: only loopback is served; any other host is refused before it leaves.
  const outside = await fetch("https://mcp.example.com/mcp");
  check(outside.status === 403, "a non-local fetch is refused by the harness (offline guarantee)");
  const servers = await agent.servers();
  check(
    servers.some((s) => s.name === "orders" && s.state === "ready"),
    "getMcpServers() reports the connection",
  );
}
