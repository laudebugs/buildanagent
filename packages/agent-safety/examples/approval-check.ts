// A refund that waits for a person, and the check that runs before it does. The pause is signed over the tool call's id,
// name and input, so a call that was edited while it waited, or a pause that was forged, runs nothing.
import {
  type ApprovalSigner,
  type PendingCall,
  type RejectionCause,
  type SignedPendingRequest,
  signPending,
  verifyResolution,
} from "@buildanagent/agent-safety";

// #region pause
/** Signs the pause to store while a person decides whether `call` may run. */
export function pauseForApproval(call: PendingCall, signer: ApprovalSigner): Promise<SignedPendingRequest> {
  return signPending(
    { kind: "approval", callId: call.callId, tool: call.tool, input: call.input, reason: "A refund moves money" },
    signer,
  );
}
// #endregion

// #region resume
/** Returns why `call` must not run, or `undefined` when the person allowed exactly the call that was signed. */
export async function refusalBeforeRun(
  pending: SignedPendingRequest,
  decision: "allow" | "deny",
  call: PendingCall,
  signer: ApprovalSigner,
): Promise<RejectionCause | "denied" | undefined> {
  const check = await verifyResolution(pending, { requestId: pending.id, decision }, { signer, call });
  if (!check.ok) return check.cause;
  return decision === "allow" ? undefined : "denied";
}
// #endregion
