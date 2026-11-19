/**
 * `@buildanagent/agent-safety/ai`: adapters for the Vercel AI SDK (`ai`). `toAiToolResult()` hands write outcomes to
 * the model, `signedToolApproval()` makes every approval signed and fail closed on resume, and
 * `settleDeniedApprovals()` keeps a stored chat consistent after such a denial.
 */
export { settleDeniedApprovals } from "./settle-denied.js";
export {
  type ApprovalRejection,
  type ApprovalRejectionCause,
  type SignedToolApprovalOptions,
  signedToolApproval,
} from "./tool-approval.js";
export { toAiToolResult } from "./tool-result.js";
