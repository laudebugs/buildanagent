// A minimal, read-only MCP server over stdio (newline-delimited JSON-RPC), used by
// examples/07-mcp-server.ts. It touches nothing on the host: one tool looks up a fixed table.
import { createInterface } from "node:readline";

const ORDERS = { "A-100": "shipped", "A-200": "processing" };
const TOOLS = [
  {
    name: "order_status",
    description: "Look up the status of an order by id",
    inputSchema: { type: "object", properties: { orderId: { type: "string", default: "A-100" } }, required: ["orderId"] },
  },
];
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.id === undefined) return; // notifications
  switch (req.method) {
    case "initialize":
      return send({
        id: req.id,
        result: {
          protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "orders-fixture", version: "1.0.0" },
        },
      });
    case "tools/list":
      return send({ id: req.id, result: { tools: TOOLS } });
    case "tools/call": {
      const id = req.params?.arguments?.orderId;
      const text = id in ORDERS ? `Order ${id} is ${ORDERS[id]} (from mcp-orders)` : `No order ${id}`;
      return send({ id: req.id, result: { content: [{ type: "text", text }] } });
    }
    case "ping":
      return send({ id: req.id, result: {} });
    default:
      return send({ id: req.id, error: { code: -32601, message: `unknown method ${req.method}` } });
  }
});
