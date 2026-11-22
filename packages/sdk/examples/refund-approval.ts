// A refund agent that asks a person before it moves money. The gate pauses every refund, the run ends with a signed
// request that you can store as JSON, and a later call resumes the run with the person's answer.
import type { Model } from "@buildanagent/gateway";
import {
  type ApprovalSigner,
  type Context,
  continueRun,
  type Interceptors,
  type Resolution,
  type Run,
  run,
} from "@buildanagent/sdk";
import { type IssueRefund, refundTool } from "./refund-tool.js";

const SYSTEM_PROMPT = "You help customers with refunds. Refund an order only when the customer asks for it.";
const MAX_STEPS = 5;

/** What the agent needs from you: a model, a signer for its pauses and your payment provider. */
export interface RefundDeps {
  model: Model;
  signer: ApprovalSigner;
  issueRefund: IssueRefund;
}

// #region gate
/** The gate: every refund waits for a person, and nothing else is gated. */
const gate: Interceptors = {
  beforeToolCall: ({ tool }) =>
    tool === "refund_create" ? { decision: "ask", reason: "A refund moves money." } : { decision: "allow" },
};
// #endregion

/** The agent's options, shared by its first run and every resume. */
function refundOptions(deps: RefundDeps) {
  const tools = [refundTool(deps.issueRefund)];
  return { model: deps.model, tools, interceptors: gate, signer: deps.signer, maxSteps: MAX_STEPS };
}

/** Starts the agent on a customer's message. The run ends `awaiting_approval` when the model asks for a refund. */
export function startRefund(deps: RefundDeps, message: string): Run {
  return run({ ...refundOptions(deps), system: SYSTEM_PROMPT, input: message });
}

// #region resume
/** Resumes a paused run from its stored context, with the person's answer to each request. */
export function resumeRefund(deps: RefundDeps, context: Context, resolutions: readonly Resolution[]): Run {
  return continueRun(context, { ...refundOptions(deps), resolutions });
}
// #endregion
