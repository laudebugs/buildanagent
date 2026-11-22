// What the model reads when a tool's own function throws, on our SDK. The run does not end: the loop turns the throw
// into an error result, and by default the model reads the thrown message. A tool that sets redactErrors shows it a
// fixed line instead, and keeps the thrown message in the result's details. The book's Chapter 3 compares these
// defaults with the other SDKs' in a table.
import { defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

/** The most model calls a run may make; each run here needs two. */
const MAX_STEPS = 5;

/** An order lookup whose database is down, so every call throws. */
function brokenLookup(redactErrors: boolean) {
  return defineTool({
    name: "get_order_status",
    description: "Look up an order by id.",
    inputSchema: z.object({ orderId: z.string() }),
    redactErrors,
    async execute() {
      throw new Error("connect ECONNREFUSED db.internal:5432");
    },
  });
}

/** Runs one call of the broken lookup and returns the run's result and the text the model read for the failure. */
async function failedCall(redactErrors: boolean) {
  const { adapter, model } = scripted([
    { content: [{ type: "tool_call", callId: "call-1", name: "get_order_status", input: { orderId: "A-1" } }] },
    { content: [{ type: "text", text: "I could not look that order up." }] },
  ]);
  const result = await run({
    model,
    system: "Answer order questions.",
    tools: [brokenLookup(redactErrors)],
    maxSteps: MAX_STEPS,
    input: "Where is order A-1?",
  }).result;
  const message = adapter.calls[1]?.context.messages.find((m) => m.role === "tool");
  const text = message?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
  adapter.assertComplete();
  return { result, text, isError: message?.role === "tool" && message.isError === true };
}

const plain = await failedCall(false);
check(
  plain.result.stopReason === "done" && plain.result.steps === 2,
  "a throw does not end the run: the model answers",
);
check(plain.isError, "the model reads the failure as an error result");
check(
  plain.text.startsWith('Tool "get_order_status" failed: connect ECONNREFUSED db.internal:5432\n'),
  "by default the model reads the thrown message",
);
check(plain.text.includes('Received arguments: {"orderId":"A-1"}'), "the error repeats the arguments the model sent");
check(
  plain.text.includes("Do not substitute a mock, a placeholder or invented data"),
  "the error says not to invent a result",
);

const hidden = await failedCall(true);
check(
  hidden.result.stopReason === "done" && hidden.isError,
  "with redactErrors the run still goes on, with an error result",
);
check(
  hidden.text.startsWith('Tool "get_order_status" failed: its error message is hidden.\n'),
  "with redactErrors the model reads a fixed line",
);
check(
  !hidden.text.includes("ECONNREFUSED") && !hidden.text.includes("db.internal"),
  "the thrown message stays out of the model's context",
);
