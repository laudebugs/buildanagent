// Behavior: when onPermissionRequest returns { kind: "reject", feedback }, the tool's handler never
// runs, and the model receives a denial (with the feedback) instead of a result. With no handler at
// all the call is denied too, although the docs say it is left pending.
// Docs: nodejs/README.md "Custom Permission Handler" and "Permission Result Kinds".
import { CopilotClient, defineTool, type SessionEvent } from "@github/copilot-sdk";
import { z } from "zod";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

let ran = false;
const refund = defineTool("issue_refund", {
  description: "Refund an order",
  parameters: z.object({ orderId: z.string() }),
  handler: async () => {
    ran = true;
    return "refunded";
  },
});

const client = new CopilotClient({ useLoggedInUser: false });
// #region reject-handler
const session = await client.createSession({
  model: MODEL,
  provider: mockProvider(),
  tools: [refund],
  onPermissionRequest: (
    request, // book:note callback
  ) =>
    request.kind === "custom-tool" && request.toolName === "issue_refund"
      ? { kind: "reject", feedback: "Refunds need a human." } // book:note reject
      : { kind: "approve-once" },
});
// #endregion
const events: SessionEvent[] = [];
session.on((e) => events.push(e));
const reply = await session.sendAndWait({ prompt: "Call issue_refund for order 42.\nmock-reply: Understood." });

// #region reject-checks
check(!ran, "the handler never ran"); // book:note never-ran
const done = events.find((e) => e.type === "tool.execution_complete");
check(
  done?.type === "tool.execution_complete" && done.data.success === false,
  "the tool call completed as unsuccessful",
);
const resultText = JSON.stringify(mockRequests().at(-1)?.body.messages.at(-1));
check(resultText.includes("Refunds need a human."), "the model saw the feedback string"); // book:note feedback
check(reply?.data.content.startsWith("Understood.") === true, "the turn still finished with a reply");
// #endregion
console.log("denial text the model saw:", resultText.slice(0, 300));

await session.disconnect();

// Without onPermissionRequest, the README and the SessionConfig JSDoc say requests are "left pending"
// for the pending-permission RPC. In 1.0.31 the SDK sends requestPermission: false instead, and the
// runtime denies the call at once: no permission.requested event, no handler run, the turn finishes.
// #region no-handler
const unattended = await client.createSession({ model: MODEL, provider: mockProvider(), tools: [refund] }); // book:note no-callback
const pending: string[] = [];
unattended.on("permission.requested", (e) => pending.push(e.data.requestId));
const waited = await unattended.sendAndWait({ prompt: "Call issue_refund for order 7.\nmock-reply: ok" }, 20_000).then(
  () => "finished",
  (e: Error) => e.message,
);
check(waited === "finished", "with no handler the turn still finishes");
check(pending.length === 0 && !ran, "no permission.requested event was emitted and the handler never ran"); // book:note denied-at-once
const denial = JSON.stringify(mockRequests().at(-1)?.body.messages.at(-1));
check(/could not request permission from user/.test(denial), "the model was told no one could approve the call"); // book:note told
// #endregion
const listed = await unattended.rpc.permissions.pendingRequests();
check(JSON.stringify(listed).includes("issue_refund") === false, "nothing is left pending");
await unattended.disconnect();
await client.stop();
