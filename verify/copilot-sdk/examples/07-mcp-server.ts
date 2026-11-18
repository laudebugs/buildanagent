// Behavior: a stdio server in mcpServers is started by the runtime; its tools reach the model as
// "<server-key>-<tool-name>", calls ask onPermissionRequest with kind "mcp", and the server's result
// reaches the model. A per-server `tools` list filters what the model is offered.
// Docs: docs/features/mcp.md, nodejs/README.md (the "<server-key>-<tool-name>" note).
import { CopilotClient, type PermissionRequest } from "@github/copilot-sdk";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

const server = `${process.env.FIXTURES}/mcp-orders.mjs`;
const asked: PermissionRequest[] = [];
const client = new CopilotClient({ useLoggedInUser: false });
const session = await client.createSession({
  model: MODEL,
  provider: mockProvider(),
  mcpServers: { orders: { type: "local", command: process.execPath, args: [server], tools: ["*"] } },
  onPermissionRequest: (request) => {
    asked.push(request);
    return { kind: "approve-once" };
  },
});
const reply = await session.sendAndWait({
  prompt:
    'Check orders-order_status for A-100.\nmock-args orders-order_status {"orderId":"A-100"}\nmock-reply: Checked.',
});

const offered = mockRequests()[0].tools ?? [];
check(
  offered.includes("orders-order_status"),
  `the MCP tool is offered as orders-order_status (${offered.filter((t) => t.startsWith("orders"))})`,
);
check(
  asked.length === 1 && asked[0].kind === "mcp",
  `onPermissionRequest was asked with kind mcp (got ${asked.map((a) => a.kind)})`,
);
check(
  reply?.data.content.includes("Order A-100 is shipped (from mcp-orders)") === true,
  "the MCP server's result reached the model",
);
await session.disconnect();

const none = await client.createSession({
  model: MODEL,
  provider: mockProvider(),
  mcpServers: { orders: { type: "local", command: process.execPath, args: [server], tools: [] } },
  onPermissionRequest: () => ({ kind: "approve-once" }),
});
await none.sendAndWait({ prompt: "Anything?\nmock-reply: Nothing to call." });
check(
  !(mockRequests().at(-1)?.tools ?? []).some((t) => t.startsWith("orders-")),
  "tools: [] offers none of the server's tools",
);
await none.disconnect();
await client.stop();
