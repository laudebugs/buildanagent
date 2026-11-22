/**
 * The escalation state machine as data: the states a sandboxed command passes through after a denial, the events that
 * move it, and the one table of legal edges. `escalation()` moves only through `nextEscalationState()`, so a test of
 * the table is a test of every move the machine can make.
 */
import { HarnessError } from "../errors.js";

/**
 * Where a sandboxed command stands. `sandboxed`: it runs under the host's policy. `denied`: the backend refused it.
 * `requested`: a signed request for a person waits in the log. `approved`: a signed allow verified. `rerun`: the
 * command runs once more under the policy widened by exactly the denial. `done`: the caller has its result.
 */
export type EscalationState = "sandboxed" | "denied" | "requested" | "approved" | "rerun" | "done";

/**
 * What moves a command between states. `ran`: the command finished without a denial, or the rerun finished.
 * `denied`: the backend returned a `SandboxDenial`. `returned`: the denial goes back to the caller with no request.
 * `asked`: a signed request was written. `waiting`: an answer the quorum policy still waits on. `allowed`: a signed
 * allow verified and the quorum policy is met. `refused`: a deny, a quorum refusal or expiry, or the permission
 * pipeline's deny. `started`: the pipeline's fresh decision is not a deny, so the rerun starts. `settled`: a crash
 * left the command open, and its result is written without running it.
 */
export type EscalationEvent =
  | "ran"
  | "denied"
  | "returned"
  | "asked"
  | "waiting"
  | "allowed"
  | "refused"
  | "started"
  | "settled";

/** One legal edge: from a state, on an event, to a state, and when the machine takes it. */
export interface EscalationTransition {
  /** The state the edge leaves. */
  readonly from: EscalationState;
  /** What moves the command along the edge. */
  readonly event: EscalationEvent;
  /** The state the edge enters. */
  readonly to: EscalationState;
  /** When the machine takes this edge, in a sentence. */
  readonly when: string;
}

/** Every state, in the order a command that escalates passes through them. */
export const ESCALATION_STATES: readonly EscalationState[] = Object.freeze([
  "sandboxed",
  "denied",
  "requested",
  "approved",
  "rerun",
  "done",
]);

/** Every event. */
export const ESCALATION_EVENTS: readonly EscalationEvent[] = Object.freeze([
  "ran",
  "denied",
  "returned",
  "asked",
  "waiting",
  "allowed",
  "refused",
  "started",
  "settled",
]);

/**
 * The legal edges. Any pair of a state and an event not listed is illegal. Only `allowed` enters `approved`, only from
 * `requested`, and only `started` enters `rerun`, only from `approved`, so no path reaches a rerun without a verified
 * allow. `rerun` leads only to `done`: a second denial is the rerun's result, never a new request.
 */
export const ESCALATION_TRANSITIONS: readonly EscalationTransition[] = Object.freeze(
  [
    { from: "sandboxed", event: "ran", to: "done", when: "the command finished under the host's policy" },
    { from: "sandboxed", event: "denied", to: "denied", when: "the backend returned a denial" },
    {
      from: "denied",
      event: "returned",
      to: "done",
      when: "the approval policy, its granular rule or the denial itself rules out a request",
    },
    {
      from: "denied",
      event: "asked",
      to: "requested",
      when: "the policy allows a request and the denial names one path or host to widen; the signed request is written",
    },
    { from: "requested", event: "waiting", to: "requested", when: "the quorum policy waits for more answers" },
    {
      from: "requested",
      event: "allowed",
      to: "approved",
      when: "a signed allow from a person or a hook verified, and the quorum policy is met",
    },
    {
      from: "requested",
      event: "refused",
      to: "done",
      when: "a deny, or the quorum policy rejected the request or let it expire",
    },
    {
      from: "requested",
      event: "settled",
      to: "done",
      when: "a crash left an answered request before its rerun started, so it never ran",
    },
    { from: "approved", event: "refused", to: "done", when: "the permission pipeline now denies the call" },
    {
      from: "approved",
      event: "started",
      to: "rerun",
      when: "the pipeline's fresh decision is not a deny; its entry is the last one before the rerun",
    },
    {
      from: "rerun",
      event: "ran",
      to: "done",
      when: "the rerun finished once under the widened policy, a second denial included",
    },
    {
      from: "rerun",
      event: "settled",
      to: "done",
      when: "a crash left a started rerun with no result, so it may have run and never runs again",
    },
  ].map((edge) => Object.freeze(edge)) as EscalationTransition[],
);

/** The state `event` moves `from` to. Throws `invalid_escalation` for an edge the table does not list. */
export function nextEscalationState(from: EscalationState, event: EscalationEvent): EscalationState {
  const edge = ESCALATION_TRANSITIONS.find((transition) => transition.from === from && transition.event === event);
  if (edge === undefined) {
    throw new HarnessError("invalid_escalation", `an escalation can't move from ${from} on ${event}`);
  }
  return edge.to;
}
