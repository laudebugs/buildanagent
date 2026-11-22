/**
 * `createApprovals()`: the pause and resume of a call that waits for a person. A gate `ask` ends a turn
 * `awaiting_approval` with the signed request in the log, as an `approval_requested` entry written before any client
 * hears of it. `pending()` reads the requests that still wait, and `resolve()` answers them from any process that can
 * open the session and load the key ring, because the log holds everything the resume needs.
 */
import type { Resolution } from "@buildanagent/sdk";
import type { Harness } from "../harness.js";
import { type PendingApproval, pendingApprovals } from "./rebuild.js";
import { type ResumeOptions, resumeTurn, type TurnResult } from "./runner.js";
import type { Session } from "./session.js";

/** The settings a resume takes besides the answers: the same budget, signal and host context a turn has. */
export type ResolveOptions<H = unknown> = Omit<ResumeOptions<H>, "resolutions">;

/** The approvals of one harness. */
export interface Approvals<H = unknown> {
  /** The requests of the session that still wait, each with the input its call would run with once approved. */
  pending(session: Session): Promise<PendingApproval[]>;
  /**
   * Answers waiting requests and resumes the turn. Each answer is written as an `approval_resolved` entry first. The
   * SDK then verifies each request's signature, call and input, so a tampered request runs nothing and is asked again.
   * Each approved call goes through the permission pipeline again, and a deny now turns the approval into a denial.
   * Throws `approval_not_pending` for a request that does not wait, and `approval_unavailable` without a signer. The
   * host fills `Resolution.by` only after it has authenticated the approver.
   */
  resolve(session: Session, resolutions: readonly Resolution[], options?: ResolveOptions<H>): Promise<TurnResult>;
}

/** Creates the approvals of `harness`, which needs a `signer` to check the requests it resumes. */
export function createApprovals<H = unknown>(harness: Harness<H>): Approvals<H> {
  return {
    async pending(session) {
      return pendingApprovals(await session.path());
    },
    resolve(session, resolutions, options = {}) {
      return resumeTurn(session, harness, { ...options, resolutions });
    },
  };
}
