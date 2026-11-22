// Steering on our SDK. While a run streams, run.steer() queues a message for the run in progress and run.followUp()
// queues one for after the run would otherwise end. Each is applied only at a step boundary, never inside a model call
// or a tool batch, and each returns a receipt and emits a steer_applied event. The book's Chapter 10 lists it beside
// Pi's steer() and followUp().
import { type DeliveryReceipt, defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const lookup = defineTool({
  name: "lookup",
  description: "Look up an order.",
  inputSchema: z.object({}),
  async execute() {
    return { content: [{ type: "text", text: "order 1 shipped" }] };
  },
});
const { adapter, model } = scripted([
  {
    content: [
      { type: "text", text: "Looking that up." },
      { type: "tool_call", callId: "call-1", name: "lookup", input: {} },
    ],
  },
  { content: [{ type: "text", text: "Order 1 has shipped." }] },
  { content: [{ type: "text", text: "Then it arrives on Friday." }] },
]);

const applied: string[] = [];
const receipts: Promise<DeliveryReceipt>[] = [];
// #region steer
const started = run({ model, system: "Answer order questions.", tools: [lookup], input: "Where is order 1?" });
for await (const event of started) {
  if (event.type === "text_delta" && receipts.length === 0) {
    // The first model call is still streaming when these two arrive.
    receipts.push(started.steer("Steer: be brief.")); // book:note steer
    receipts.push(started.followUp("Follow-up: and then?")); // book:note follow-up
  }
  if (event.type === "steer_applied") applied.push(`${event.receipt.kind}@${event.receipt.stepIndex}`); // book:note applied
}
// #endregion
const [steer, followUp] = await Promise.all(receipts);
const result = await started.result;

/** The text of every user message in `messages`. */
function userTexts(messages: readonly { role: string; content: readonly { type: string; text?: string }[] }[]) {
  return messages.flatMap((m) => (m.role === "user" ? m.content.map((block) => block.text ?? "") : []));
}
check(
  steer?.kind === "steer" && steer.stepIndex === 1,
  "the steer was applied at step 1, after the first call's tool batch and before the second model call",
);
check(
  followUp?.kind === "follow_up" && followUp.stepIndex === 2,
  "the follow-up waited until the run would have ended, then took a step of its own",
);
check(
  applied.join() === "steer@1,follow_up@2",
  "the run emitted one steer_applied event for each, in the order they were applied",
);
check(
  userTexts(result.messages).join("|") === "Where is order 1?|Steer: be brief.|Follow-up: and then?",
  "the messages land in order: the prompt, the steer, the follow-up",
);
check(
  JSON.stringify(userTexts(adapter.calls[1]?.context.messages ?? [])) ===
    JSON.stringify(["Where is order 1?", "Steer: be brief."]),
  "the second model call is the first to read the steer, and it does not read the follow-up",
);
check(result.stopReason === "done" && result.steps === 3, "each queued message cost one more model call");
adapter.assertComplete();
