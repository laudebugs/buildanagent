// createMCPClient turns an MCP server's tools into AI SDK tools; calling one sends tools/call to
// the server. The server here is in-process, behind a custom MCPTransport (no network, no child).
// Docs: ai-sdk-core/mcp-tools.mdx ("Custom Transport"), reference/ai-sdk-core/create-mcp-client.mdx
import { createMCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { generateText, isStepCount } from "ai";
import { check, scripted } from "./lib/check.ts";

type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any };
const received: string[] = [];

class InProcessServer implements MCPTransport {
  onmessage?: MCPTransport["onmessage"];
  async start() {}
  async close() {}
  async send(message: Parameters<MCPTransport["send"]>[0]) {
    const msg = message as Msg;
    if (msg.method) received.push(msg.method);
    const id = msg.id;
    if (id === undefined) return; // a notification
    const reply = (result: unknown) => queueMicrotask(() => this.onmessage?.({ jsonrpc: "2.0", id, result } as any));
    if (msg.method === "initialize")
      reply({
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "orders", version: "1.0.0" },
      });
    else if (msg.method === "tools/list")
      reply({
        tools: [
          {
            name: "lookup_order",
            description: "Look up an order",
            inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
          },
        ],
      });
    else if (msg.method === "tools/call")
      reply({ content: [{ type: "text", text: `order ${msg.params.arguments.orderId}: shipped` }] });
    else
      queueMicrotask(() =>
        this.onmessage?.({ jsonrpc: "2.0", id, error: { code: -32601, message: "not found" } } as any),
      );
  }
}

// #region mcp-client
const client = await createMCPClient({ transport: new InProcessServer() }); // book:note connect
try {
  const tools = await client.tools(); // book:note convert
  check(Object.keys(tools).join() === "lookup_order", "client.tools() exposes the server's tools by name");
  const { model, requests } = scripted([
    { tools: [{ name: "lookup_order", input: { orderId: "A-1" } }] },
    "Your order shipped.",
  ]);
  const result = await generateText({ model, tools, stopWhen: isStepCount(3), prompt: "Where is order A-1?" }); // book:note loop
  check(
    received.includes("initialize") && received.includes("tools/call"), // book:note handshake
    "the client initialises, then sends tools/call",
  );
  check(JSON.stringify(requests[1].prompt).includes("order A-1: shipped"), "the MCP result goes back to the model");
  check(result.text === "Your order shipped.", "the loop completes with the model's answer");
} finally {
  await client.close();
}
// #endregion
