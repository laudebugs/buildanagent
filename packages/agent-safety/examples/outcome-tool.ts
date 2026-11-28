// An AI SDK refund tool that reports a declined card as a typed outcome. The tool returns the outcome from `execute`,
// and `toModelOutput` hands the model its sentence and its fields as one tool result, with the provider's error flag
// set.
import { type WriteOutcome, writeOutcome } from "@buildanagent/agent-safety";
import { toAiToolResult } from "@buildanagent/agent-safety/ai";
import { jsonSchema, tool } from "ai";

// #region declined
/** The outcome for a refund whose card the payment provider declined. */
export function declinedRefund(): WriteOutcome {
  return writeOutcome({
    kind: "not_applied",
    operation: "refund_create",
    reason: "CARD_DECLINED",
    next: "Ask the requester for another payment method",
  });
}
// #endregion

const inputSchema = jsonSchema<{ orderId: string }>({
  type: "object",
  properties: { orderId: { type: "string" } },
  required: ["orderId"],
});

// #region tool
/** A refund tool whose result is the outcome, not a thrown error. */
export const refund = tool({
  inputSchema,
  execute: async () => declinedRefund(),
  toModelOutput: ({ output }) => toAiToolResult(output),
});
// #endregion
