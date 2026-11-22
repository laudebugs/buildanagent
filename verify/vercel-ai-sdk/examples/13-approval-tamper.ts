// A paused run is only its message array, so whoever holds the array can edit the call that is waiting for approval.
// Without experimental_toolApprovalSecret the edited call runs; with it, the SDK signs each approval request over the
// tool name, call id and input and rejects the edited call. Docs: agents/06-tool-approvals.mdx ("Security Considerations")
import { InvalidToolApprovalSignatureError, type ModelMessage, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

const SECRET = "demo-secret-demo-secret-demo-secret"; // 35 bytes; the docs ask for at least 32

function setup(secret: string | undefined) {
  const executed: string[] = [];
  const issueRefund = tool({
    description: "Refund an order",
    inputSchema: z.object({ orderId: z.string() }),
    execute: async ({ orderId }) => {
      executed.push(orderId);
      return `refunded ${orderId}`;
    },
  });
  const { model } = scripted([{ tools: [{ name: "issueRefund", input: { orderId: "A-1" } }] }, "Done."]);
  const agent = new ToolLoopAgent({
    model,
    tools: { issueRefund },
    toolApproval: { issueRefund: "user-approval" },
    ...(secret === undefined ? {} : { experimental_toolApprovalSecret: secret }),
  });
  return { agent, executed };
}

/** Pauses at the refund, edits the saved call from order A-1 to Z-9, and then approves it. */
// #region tamper
async function approveAfterEditing(secret: string | undefined) {
  const { agent, executed } = setup(secret);
  const messages: ModelMessage[] = [{ role: "user", content: "Refund order A-1" }];
  const first = await agent.generate({ messages });
  const ask = first.content.find((p) => p.type === "tool-approval-request");
  check(ask !== undefined && executed.length === 0, "the run pauses before the refund");
  // Whoever stores the messages can change them before the approval arrives.
  const saved = JSON.stringify([...messages, ...first.responseMessages]);
  const edited: ModelMessage[] = JSON.parse(saved.replaceAll('"orderId":"A-1"', '"orderId":"Z-9"'));
  edited.push({
    role: "tool",
    content: [{ type: "tool-approval-response", approvalId: ask.approvalId, approved: true }],
  });
  const error = await agent.generate({ messages: edited }).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { executed, error };
}
// #endregion

{
  const { executed, error } = await approveAfterEditing(undefined);
  check(error === undefined, "unsigned: the edited call is accepted");
  check(JSON.stringify(executed) === '["Z-9"]', "unsigned: the refund runs for the edited order, not the one shown");
}
{
  const { executed, error } = await approveAfterEditing(SECRET);
  check(InvalidToolApprovalSignatureError.isInstance(error), "signed: the edited call fails signature verification");
  check(executed.length === 0, "signed: the tool never runs");
}
