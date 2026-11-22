// A tool call that waits for a person, on our SDK. The gate returns "ask", the run ends `awaiting_approval` with a
// signed request, and continueRun() resumes the saved context with the person's answer. The book's Chapter 6 lists it
// beside the AI SDK, the OpenAI Agents SDK and LangChain, and runs it on a scripted model.
import { continueRun, defineTool, hmacSigner, type Interceptors, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const KEY = new Uint8Array(32).fill(7); // A demo key. A real one comes from your secret store.
/** One signer for each process, built over the same key, as two servers would build theirs. */
const processSigner = () => hmacSigner({ keys: { k1: new Uint8Array(KEY) }, current: "k1" });
const refunded: string[] = [];

// #region gate
const issueRefund = defineTool({
  name: "issue_refund",
  description: "Refund an order",
  inputSchema: z.object({ orderId: z.string() }),
  async execute({ orderId }) {
    refunded.push(orderId); // book:note tool
    return { content: [{ type: "text", text: `refunded ${orderId}` }] };
  },
});
const gate: Interceptors = {
  beforeToolCall: ({ tool }) => (tool === "issue_refund" ? { decision: "ask" } : { decision: "allow" }), // book:note rule
};
// #endregion

/** The text of the tool result that a model's first request carried for `callId`. */
function toolText(
  request: { messages: readonly { role: string; callId?: string; content?: unknown }[] },
  callId: string,
) {
  const message = request.messages.find((m) => m.role === "tool" && m.callId === callId);
  return JSON.stringify(message?.content ?? "");
}

async function decide(decision: "allow" | "deny") {
  // #region resume
  const asked = scripted([
    { content: [{ type: "tool_call", callId: "call-1", name: "issue_refund", input: { orderId: "A-1" } }] }, // book:note mock
  ]);
  const first = await run({
    model: asked.model,
    system: "You handle refunds.",
    input: "Refund order A-1",
    tools: [issueRefund],
    interceptors: gate,
    signer: processSigner(),
  }).result; // book:note pause
  check(first.stopReason === "awaiting_approval" && first.pending.length === 1, "the run ends with one request");
  const [request] = first.pending;
  check(
    request !== undefined && refunded.length === 0 && asked.adapter.calls.length === 1,
    "the tool has not run, and the model was called once",
  );
  const stored = JSON.stringify(first.context); // book:note save
  const answered = scripted([{ content: [{ type: "text", text: "Done." }] }]); // book:note mock2
  const second = await continueRun(JSON.parse(stored), {
    model: answered.model,
    tools: [issueRefund],
    interceptors: gate,
    signer: processSigner(), // book:note signer
    resolutions: [{ requestId: request.id, decision, by: "reviewer" }], // book:note answer
  }).result; // book:note resume
  // #endregion
  check(asked.adapter.calls.length === 1 && answered.adapter.calls.length === 1, "one model call before, one after");
  check(second.stopReason === "done", "the resumed run ends with the model's answer");
  const sent = answered.adapter.calls[0]?.context;
  return { text: toolText({ messages: sent?.messages ?? [] }, "call-1") };
}

{
  const { text } = await decide("allow");
  check(
    JSON.stringify(refunded) === '["A-1"]',
    "approved: the tool runs exactly once, for the order the request signs",
  );
  check(text.includes("refunded A-1"), "approved: the model reads the tool's result");
}
{
  refunded.length = 0;
  const { text } = await decide("deny");
  check(refunded.length === 0, "denied: the tool never runs");
  check(text.includes("was denied by the approver"), "denied: the model reads the denial and still answers");
}
