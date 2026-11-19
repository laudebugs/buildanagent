/**
 * `signedToolApproval()`: signed, fail-closed approvals over the AI SDK's call-level `toolApproval`. In `ai` 7.0.162,
 * `generateText` and `streamText` call `toolApproval` once when a call is first seen, and again, inside
 * `validateApprovedToolApprovals`, for every approved call in the incoming history before its `execute` runs. The
 * adapter signs a pending request on the first call and verifies it on the second, then re-runs current policy, so a
 * forged, stale or changed approval runs nothing. Cloudflare's `AIChatAgent` passes the same `toolApproval` to its own
 * `streamText`, so one adapter serves both. The `ai` imports are type-only, so this subpath loads without `ai`.
 */
import type { ModelMessage, ToolApprovalConfiguration, ToolApprovalStatus, ToolSet } from "ai";
import { writeOutcome } from "../outcome.js";
import {
  type Recheck,
  type RejectionCause,
  type SignedPendingRequest,
  signPending,
  verifyResolution,
} from "../pending.js";
import type { PendingStore } from "../pending-store.js";
import { renderOutcome } from "../render.js";
import type { ApprovalSigner } from "../signer.js";

/**
 * Why `signedToolApproval()` denied an approved call: one of `verifyResolution()`'s causes, `unknown_request` when
 * the store holds no pending request for the call, `policy_denied` when current policy or `recheck` said no, or
 * `error` when a step threw.
 */
export type ApprovalRejectionCause = RejectionCause | "policy_denied" | "error";

/** What `onRejected` receives when an approved call is denied. It holds no key material. */
export interface ApprovalRejection {
  readonly callId: string;
  readonly tool: string;
  readonly cause: ApprovalRejectionCause;
  /** The pending request's id, when the store held one. */
  readonly requestId?: string;
  /** What threw, for the cause `error`. */
  readonly error?: unknown;
}

/** The options of `signedToolApproval()`. */
export interface SignedToolApprovalOptions<TOOLS extends ToolSet, RUNTIME_CONTEXT> {
  /** Signs each pause and verifies it on resume. On a serverless host, use `hmacSigner()` over a persistent ring. */
  readonly signer: ApprovalSigner;
  /** Holds each pause until its resume. It must outlive the process when a pause may resume elsewhere. */
  readonly store: PendingStore;
  /**
   * Which calls need a person: the same value you would pass as `toolApproval`. A tool's own `needsApproval` still
   * applies when this policy has nothing to say about the tool.
   */
  readonly policy: ToolApprovalConfiguration<TOOLS, RUNTIME_CONTEXT>;
  /** Runs current policy just before an approved call runs, and can turn the approval into a denial. */
  readonly recheck: Recheck;
  /** The version of your policy, signed into each pause so `recheck` can tell a pause made under an older one. */
  readonly policyVersion?: string | (() => string | Promise<string>);
  /**
   * Called when an approved call is denied, with the cause, for your audit log. The adapter awaits what it returns,
   * and if it throws, the error propagates and the call still does not run.
   */
  readonly onRejected?: (rejection: ApprovalRejection) => unknown;
  /** Returns a fresh pending request id. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: () => string;
  /** Returns the current time. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

// The loose shapes the adapter reads. `ai` types them per tool set, which this file can't name without its generics.
interface Call {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}
interface ApprovalArgs {
  readonly toolCall: Call;
  readonly tools: Readonly<Record<string, { readonly needsApproval?: unknown }>> | undefined;
  readonly toolsContext: Readonly<Record<string, unknown>> | undefined;
  readonly runtimeContext: unknown;
  readonly messages: readonly ModelMessage[];
}
type Status = Exclude<ToolApprovalStatus, string | undefined>;
type PolicyFunction = (...args: unknown[]) => unknown;

function normalize(status: unknown): Status {
  if (status === undefined) return { type: "not-applicable" };
  if (typeof status === "string") return { type: status } as Status;
  return status as Status;
}

async function deprecatedNeedsApproval(args: ApprovalArgs): Promise<boolean> {
  const { toolCall, tools, toolsContext, messages } = args;
  const tool = tools !== undefined && Object.hasOwn(tools, toolCall.toolName) ? tools[toolCall.toolName] : undefined;
  const needs = tool?.needsApproval;
  if (typeof needs !== "function") return needs === true;
  const context = toolsContext?.[toolCall.toolName];
  return (
    (await (needs as PolicyFunction)(toolCall.input, { toolCallId: toolCall.toolCallId, messages, context })) === true
  );
}

/** The status the policy gives a call now. With a generic function as `toolApproval`, `ai` skips `needsApproval`, so the adapter applies it. */
async function policyStatus(policy: unknown, args: ApprovalArgs): Promise<Status> {
  const { toolCall } = args;
  let status: Status;
  if (typeof policy === "function") {
    status = normalize(await (policy as PolicyFunction)(args));
  } else {
    const entries = (policy ?? {}) as Record<string, unknown>;
    const entry = Object.hasOwn(entries, toolCall.toolName) ? entries[toolCall.toolName] : undefined;
    const options = {
      toolCallId: toolCall.toolCallId,
      messages: args.messages,
      toolContext: args.toolsContext?.[toolCall.toolName],
      runtimeContext: args.runtimeContext,
    };
    status = normalize(typeof entry === "function" ? await (entry as PolicyFunction)(toolCall.input, options) : entry);
  }
  if (status.type === "not-applicable" && (await deprecatedNeedsApproval(args))) return { type: "user-approval" };
  return status;
}

/** True when the history ends with an approval of this call: the moment `ai` asks again before running it. */
function isApprovedResume(messages: readonly ModelMessage[], callId: string): boolean {
  const last = messages.at(-1);
  if (last?.role !== "tool") return false;
  const requests = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-approval-request" && part.toolCallId === callId) requests.add(part.approvalId);
    }
  }
  return last.content.some(
    (part) => part.type === "tool-approval-response" && part.approved && requests.has(part.approvalId),
  );
}

const NOT_VERIFIED_NEXT = "Call the tool again to ask for a new approval, or tell the user that it did not run";

/**
 * A denial the model can act on: a rendered `not_applied` outcome as the denial's reason, in the same shape as
 * `toAiToolResult()`'s value, so the sentence and the payload both reach the model.
 */
function denial(tool: string, reason: "APPROVAL_NOT_VERIFIED" | "POLICY_DENIED", next: string): ToolApprovalStatus {
  try {
    const retry = reason === "POLICY_DENIED" ? "never" : "same_key";
    const outcome = writeOutcome({ kind: "not_applied", operation: tool, reason, next, retry });
    const { text, payload } = renderOutcome(outcome);
    return { type: "denied", reason: JSON.stringify({ message: text, ...payload }) };
  } catch {
    // A tool name writeOutcome() refuses as an operation still gets a denial; only the wording is plainer.
    return { type: "denied", reason: `The call did not run, and nothing changed. Next: ${next}.` };
  }
}

interface Resume {
  readonly options: SignedToolApprovalOptions<ToolSet, unknown>;
  readonly args: ApprovalArgs;
  readonly reject: (cause: ApprovalRejectionCause, extra?: Partial<ApprovalRejection>) => Promise<ToolApprovalStatus>;
}

type Verified =
  | { readonly ok: true; readonly pending: SignedPendingRequest }
  | { readonly ok: false; readonly status: ToolApprovalStatus };

async function verifyStored({ options, args, reject }: Resume): Promise<Verified> {
  const { toolCall } = args;
  const pending = await options.store.take(toolCall.toolCallId);
  if (pending === undefined) return { ok: false, status: await reject("unknown_request") };
  const call = { callId: toolCall.toolCallId, tool: toolCall.toolName, input: toolCall.input };
  const check = await verifyResolution(
    pending,
    { requestId: pending.id, decision: "allow" },
    { signer: options.signer, call },
  );
  if (!check.ok) return { ok: false, status: await reject(check.cause, { requestId: pending.id }) };
  return { ok: true, pending };
}

/** The second call for an approved call: verify, re-run current policy, then `recheck`. Every failure denies. */
async function resume(context: Resume): Promise<ToolApprovalStatus> {
  const { options, args } = context;
  const stored = await verifyStored(context);
  if (!stored.ok) return stored.status;
  const verified = stored.pending;
  const now = await policyStatus(options.policy, args);
  const policyDeny = now.type === "denied" ? (now.reason ?? "the approval policy now denies this call") : undefined;
  const recheck = policyDeny === undefined ? await options.recheck(verified, args.toolCall.input) : undefined;
  const deny = policyDeny ?? (typeof recheck === "object" && recheck !== null ? recheck.deny : undefined);
  if (deny !== undefined || recheck !== "allow") {
    const why = deny ?? "the policy check did not allow it";
    await options.onRejected?.({
      callId: args.toolCall.toolCallId,
      tool: args.toolCall.toolName,
      cause: "policy_denied",
      requestId: verified.id,
    });
    return denial(
      args.toolCall.toolName,
      "POLICY_DENIED",
      `Tell the user that current policy blocks this call: ${why}`,
    );
  }
  // `ai` runs a call whose status here is anything but `denied`, so only a full pass returns `approved`.
  return { type: "approved" };
}

/** The first call: ask the policy, and sign and store a pending request when it wants a person. */
async function pause(options: SignedToolApprovalOptions<ToolSet, unknown>, args: ApprovalArgs): Promise<Status> {
  const status = await policyStatus(options.policy, args);
  if (status.type !== "user-approval") return status;
  const { toolCall } = args;
  const version = typeof options.policyVersion === "function" ? await options.policyVersion() : options.policyVersion;
  const pending = await signPending(
    {
      kind: "approval",
      callId: toolCall.toolCallId,
      tool: toolCall.toolName,
      input: toolCall.input,
      ...(version === undefined ? {} : { policyVersion: version }),
      ...(status.reason === undefined ? {} : { reason: status.reason }),
    },
    options.signer,
    { ...(options.generateId ? { generateId: options.generateId } : {}), ...(options.now ? { now: options.now } : {}) },
  );
  await options.store.put(pending);
  return status;
}

/**
 * Wraps an approval policy so every approval is signed, fails closed on resume, and is checked against current policy
 * before the approved call runs. Pass the result as `toolApproval` to `generateText`, `streamText` or a
 * `ToolLoopAgent`, or to the `streamText` in a Cloudflare `AIChatAgent`'s `onChatMessage`.
 *
 * When `policy` asks for a person, the adapter signs a pending request for the call and stores it by call id. When
 * the call comes back approved, it takes that request from the store and runs it only if the request verifies, the
 * call's id, tool and input match it, `policy` doesn't deny the call now, and `recheck` allows it. Otherwise the call
 * is denied: its `execute` never runs, and the model reads a `not_applied` outcome that says why and what to do
 * next. A pending request is used once, so a replayed approval is denied too.
 *
 * Keep the AI SDK's own `experimental_toolApprovalSecret` set as well. It is a second check, and it throws
 * `InvalidToolApprovalSignatureError` for a bad signature instead of denying the call.
 */
export function signedToolApproval<TOOLS extends ToolSet, RUNTIME_CONTEXT = unknown>(
  options: SignedToolApprovalOptions<TOOLS, RUNTIME_CONTEXT>,
): ToolApprovalConfiguration<TOOLS, RUNTIME_CONTEXT> {
  // The policy is only ever called with the arguments `ai` gave the adapter, so erasing its generics loses nothing.
  const loose = options as unknown as SignedToolApprovalOptions<ToolSet, unknown>;
  const approve = async (args: ApprovalArgs): Promise<ToolApprovalStatus> => {
    const { toolCallId: callId, toolName: tool } = args.toolCall;
    const reject = async (cause: ApprovalRejectionCause, extra: Partial<ApprovalRejection> = {}) => {
      await loose.onRejected?.({ callId, tool, cause, ...extra });
      return denial(tool, "APPROVAL_NOT_VERIFIED", NOT_VERIFIED_NEXT);
    };
    if (!isApprovedResume(args.messages, callId)) return pause(loose, args);
    try {
      return await resume({ options: loose, args, reject });
    } catch (error) {
      // Fail closed: a store, signer, policy or recheck that throws denies the call instead of letting it run.
      return reject("error", { error });
    }
  };
  // `ai` accepts a generic approval function for any tool set; its parameter type names the set's generics.
  return approve as unknown as ToolApprovalConfiguration<TOOLS, RUNTIME_CONTEXT>;
}
