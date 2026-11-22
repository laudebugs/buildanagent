// One tool call that waits for a person, on our SDK. A beforeToolCall gate reads the call's arguments and returns `ask`
// for a large refund. The run does not run the call: it ends `awaiting_approval` with a signed pending request, and
// the call stays open in the transcript. The book's Chapter 16 lists it beside Cloudflare's needsApproval.
import { canonicalInputHash, ephemeralSigner, verifyResolution } from "@buildanagent/agent-safety";
import { defineTool, type Interceptors, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const LARGE_REFUND = 100;
const AMOUNT = 250;
const refunds: string[] = [];
const refund = defineTool({
  name: "refund",
  description: "Refund an order.",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  effect: { kind: "write" },
  async execute({ orderId, amount }) {
    refunds.push(`${orderId}:${amount}`);
    return { content: [{ type: "text", text: `refunded ${amount}` }] };
  },
});

// #region needs-approval
const gate: Interceptors = {
  beforeToolCall: ({ tool, input }) => {
    if (tool === "refund") {
      const { amount } = input as { amount: number }; // book:note rule
      if (amount > LARGE_REFUND) return { decision: "ask", reason: "A large refund." };
    }
    return { decision: "allow" };
  },
};
// #endregion

const input = { orderId: "A1", amount: AMOUNT };
const call = { type: "tool_call", callId: "call-1", name: "refund", input } as const;
const { adapter, model } = scripted([{ content: [call] }, { content: [{ type: "text", text: "Done." }] }]);
const signer = ephemeralSigner();
const result = await run({
  model,
  system: "Refund orders.",
  tools: [refund],
  input: "Refund order A1.",
  interceptors: gate,
  signer,
}).result;

// #region paused
check(result.stopReason === "awaiting_approval", "the run ends while it waits for approval"); // book:note ends
const [request] = result.pending ?? [];
check(request?.kind === "approval" && request.tool === "refund", "the gated call is an approval request for refund");
const answer = { requestId: request?.id ?? "", decision: "allow" } as const;
const verified = await verifyResolution(request, answer, { signer, call: { callId: "call-1", tool: "refund", input } });
check(verified.ok, "the request's signature verifies under the run's signer"); // book:note pending
check(refunds.length === 0, "the gated tool has not executed"); // book:note not-run
// #endregion

check(request?.inputHash === (await canonicalInputHash(input)), "the request signs a hash of the call's exact input");
check(adapter.calls.length === 1, "no second model call ran while the call waits");
