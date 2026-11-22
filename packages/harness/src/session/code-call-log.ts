/**
 * What the log says about each code call: its `code_call` entry, its result, its latest signed request, whether a person
 * answered it, and whether it was let run. A call that was let run and has no result may have taken effect, so it is
 * never run again: the crash rule a model call follows. A call that was answered but never let run did not run. A call
 * with a request, no final answer and no such mark still waits for a person.
 */
import type { CodeCallEntry, SessionEntry, ToolResultEntry } from "@buildanagent/protocol";
import type { PendingApproval } from "./rebuild.js";

/** One code call as the log records it. */
export interface CodeCallRecord {
  readonly call: CodeCallEntry & { readonly id: string };
  /** The call's `tool_result` entry, once it has one. */
  readonly result?: SessionEntry & ToolResultEntry;
  /** The call's latest signed request and the input it signs, when it asked for a person. */
  readonly requested?: PendingApproval;
  /**
   * True once a person's answer to the call's request is final: an answer that no quorum still waits on, or the
   * policy's refusal. A call that was answered no longer waits, whether it then ran or not.
   */
  readonly answered: boolean;
  /**
   * True once nothing could refuse the call any more, so its tool may have started: an allow from the pipeline or a
   * sticky allowance, or, after a person's allow, the pipeline's new decision when it is not a deny. Each is the last
   * entry the call writes before its tool starts. A person's allow alone is not enough, because the checks after it can
   * still deny the call, and a deny clears the mark.
   */
  readonly letRun: boolean;
}

/** A code call that waits for a person: its request, the input the request signs, and its `code_call` entry. */
export interface WaitingCodeCall extends PendingApproval {
  readonly call: CodeCallEntry & { readonly id: string };
}

interface Draft {
  call: CodeCallEntry & { id: string };
  result?: SessionEntry & ToolResultEntry;
  requested?: PendingApproval;
  answered: boolean;
  /** A person's final allow, which the pipeline then decides again. */
  personAllowed: boolean;
  letRun: boolean;
}

/** Folds a request or a resolution into the calls read so far. A resolution names only its request, so `callOfRequest` maps one to its call. */
function foldApproval(calls: Map<string, Draft>, callOfRequest: Map<string, string>, entry: SessionEntry): void {
  if (entry.type === "approval_requested") {
    const asked = calls.get(entry.request.callId);
    if (asked === undefined) return;
    asked.requested = { request: entry.request, input: entry.input };
    asked.answered = false;
    asked.personAllowed = false;
    callOfRequest.set(entry.request.id, entry.request.callId);
  } else if (entry.type === "approval_resolved" && entry.quorum === undefined) {
    const answered = calls.get(callOfRequest.get(entry.resolution.requestId) ?? "");
    if (answered === undefined) return;
    // The latest final answer decides: a policy's refusal written after a person's allow takes the allow back.
    answered.answered = true;
    answered.personAllowed = "decision" in entry.resolution && entry.resolution.decision === "allow";
  }
}

/** Folds the pipeline's decision: an allow lets the call run, a deny refuses it, and an ask after a person's allow runs it. */
function foldDecision(draft: Draft, decision: "allow" | "deny" | "ask"): void {
  if (decision === "deny") draft.letRun = false;
  else if (decision === "allow" || draft.personAllowed) draft.letRun = true;
}

/** Folds one entry into the calls read so far. */
function fold(calls: Map<string, Draft>, callOfRequest: Map<string, string>, entry: SessionEntry): void {
  if (entry.type === "code_call") {
    calls.set(entry.callId, { call: entry, answered: false, personAllowed: false, letRun: false });
  } else if (entry.type === "tool_result") {
    const draft = calls.get(entry.callId);
    if (draft !== undefined) draft.result ??= entry;
  } else if (entry.type === "permission_decision") {
    const draft = calls.get(entry.callId);
    if (draft !== undefined) foldDecision(draft, entry.decision);
  } else foldApproval(calls, callOfRequest, entry);
}

/** Every code call on `path`, by call id, in the order they were made. */
export function codeCallsOf(path: readonly SessionEntry[]): Map<string, CodeCallRecord> {
  const calls = new Map<string, Draft>();
  const callOfRequest = new Map<string, string>();
  for (const entry of path) fold(calls, callOfRequest, entry);
  return calls;
}

/** The code calls on `path` that wait for a person: each asked, has no result, was never answered and never let run. */
export function pendingCodeCalls(path: readonly SessionEntry[]): WaitingCodeCall[] {
  return [...codeCallsOf(path).values()].flatMap(({ call, result, requested, answered, letRun }) =>
    requested !== undefined && result === undefined && !answered && !letRun ? [{ ...requested, call }] : [],
  );
}

/** The ids of every request on `path` that names a code call, waiting or not, so a resolution can be routed by it. */
export function codeCallRequestIds(path: readonly SessionEntry[]): Set<string> {
  const calls = new Set(path.flatMap((entry) => (entry.type === "code_call" ? [entry.callId] : [])));
  return new Set(
    path.flatMap((entry) =>
      entry.type === "approval_requested" && calls.has(entry.request.callId) ? [entry.request.id] : [],
    ),
  );
}
