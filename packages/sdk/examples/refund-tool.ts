// A refund tool that changes the world, so it declares its effect and reports what each refund did as an outcome.
import { defineTool, type WriteOutcome } from "@buildanagent/sdk";
import { z } from "zod";

/** What your payment provider says about one refund request. */
export type RefundReply = { status: "refunded"; refundId: string } | { status: "declined"; code: string };

/** Sends one refund request to your payment provider. */
export type IssueRefund = (order: number) => Promise<RefundReply>;

function outcomeOf(order: number, reply: RefundReply): WriteOutcome {
  const base = { operation: "refund_create", reverted: [], notReversible: [] };
  if (reply.status === "refunded") {
    return {
      ...base,
      kind: "applied",
      retry: "never",
      applied: [`refund ${reply.refundId}`],
      next: "Tell the customer",
    };
  }
  const next = `Tell the customer that order ${order} was not refunded`;
  return { ...base, kind: "not_applied", retry: "never", applied: [], reason: reply.code, next };
}

/** Builds the `refund_create` tool over your payment provider. */
export function refundTool(issueRefund: IssueRefund) {
  return defineTool({
    name: "refund_create",
    description: "Refund an order in full.",
    inputSchema: z.object({ order: z.number().int().positive() }),
    effect: { kind: "write", businessKey: ({ order }) => `refund:${order}` },
    async execute({ order }) {
      const reply = await issueRefund(order);
      return { content: [], outcome: outcomeOf(order, reply) };
    },
  });
}
