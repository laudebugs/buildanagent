// createMiddleware hooks run around the loop: beforeModel before each model call, wrapToolCall
// around each tool call (and can return its own ToolMessage instead of running the tool), and
// afterAgent once at the end. Docs: langchain/middleware/custom.mdx, middleware/overview.mdx
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createAgent, createMiddleware, fakeModel, tool } from "langchain";
import { z } from "zod";
import { check, kind, text } from "./lib/check.ts";

const order: string[] = [];
const ran: string[] = [];
const restart = tool(
  async ({ service }) => {
    ran.push(service);
    return "restarted";
  },
  { name: "restart_service", description: "Restart a service", schema: z.object({ service: z.string() }) },
);
// #region middleware
const freeze = createMiddleware({
  name: "ChangeFreeze",
  beforeModel: () => {
    order.push("beforeModel");
    return undefined; // book:note observe
  },
  wrapToolCall: async (request, handler) => {
    order.push(`wrapToolCall:${request.toolCall.name}`);
    if (request.toolCall.name === "restart_service") {
      return new ToolMessage({ content: "Blocked: change freeze", tool_call_id: request.toolCall.id ?? "" }); // book:note block
    }
    return handler(request); // book:note through
  },
  afterAgent: () => {
    order.push("afterAgent");
    return undefined;
  },
});
// #endregion
const model = fakeModel()
  .respondWithTools([{ name: "restart_service", args: { service: "api" }, id: "call_r" }])
  .respond(new AIMessage("I could not restart it."));
const result = await createAgent({ model, tools: [restart], middleware: [freeze] }).invoke({
  messages: [{ role: "user", content: "Restart the api" }],
});

check(ran.length === 0, "wrapToolCall can block a tool by returning its own ToolMessage");
const toolMsg = result.messages.find((m) => kind(m) === "tool");
check(toolMsg && text(toolMsg) === "Blocked: change freeze", "the model receives the middleware's message");
check(
  JSON.stringify(order) === '["beforeModel","wrapToolCall:restart_service","beforeModel","afterAgent"]',
  `hooks run in loop order: ${order.join(", ")}`,
);
