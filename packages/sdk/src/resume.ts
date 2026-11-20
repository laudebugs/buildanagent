/**
 * Resuming a paused context (D5; SDK plan §3.3). `continueRun()` first checks the context's shape and refuses one it
 * can't resume safely, then, inside the run, checks every waiting call's stored request and its resolution before
 * anything runs. The checks fail closed: a request or resolution that doesn't verify never runs its call, and the
 * call asks again with a new request.
 */
import type { AssistantMessage, Message } from "@buildanagent/gateway";
import { fillTemplate, SDK_DEFAULTS } from "./defaults.js";
import { SdkError } from "./errors.js";
import type { AgentEventBody, ResolutionRejectionCause } from "./events.js";
import { denied, textOf } from "./hook-runner.js";
import type { Context } from "./result.js";
import type { ToolCall, ToolResult } from "./tools/types.js";
import {
  type Recheck,
  type Resolution,
  type SignedPendingRequest,
  verifyResolution,
} from "./vendor/agent-safety/pending.js";
import type { ApprovalSigner } from "./vendor/agent-safety/signer.js";

/** A call of the context's last assistant message that has no result, and the stored request it waits on. */
export interface OpenCall {
  readonly call: ToolCall;
  /** The stored request, untrusted until its signature verifies. Only `id` and `callId` are known to be strings. */
  readonly request: SignedPendingRequest;
}

/** What a run that resumes a paused context starts with, checked for shape when `continueRun()` is called. */
export interface ResumeSetup {
  /** The assistant message whose calls wait, absent when none does. */
  readonly message?: AssistantMessage;
  /** The calls that wait, in model order. */
  readonly open: readonly OpenCall[];
  /** Each resolution, by the request id it names. */
  readonly resolutions: ReadonlyMap<string, Resolution>;
  /** The request ids that more than one resolution names. */
  readonly replayed: ReadonlySet<string>;
  /** The request ids of resolutions that name no request in the context. */
  readonly unmatched: readonly string[];
  /** The input each stored request signs, by request id. */
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Runs current policy before an approved call runs. */
  readonly recheck?: Recheck;
}

/** What the checks decided for one waiting call. */
export type Verdict =
  /** A verified approval: the call runs with `call.input`, the input its request signs. */
  | { readonly kind: "run"; readonly call: ToolCall }
  /** A verified denial or answer, or an approval current policy now denies: the model reads `result`. */
  | { readonly kind: "result"; readonly call: ToolCall; readonly result: ToolResult }
  /** No resolution names the request, which verified: it still waits. */
  | { readonly kind: "wait"; readonly call: ToolCall; readonly request: SignedPendingRequest; readonly input: unknown }
  /** The request or its resolution failed a check: the call asks again. */
  | { readonly kind: "reissue"; readonly call: ToolCall };

function invalid(message: string): never {
  throw new SdkError("invalid_run_options", `continueRun() ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailedTurn(message: Message): boolean {
  return message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted");
}

/**
 * The calls of the last assistant message that no later tool message answers. A message that ended in an error or
 * an abort has none: the gateway's replay pass drops it, and the run asks the model again.
 */
function openCallsOf(messages: readonly Message[]): { message: AssistantMessage; calls: ToolCall[] } | undefined {
  const index = messages.findLastIndex((message) => message.role === "assistant");
  const message = messages[index];
  if (message?.role !== "assistant" || isFailedTurn(message)) return undefined;
  const answered = new Set<string>();
  for (const later of messages.slice(index + 1)) if (later.role === "tool") answered.add(later.callId);
  const calls = message.content.filter(
    (block): block is ToolCall => block.type === "tool_call" && !answered.has(block.callId),
  );
  return { message, calls };
}

/** Checks the context's shape, the minimum `continueRun()` needs to read it. */
function checkContext(context: unknown): asserts context is Context {
  if (!isObject(context)) invalid("needs a context object with system and messages");
  if (typeof context.system !== "string") invalid("needs a context whose system is a string");
  if (!Array.isArray(context.messages) || !context.messages.every((m) => isObject(m) && typeof m.role === "string")) {
    invalid("needs a context whose messages are a list of messages");
  }
  if (context.pending !== undefined && !Array.isArray(context.pending)) invalid("needs pending to be a list");
  if (context.pendingInputs !== undefined && !isObject(context.pendingInputs)) {
    invalid("needs pendingInputs to be an object of inputs by request id");
  }
}

/** The stored requests by call id, after checking that each one is an object with a string `id` and `callId`. */
function requestsByCall(pending: readonly unknown[]): Map<string, SignedPendingRequest> {
  const byCall = new Map<string, SignedPendingRequest>();
  const ids = new Set<string>();
  for (const request of pending) {
    if (!isObject(request) || typeof request.id !== "string" || typeof request.callId !== "string") {
      invalid("needs each pending request to be an object with a string id and callId");
    }
    if (ids.has(request.id)) invalid(`got two pending requests with the id ${JSON.stringify(request.id)}`);
    if (byCall.has(request.callId)) invalid(`got two pending requests for the call ${JSON.stringify(request.callId)}`);
    ids.add(request.id);
    byCall.set(request.callId, request as unknown as SignedPendingRequest);
  }
  return byCall;
}

/** The resolutions by request id, with the ids more than one of them names. */
function resolutionsOf(resolutions: unknown): { byId: Map<string, Resolution>; replayed: Set<string> } {
  if (resolutions !== undefined && !Array.isArray(resolutions)) invalid("needs resolutions to be a list");
  const byId = new Map<string, Resolution>();
  const replayed = new Set<string>();
  for (const resolution of (resolutions ?? []) as unknown[]) {
    if (!isObject(resolution) || typeof resolution.requestId !== "string") {
      invalid("needs each resolution to be an object with a string requestId");
    }
    if (byId.has(resolution.requestId)) replayed.add(resolution.requestId);
    byId.set(resolution.requestId, resolution as unknown as Resolution);
  }
  return { byId, replayed };
}

/**
 * Pairs each waiting call with its stored request, and refuses a call with none, two calls with one id, and a
 * request whose call doesn't wait.
 */
function matchOpenCalls(calls: readonly ToolCall[], byCall: ReadonlyMap<string, SignedPendingRequest>): OpenCall[] {
  const open: OpenCall[] = [];
  for (const call of calls) {
    const request = byCall.get(call.callId);
    // The owner's rule (2026-11-19): a waiting call with no record is a lost pause, so it fails loudly here rather
    // than reaching the model as "No result was recorded".
    if (request === undefined) {
      invalid(
        `can't resume the call ${JSON.stringify(call.callId)} to "${call.name}": it has no result and no pending ` +
          "request, so its pause record was lost. Restore the context's pending and pendingInputs, or add a result",
      );
    }
    if (open.some((entry) => entry.call.callId === call.callId)) {
      invalid(`got two waiting calls with the id ${JSON.stringify(call.callId)}`);
    }
    open.push({ call, request });
  }
  for (const [callId, request] of byCall) {
    if (!calls.some((call) => call.callId === callId)) {
      invalid(
        `got the pending request ${JSON.stringify(request.id)}, whose call doesn't wait in this context. ` +
          "Remove the request from pending and its input from pendingInputs, or restore the call without its result",
      );
    }
  }
  return open;
}

/**
 * Checks a context and its resolutions before a run starts, and returns what the run needs to resume its waiting
 * calls, or `undefined` when no call waits. Throws an `SdkError` with code `invalid_run_options` for a context it
 * can't read, for a call of the last assistant message that has no result and no stored request, for a stored
 * request whose call doesn't wait in the context, and for malformed resolutions or `recheck`.
 */
export function resumeSetupOf(context: unknown, resolutions: unknown, recheck: unknown): ResumeSetup | undefined {
  checkContext(context);
  if (recheck !== undefined && typeof recheck !== "function") invalid("needs recheck to be a function");
  const byCall = requestsByCall(context.pending ?? []);
  const { byId, replayed } = resolutionsOf(resolutions);
  const found = openCallsOf(context.messages);
  const open = matchOpenCalls(found?.calls ?? [], byCall);
  const known = new Set(open.map((entry) => entry.request.id));
  const unmatched = [...byId.keys()].filter((id) => !known.has(id));
  if (found === undefined || open.length === 0) {
    // Resolutions that name no request are still reported, and nothing runs for them.
    if (unmatched.length === 0) return undefined;
    return { open: [], resolutions: byId, replayed, unmatched, inputs: {} };
  }
  return {
    message: found.message,
    open,
    resolutions: byId,
    replayed,
    unmatched,
    inputs: (context.pendingInputs ?? {}) as Readonly<Record<string, unknown>>,
    ...(recheck === undefined ? {} : { recheck: recheck as Recheck }),
  };
}

/** A resolution of the request's own kind, to check a stored request that no resolution names. */
function probeOf(request: SignedPendingRequest): Resolution {
  return request.kind === "clarification"
    ? { requestId: request.id, answer: "" }
    : { requestId: request.id, decision: "deny" };
}

function inputOf(inputs: Readonly<Record<string, unknown>>, id: string): unknown {
  return Object.hasOwn(inputs, id) ? inputs[id] : undefined;
}

/** What the checks need from the run. */
export interface JudgeContext {
  readonly signer: ApprovalSigner;
  send(body: AgentEventBody): void;
}

/**
 * Checks each waiting call's stored request and resolution, in model order, and decides what happens to the call.
 * Nothing runs here: the run acts on the verdicts afterwards.
 */
export async function judgeOpenCalls(resume: ResumeSetup, ctx: JudgeContext): Promise<Verdict[]> {
  const reject = (requestId: string, callId: string | undefined, cause: ResolutionRejectionCause) =>
    ctx.send({ type: "resolution_rejected", requestId, ...(callId === undefined ? {} : { callId }), cause });
  for (const id of resume.unmatched) reject(id, undefined, "unknown_request");
  const verdicts: Verdict[] = [];
  for (const { call, request } of resume.open) {
    if (resume.replayed.has(request.id)) {
      reject(request.id, call.callId, "replayed");
      verdicts.push({ kind: "reissue", call });
      continue;
    }
    const input = inputOf(resume.inputs, request.id);
    const resolution = resume.resolutions.get(request.id);
    const cause = await failedCheck(request, resolution ?? probeOf(request), call, input, ctx.signer);
    if (cause !== undefined) {
      reject(request.id, call.callId, cause);
      verdicts.push({ kind: "reissue", call });
    } else if (resolution === undefined) {
      verdicts.push({ kind: "wait", call, request, input });
    } else {
      verdicts.push(await verdictOf(call, request, resolution, input, resume.recheck, ctx));
    }
  }
  return verdicts;
}

/** Why the request or its resolution failed `verifyResolution()`, or `undefined` when both passed. */
async function failedCheck(
  request: SignedPendingRequest,
  resolution: Resolution,
  call: ToolCall,
  input: unknown,
  signer: ApprovalSigner,
): Promise<ResolutionRejectionCause | undefined> {
  try {
    const check = await verifyResolution(request, resolution, {
      signer,
      call: { callId: call.callId, tool: call.name, input },
    });
    return check.ok ? undefined : check.cause;
  } catch {
    // A custom signer whose verify() throws fails the check; its message may hold anything, so it isn't passed on.
    return "error";
  }
}

/** The verdict for a verified resolution. */
async function verdictOf(
  call: ToolCall,
  request: SignedPendingRequest,
  resolution: Resolution,
  input: unknown,
  recheck: Recheck | undefined,
  ctx: JudgeContext,
): Promise<Verdict> {
  const by = textOf(resolution.by);
  // The verified request's kind decides, never the resolution's fields: a resolution that carries both an `answer`
  // and a `decision` passes the check for either kind, and an approval must never take a host's text as its result.
  if (request.kind === "clarification") {
    const result: ToolResult = {
      content: [{ type: "text", text: (resolution as { answer: string }).answer }],
      details: { requestId: request.id, ...(by === undefined ? {} : { by }) },
    };
    return { kind: "result", call, result };
  }
  const decision = resolution as Extract<Resolution, { decision: unknown }>;
  if (decision.decision === "deny") {
    return { kind: "result", call, result: denied(call.name, textOf(decision.reason), request.id, by) };
  }
  const blocked = recheck === undefined ? undefined : await policyBlock(recheck, request, input, ctx);
  if (blocked !== undefined) {
    const text = fillTemplate(SDK_DEFAULTS.approvals.policyDenied, { tool: call.name, reason: blocked });
    const result: ToolResult = {
      content: [{ type: "text", text }],
      isError: true,
      details: { decision: "deny", requestId: request.id, policy: true },
    };
    return { kind: "result", call, result };
  }
  // The approved call runs with the input its request signs, never the transcript's arguments.
  return { kind: "run", call: { ...call, input } };
}

/** Why current policy blocks an approved call, or `undefined` when `recheck` allows it. Fails closed. */
async function policyBlock(
  recheck: Recheck,
  request: SignedPendingRequest,
  input: unknown,
  ctx: JudgeContext,
): Promise<string | undefined> {
  let answer: unknown;
  try {
    // Copies, so a callback that edits what it is handed can't change the input the run executes after the check. A
    // request or input that can't be copied fails the check closed.
    answer = await recheck(structuredClone(request), structuredClone(input));
  } catch (error) {
    ctx.send({ type: "hook_error", hook: "recheck", error: error instanceof Error ? error.message : String(error) });
    return "the policy check failed";
  }
  if (answer === "allow") return undefined;
  if (isObject(answer) && typeof answer.deny === "string" && answer.deny !== "") return answer.deny;
  return "the policy check did not allow it";
}
