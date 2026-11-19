// toolApproval 'user-approval' pauses before execute(): the result carries a
// tool-approval-request, and a second call with a tool-approval-response runs (or skips) the tool.
// 'denied' skips the tool without asking. Docs: agents/tool-approvals.mdx,
// ai-sdk-core/tools-and-tool-calling.mdx ("Tool Execution Approval")
import { type ModelMessage, type ToolApprovalResponse, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

function setup() {
  const executed: string[] = [];
  // #region approval-policy
  const issueRefund = tool({
    description: "Refund an order",
    inputSchema: z.object({ orderId: z.string() }),
    execute: async ({ orderId }) => {
      executed.push(orderId);
      return `refunded ${orderId}`;
    },
  });
  const { model, requests } = scripted([{ tools: [{ name: "issueRefund", input: { orderId: "A-1" } }] }, "Done."]);
  const agent = new ToolLoopAgent({ model, tools: { issueRefund }, toolApproval: { issueRefund: "user-approval" } });
  // #endregion
  return { agent, executed, requests };
}

async function decide(approved: boolean) {
  const { agent, executed, requests } = setup();
  const messages: ModelMessage[] = [{ role: "user", content: "Refund order A-1" }];
  // #region approval-response
  const first = await agent.generate({ messages });
  const asks = first.content.filter((p) => p.type === "tool-approval-request");
  check(asks.length === 1 && !asks[0].isAutomatic, "the first call ends with one manual approval request");
  check(executed.length === 0 && requests.length === 1, "the tool has not run, and the loop stopped");
  messages.push(...first.responseMessages);
  const responses: ToolApprovalResponse[] = asks.map((p) => ({
    type: "tool-approval-response",
    approvalId: p.approvalId,
    approved,
  }));
  messages.push({ role: "tool", content: responses });
  const second = await agent.generate({ messages });
  // #endregion
  return { second, executed, requests };
}

{
  const { second, executed, requests } = await decide(true);
  check(JSON.stringify(executed) === '["A-1"]', "approved: the tool runs exactly once on the second call");
  check(requests.length === 2 && second.text === "Done.", "approved: the model then answers");
}
{
  const { second, executed, requests } = await decide(false);
  check(executed.length === 0, "denied by the user: the tool never runs");
  const toolMsg = requests[1].prompt.find((m) => m.role === "tool");
  check(
    JSON.stringify(toolMsg).includes("execution-denied"),
    "denied by the user: the model sees an execution-denied result",
  );
  check(second.text === "Done.", "denied by the user: the model can still answer");
}
{
  const executed: string[] = [];
  const deleteFile = tool({
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      executed.push(path);
      return "deleted";
    },
  });
  const { model } = scripted([
    { tools: [{ name: "deleteFile", input: { path: "temp.txt" } }] },
    "I can't delete files.",
  ]);
  const agent = new ToolLoopAgent({
    model,
    tools: { deleteFile },
    toolApproval: { deleteFile: { type: "denied", reason: "Deleting files is disabled" } },
  });
  const result = await agent.generate({ prompt: "Delete temp.txt" });
  check(executed.length === 0, "'denied' policy: the tool never runs");
  check(result.text === "I can't delete files.", "'denied' policy: the loop continues without asking");
}
