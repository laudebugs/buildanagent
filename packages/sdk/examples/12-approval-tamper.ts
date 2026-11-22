// Editing a paused run on our SDK. Every pause is signed, so a saved input that was edited no longer matches its
// request: the run runs nothing and asks again. The book's Chapter 6 lists it beside the AI SDK and the OpenAI Agents
// SDK, whose saved copies an edit can change, and runs it on a scripted model.
import { type Context, canonicalInputHash, continueRun, defineTool, hmacSigner, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const KEY = new Uint8Array(32).fill(7); // A demo key. A real one comes from your secret store.
const signer = () => hmacSigner({ keys: { k1: new Uint8Array(KEY) }, current: "k1" });
const refunded: string[] = [];
const issueRefund = defineTool({
  name: "issue_refund",
  description: "Refund an order",
  inputSchema: z.object({ orderId: z.string() }),
  async execute({ orderId }) {
    refunded.push(orderId);
    return { content: [{ type: "text", text: `refunded ${orderId}` }] };
  },
});
const gate = { beforeToolCall: () => ({ decision: "ask" as const }) };
const CALL = {
  content: [{ type: "tool_call" as const, callId: "call-1", name: "issue_refund", input: { orderId: "A-1" } }],
};

/** Pauses at the refund for A-1 and returns what a store would keep: the context, as JSON. */
async function pause() {
  const { model } = scripted([CALL]);
  const first = await run({
    model,
    system: "You handle refunds.",
    input: "Refund order A-1",
    tools: [issueRefund],
    interceptors: gate,
    signer: signer(),
  }).result;
  check(first.stopReason === "awaiting_approval" && refunded.length === 0, "the run pauses before the refund");
  return { request: first.pending[0], saved: JSON.stringify(first.context) };
}

/** Resumes `context` with an allow for `requestId`, and returns the events and the result. */
async function resume(context: Context, requestId: string) {
  const events: string[] = [];
  const { model } = scripted([{ content: [{ type: "text", text: "Done." }] }]);
  const result = await continueRun(context, {
    model,
    tools: [issueRefund],
    interceptors: gate,
    signer: signer(),
    resolutions: [{ requestId, decision: "allow" }],
    observers: [
      (e) => {
        if (e.type === "resolution_rejected") events.push(e.cause);
      },
    ],
  }).result;
  return { events, result };
}

{
  const { request, saved } = await pause();
  check(request !== undefined, "the pause has a request");
  // #region tamper
  // Whoever stores the context can change it before the answer arrives.
  const edited = JSON.parse(saved.replaceAll('"orderId":"A-1"', '"orderId":"Z-9"')); // book:note edit
  const resumed = await resume(edited, request.id); // book:note resume
  check(resumed.events.join() === "input_changed", "the edited input fails the signed hash"); // book:note rejected
  check(refunded.length === 0, "the refund never runs, for A-1 or for Z-9");
  check(resumed.result.stopReason === "awaiting_approval", "the call asks again, so a person must decide on Z-9"); // book:note again
  const [again] = resumed.result.stopReason === "awaiting_approval" ? resumed.result.pending : [];
  check(
    again !== undefined && again.id !== request.id,
    "the new request has a new id, so the old answer does not carry over",
  );
  check(
    again !== undefined && JSON.stringify(resumed.result.pendingInputs?.[again.id]) === '{"orderId":"Z-9"}',
    "the new request signs the call as the edited context now reads, so the person sees Z-9",
  );
  // #endregion

  // An editor who also rewrites the stored hash cannot sign it again without the key.
  const forged = JSON.parse(saved);
  forged.pending[0].inputHash = await canonicalInputHash({ orderId: "Z-9" });
  check(
    (await resume(forged, request.id)).events.join() === "signature_invalid",
    "a rewritten hash fails the signature",
  );
  // The transcript's own arguments are never what runs: only the signed input is.
  const shown = saved.replace('"input":{"orderId":"A-1"}', '"input":{"orderId":"Z-9"}');
  check(shown.split("Z-9").length === 2, "the edit reached the transcript's call and nothing else");
  const visible = JSON.parse(shown);
  await resume(visible, request.id);
  check(JSON.stringify(refunded) === '["A-1"]', "an edit to the visible call alone runs the signed order, A-1");
}
{
  refunded.length = 0;
  const { request, saved } = await pause();
  const control = await resume(JSON.parse(saved), request?.id ?? "");
  check(control.events.length === 0 && JSON.stringify(refunded) === '["A-1"]', "unedited: the approval runs A-1");
}
