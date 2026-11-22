// An order-status tool on our SDK, and a call that breaks its schema. defineTool() gives the model a name, a
// description and a schema, checks every call's arguments before execute() runs, and sends a failed check back to the
// model as the tool's result. The book's Chapter 3 lists both regions beside the same tool on other SDKs.
import { defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

// #region tool
const executed: string[] = [];
const getOrderStatus = defineTool({
  name: "get_order_status",
  description: "Look up an order by id.",
  inputSchema: z.object({ orderId: z.string().describe("The order id.") }), // book:note schema
  async execute({ orderId }) {
    executed.push(orderId); // book:note execute
    return { content: [{ type: "text", text: `order ${orderId} shipped` }] };
  },
});
// #endregion
// #region retry
// Call 1 sends a number where the schema wants a string; call 2 retries with a string; call 3 answers.
const MAX_STEPS = 5;
const { adapter, model } = scripted([
  { content: [{ type: "tool_call", callId: "call-1", name: "get_order_status", input: { orderId: 42 } }] }, // book:note bad-call
  { content: [{ type: "tool_call", callId: "call-2", name: "get_order_status", input: { orderId: "A-1" } }] }, // book:note retry
  { content: [{ type: "text", text: "Your order A-1 has shipped." }] },
]);
const result = await run({
  model,
  system: "Answer order questions.",
  tools: [getOrderStatus], // book:note offered
  maxSteps: MAX_STEPS,
  input: "Where is order A-1?",
}).result;
// #endregion

const offered = adapter.calls[0]?.context.tools[0];
const schema = offered?.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
check(offered?.name === "get_order_status", "the model is offered the tool by name");
check(
  schema.properties?.orderId?.type === "string" && schema.required?.includes("orderId") === true,
  "the Zod schema becomes a JSON Schema whose orderId field is a required string",
);

const failed = adapter.calls[1]?.context.messages.find((message) => message.role === "tool");
const failure = failed?.content.map((block) => (block.type === "text" ? block.text : "")).join("");
check(failed?.role === "tool" && failed.isError === true, "the failed call comes back to the model as an error result");
check(
  failure?.startsWith('The arguments for tool "get_order_status" are invalid:\n- /orderId: ') === true &&
    failure.includes("expected string, received number"),
  "the error names the failing field by its JSON Pointer path and says what was wrong with it",
);
check(
  failure?.includes('Received arguments: {"orderId":42}') === true,
  "the error repeats the arguments the model sent",
);
check(
  failure?.endsWith("Fix the call, try another approach, or tell the user what failed.") === true &&
    failure.includes("Do not substitute a mock, a placeholder or invented data"),
  "the error ends by telling the model not to invent a result",
);
check(executed.join() === "A-1", "execute() ran only for the valid call");
const fixed = adapter.calls[2]?.context.messages.at(-1);
check(
  fixed?.role === "tool" && fixed.isError !== true && fixed.content[0]?.type === "text",
  "the retry's result is an ordinary tool result",
);
check(
  fixed?.content[0]?.type === "text" && fixed.content[0].text === "order A-1 shipped",
  "the function's text goes back",
);
check(
  result.stopReason === "done" && result.steps === 3,
  "three model calls in all: the bad call, the retry, the answer",
);
adapter.assertComplete();
