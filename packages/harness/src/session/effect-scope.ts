/** The scope of a write: who it acts for, in which session and branch, and which tool call asked for it. */
import type { EffectScope } from "@buildanagent/agent-safety";
import type { Harness } from "../harness.js";
import type { Session } from "./session.js";

/**
 * The `EffectScope` a guarded write takes for `toolCallId`. The tenant is the harness's, the session is the session's
 * id, and the branch is the file the log is in plus its latest checkout, which a fork, a revert or a re-run changes, so a
 * branch that replays a call id gets its own key. A write with a business key shares one key across all of them, which is what makes a
 * resumed run's repeated write recognisable.
 */
export function effectScope(session: Session, harness: Pick<Harness, "tenant">, toolCallId: string): EffectScope {
  return { tenant: harness.tenant, session: session.key.sessionId, branch: session.branch(), toolCallId };
}
