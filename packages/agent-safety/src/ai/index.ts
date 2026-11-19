/**
 * `@buildanagent/agent-safety/ai`: adapters for the Vercel AI SDK (`ai`). `toAiToolResult()` hands write outcomes to
 * the model, and `signedToolApproval()` makes every approval signed and fail closed on resume.
 */
export {
  type ApprovalRejection,
  type ApprovalRejectionCause,
  type SignedToolApprovalOptions,
  signedToolApproval,
} from "./tool-approval.js";
export { toAiToolResult } from "./tool-result.js";
