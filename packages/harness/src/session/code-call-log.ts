/**
 * What the log says about each code call: its `code_call` entry, its result, its latest signed request, and whether it
 * was let run. A call that was let run and has no result may have taken effect, so it is never run again: the crash
 * rule a model call follows. A call with a request and no such mark still waits for a person.
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
   * True once the call was let run: an allow from the pipeline or a sticky allowance, or a person's allow that no
   * quorum still waits on. Every one of them is written before the tool starts.
   */
  readonly letRun: boolean;
}

/** A code call that waits for a person: its request, the input the request signs, and its `code_call` entry. */
export interface WaitingCodeCall extends PendingApproval {
  readonly call: CodeCallEntry & { readonly id: string };
}

const isAllow = (entry: SessionEntry): boolean =>
  entry.type === "approval_resolved" &&
  entry.quorum === undefined &&
  "decision" in entry.resolution &&
  entry.resolution.decision === "allow";

interface Draft {
  call: CodeCallEntry & { id: string };
  result?: SessionEntry & ToolResultEntry;
  requested?: PendingApproval;
  letRun: boolean;
}

/** Folds a request or a resolution into the calls read so far. A resolution names only its request, so `callOfRequest` maps one to its call. */
function foldApproval(calls: Map<string, Draft>, callOfRequest: Map<string, string>, entry: SessionEntry): void {
  if (entry.type === "approval_requested") {
    const asked = calls.get(entry.request.callId);
    if (asked === undefined) return;
    asked.requested = { request: entry.request, input: entry.input };
    callOfRequest.set(entry.request.id, entry.request.callId);
  } else if (isAllow(entry) && entry.type === "approval_resolved") {
    const allowed = calls.get(callOfRequest.get(entry.resolution.requestId) ?? "");
    if (allowed !== undefined) allowed.letRun = true;
  }
}

/** Folds one entry into the calls read so far. */
function fold(calls: Map<string, Draft>, callOfRequest: Map<string, string>, entry: SessionEntry): void {
  if (entry.type === "code_call") calls.set(entry.callId, { call: entry, letRun: false });
  else if (entry.type === "tool_result") {
    const draft = calls.get(entry.callId);
    if (draft !== undefined) draft.result ??= entry;
  } else if (entry.type === "permission_decision") {
    const draft = calls.get(entry.callId);
    if (draft !== undefined && entry.decision === "allow") draft.letRun = true;
  } else foldApproval(calls, callOfRequest, entry);
}

/** Every code call on `path`, by call id, in the order they were made. */
export function codeCallsOf(path: readonly SessionEntry[]): Map<string, CodeCallRecord> {
  const calls = new Map<string, Draft>();
  const callOfRequest = new Map<string, string>();
  for (const entry of path) fold(calls, callOfRequest, entry);
  return calls;
}

/** The code calls on `path` that wait for a person: each asked, has no result, and was never let run. */
export function pendingCodeCalls(path: readonly SessionEntry[]): WaitingCodeCall[] {
  return [...codeCallsOf(path).values()].flatMap(({ call, result, requested, letRun }) =>
    requested !== undefined && result === undefined && !letRun ? [{ ...requested, call }] : [],
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
