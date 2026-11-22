// Two interceptors on our SDK at the tool moment: beforeToolCall gates a call and may deny it, and afterToolCall
// replaces a result before the model reads it. The book's Chapter 10 lists them beside the Copilot, LangChain and ADK
// hooks.
import { defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const ran: string[] = [];
const hooked: string[] = [];
const closeTicket = defineTool({
  name: "close_ticket",
  description: "Close a support ticket.",
  inputSchema: z.object({}),
  async execute() {
    ran.push("close_ticket");
    return { content: [{ type: "text", text: "ticket closed" }] };
  },
});
const readTicket = defineTool({
  name: "read_ticket",
  description: "Read a support ticket.",
  inputSchema: z.object({}),
  async execute() {
    ran.push("read_ticket");
    return { content: [{ type: "text", text: "raw ticket body" }] };
  },
});

const { adapter, model } = scripted([
  {
    content: [
      { type: "tool_call", callId: "call-1", name: "close_ticket", input: {} },
      { type: "tool_call", callId: "call-2", name: "read_ticket", input: {} },
    ],
  },
  { content: [{ type: "text", text: "Done." }] },
]);
const ended: { isError: boolean }[] = [];
// #region hooks
const result = await run({
  model,
  system: "Handle support tickets.",
  tools: [closeTicket, readTicket],
  input: "Use close_ticket, then read_ticket.",
  interceptors: {
    beforeToolCall: async ({ tool }) => {
      hooked.push(`before:${tool}`);
      if (tool === "close_ticket") return { decision: "deny", reason: "Closing needs a supervisor." }; // book:note deny
      return { decision: "allow" }; // book:note allow
    },
    afterToolCall: async ({ tool }) => {
      hooked.push(`after:${tool}`);
      if (tool === "read_ticket") return { content: [{ type: "text", text: "ticket body (redacted)" }] }; // book:note replace
    },
  },
  observers: [
    (event) => {
      if (event.type === "tool_call_end") ended.push({ isError: event.result.isError === true });
    },
  ],
}).result;
// #endregion

check(!ran.includes("close_ticket"), "the denied tool's function never ran");
check(ran.includes("read_ticket"), "the allowed tool ran");
/** The text of the tool result the model's second call read for `callId`. */
function readFor(callId: string): string {
  const message = adapter.calls[1]?.context.messages.find((m) => m.role === "tool" && m.callId === callId);
  return message?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
}
check(readFor("call-1").includes("Closing needs a supervisor."), "the model read the deny reason");
check(
  readFor("call-2") === "ticket body (redacted)",
  "the model read the replacement, and the raw ticket body never reached it",
);
check(
  hooked.join() === "before:close_ticket,before:read_ticket,after:read_ticket",
  "both calls are gated before either runs, and afterToolCall skips the denied call, which never ran",
);
check(
  ended.length === 2 && ended[0]?.isError === true && ended[1]?.isError === false,
  "tool_call_end still reports the denied call, as an error result",
);
check(result.stopReason === "done" && result.steps === 2, "the run goes on to its answer after a denial");
adapter.assertComplete();
