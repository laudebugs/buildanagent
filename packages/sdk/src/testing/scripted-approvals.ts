/**
 * `scriptedApprovals()`: a strict double for the person behind an approval. It answers each approval request the run
 * raises with the next scripted answer, through `blockingApprovals()`, so a test drives the real signing and checking
 * path without a store or a second process.
 */
import type { Interceptors } from "../hooks.js";
import { blockingApprovals } from "../pauses.js";
import type { Resolution, SignedPendingRequest } from "../vendor/agent-safety/pending.js";

type Decision = Extract<Resolution, { decision: unknown }>;

/**
 * One scripted answer: allow or deny, with an optional reason and approver. Give a `requestId` only to test an
 * answer that names the wrong request; without it, the answer names the request it answers.
 */
export type ScriptedAnswer = Omit<Decision, "requestId"> & { readonly requestId?: string };

/** The interceptors to give a run, with what the double saw. */
export interface ScriptedApprovals extends Interceptors {
  /** Every approval request the run raised so far, in order. */
  readonly requests: readonly SignedPendingRequest[];
  /** Throws if an answer was never used, or if the run raised more requests than there are answers. */
  assertComplete(): void;
}

/**
 * Answers the run's approval requests in order with `answers`, one per request. Join the result with a gate that
 * returns `ask`, as you would `blockingApprovals()`: `composeInterceptors(gate, scriptedApprovals([{ decision:
 * "allow" }]))`. A request past the last answer is denied, with a `hook_error` event, and `assertComplete()` then
 * throws.
 */
export function scriptedApprovals(answers: readonly ScriptedAnswer[]): ScriptedApprovals {
  const script = [...answers];
  const requests: SignedPendingRequest[] = [];
  const interceptors = blockingApprovals((request) => {
    requests.push(request);
    const answer = script[requests.length - 1];
    if (answer === undefined) {
      throw new Error(
        `scriptedApprovals: request ${requests.length} has no scripted answer (the script has ${script.length})`,
      );
    }
    return { ...answer, requestId: answer.requestId ?? request.id };
  });
  return Object.assign(interceptors, {
    requests,
    assertComplete(): void {
      if (requests.length > script.length) {
        throw new Error(
          `scriptedApprovals: the run raised ${requests.length} approval requests, but the script has ${script.length}`,
        );
      }
      const unused = script.length - requests.length;
      if (unused > 0) throw new Error(`scriptedApprovals: ${unused} of ${script.length} answers were never used`);
    },
  });
}
