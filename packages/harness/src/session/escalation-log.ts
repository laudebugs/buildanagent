/**
 * What the log says about each sandbox escalation: its latest signed request, whether its answer is final, whether its
 * rerun started, and its result. An escalation is keyed by the call id of its request, whose tool is
 * `ESCALATION_TOOL`. That name breaks the canonical tool-name rule, so no registered tool, and no call the model makes,
 * can carry it. A rerun that started and has no result is never run again: the crash rule a code call follows.
 */
import type { SessionEntry, ToolResultEntry } from "@buildanagent/protocol";
import type { SignedPendingRequest } from "@buildanagent/sdk";
import type { SandboxDenial, SandboxPolicy } from "../sandbox/types.js";
import { isDenial } from "../sandbox/widen.js";

/** The tool name an escalation's signed request carries. It has a dot, so no registered tool can share it. */
export const ESCALATION_TOOL = "sandbox.escalation";

/**
 * What an escalation's request signs, as the input of its `approval_requested` entry: the call the command ran for,
 * the command, the workspace root, the policy it ran under and the denial. The rerun's policy is built from `policy`
 * and `denial` alone, once the signature over this record verifies.
 */
export interface EscalationRecord {
  /** The tool the command ran for, which the permission pipeline decides again before the rerun. */
  readonly tool: string;
  /** That tool call's input, as the pipeline sees it. */
  readonly input: unknown;
  /** Who chose the call: the model, or the host's own code. */
  readonly initiator: "model" | "code";
  /** The tool call's own id, when the command ran for one. */
  readonly toolCallId?: string;
  /** The executable and its arguments. */
  readonly command: readonly string[];
  /** The working directory, relative to the workspace root. */
  readonly cwd?: string;
  /** The command's timeout, which the rerun keeps. */
  readonly timeoutMs?: number;
  /** The command's output cap, which the rerun keeps. */
  readonly maxOutputBytes?: number;
  /** The workspace root the sandbox was provisioned for. */
  readonly root: string;
  /** The policy the command ran under. */
  readonly policy: SandboxPolicy;
  /** What the backend refused. */
  readonly denial: SandboxDenial;
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function isPolicy(value: unknown): value is SandboxPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  const network = policy.network as Record<string, unknown> | undefined;
  return (
    isStrings(policy.readRoots) &&
    isStrings(policy.writeRoots) &&
    typeof network === "object" &&
    network !== null &&
    isStrings(network.allow) &&
    isStrings(network.deny)
  );
}

const optional = (value: unknown, type: "string" | "number"): boolean => value === undefined || typeof value === type;

/** True when `value` has the shape of an `EscalationRecord`. A record is checked after its signature verifies too. */
export function isEscalationRecord(value: unknown): value is EscalationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tool === "string" &&
    (record.initiator === "model" || record.initiator === "code") &&
    optional(record.toolCallId, "string") &&
    isStrings(record.command) &&
    record.command.length > 0 &&
    optional(record.cwd, "string") &&
    optional(record.timeoutMs, "number") &&
    optional(record.maxOutputBytes, "number") &&
    typeof record.root === "string" &&
    isPolicy(record.policy) &&
    isDenial(record.denial)
  );
}

/** One escalation as the log records it. */
export interface EscalationLogRecord {
  /** The escalation's id: its request's call id. */
  readonly id: string;
  /** The latest signed request and the record it signs, which a forged entry may not hold until it is checked. */
  readonly requested: { readonly request: SignedPendingRequest; readonly input: unknown };
  /** True once an answer is final: one no quorum still waits on, or the policy's refusal. */
  readonly answered: boolean;
  /**
   * True once the rerun started: after a final allow, the permission pipeline wrote a decision that is not a deny.
   * That entry is the last one before the rerun runs.
   */
  readonly started: boolean;
  /** The escalation's `tool_result` entry, once it has one. */
  readonly result?: SessionEntry & ToolResultEntry;
}

interface Draft {
  id: string;
  requested: { request: SignedPendingRequest; input: unknown };
  answered: boolean;
  personAllowed: boolean;
  started: boolean;
  result?: SessionEntry & ToolResultEntry;
}

/** Folds a request: a later request for the same escalation replaces the earlier one and waits for its own answer. */
function foldRequest(drafts: Map<string, Draft>, byRequest: Map<string, string>, entry: SessionEntry): void {
  if (entry.type !== "approval_requested") return;
  const id = entry.request.callId;
  const requested = { request: entry.request, input: entry.input };
  const draft = drafts.get(id);
  if (draft === undefined) drafts.set(id, { id, requested, answered: false, personAllowed: false, started: false });
  else Object.assign(draft, { requested, answered: false, personAllowed: false });
  byRequest.set(entry.request.id, id);
}

/** Folds an entry that names the escalation's id: the pipeline's decision, which starts the rerun, or its result. */
function foldCall(draft: Draft, entry: SessionEntry): void {
  if (entry.type === "permission_decision") draft.started = entry.decision !== "deny" && draft.personAllowed;
  else if (entry.type === "tool_result") draft.result ??= entry;
}

function fold(drafts: Map<string, Draft>, byRequest: Map<string, string>, entry: SessionEntry): void {
  if (entry.type === "approval_requested" && entry.request.tool === ESCALATION_TOOL) {
    foldRequest(drafts, byRequest, entry);
  } else if (entry.type === "approval_resolved" && entry.quorum === undefined) {
    const draft = drafts.get(byRequest.get(entry.resolution.requestId) ?? "");
    if (draft === undefined) return;
    draft.answered = true;
    draft.personAllowed = "decision" in entry.resolution && entry.resolution.decision === "allow";
  } else if ("callId" in entry) {
    const draft = drafts.get(entry.callId);
    if (draft !== undefined) foldCall(draft, entry);
  }
}

/** Every escalation on `path`, by id, in the order they asked. */
export function escalationsOf(path: readonly SessionEntry[]): Map<string, EscalationLogRecord> {
  const drafts = new Map<string, Draft>();
  const byRequest = new Map<string, string>();
  for (const entry of path) fold(drafts, byRequest, entry);
  return drafts;
}

/** The escalations on `path` that wait for an answer: no final answer, no started rerun and no result. */
export function waitingEscalations(path: readonly SessionEntry[]): EscalationLogRecord[] {
  return [...escalationsOf(path).values()].filter(
    (record) => record.result === undefined && !record.answered && !record.started,
  );
}
