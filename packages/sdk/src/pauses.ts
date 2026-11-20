/**
 * Signed pauses (D5). The signers, the input hash and the pending record belong to the safety package; this file only
 * holds the one path the SDK signs through, which the loop and `createPendingRequest()` both call, so a pause the loop
 * writes and one built outside a run cannot drift apart.
 */
import { SdkError } from "./errors.js";
import type { Interceptors, MaybePromise } from "./hooks.js";
import {
  type PendingFields,
  type Resolution,
  type SignedPendingRequest,
  type SignPendingOptions,
  signPending,
} from "./vendor/agent-safety/pending.js";
import type { ApprovalSigner } from "./vendor/agent-safety/signer.js";

/** The fields of an approval request built outside a run: the call that waits, and why. */
export interface PendingRequestFields {
  /** Always `"approval"`: a request built outside a run waits for allow or deny. */
  readonly kind: "approval";
  /** The id of the tool call that waits. */
  readonly callId: string;
  /** The tool's name. */
  readonly tool: string;
  /** The call's input. The request stores its `canonicalInputHash()`, never the input itself. */
  readonly input: unknown;
  /** The version of the policy that asked for the approval, if the host versions its policy. It is signed. */
  readonly policyVersion?: string;
  /** Why the call needs a person, as shown to the approver. It is not signed. */
  readonly reason?: string;
}

/** The one call the SDK signs a pending request through, from the loop and from `createPendingRequest()`. */
export function signPause(
  fields: PendingFields,
  signer: ApprovalSigner,
  options: SignPendingOptions,
): Promise<SignedPendingRequest> {
  return signPending(fields, signer, options);
}

/** True when `signer` has the shape of an `ApprovalSigner`; its key material is never read or reported. */
export function isSigner(signer: unknown): signer is ApprovalSigner {
  if (typeof signer !== "object" || signer === null) return false;
  const { keyId, sign, verify } = signer as Partial<ApprovalSigner>;
  return typeof keyId === "string" && typeof sign === "function" && typeof verify === "function";
}

/**
 * Signs an approval request for a tool call outside a run, such as a call your own code wants to make, with the
 * payload a run writes when a gate returns `ask`: for the same fields, id and signer, the two requests and their
 * signatures are identical. Store the request, and check a person's answer against it before the call runs.
 *
 * `options.generateId` makes the request's id (default `crypto.randomUUID()`) and `options.now` its `createdAt`
 * (default the current time). Rejects with an `SdkError` with code `invalid_run_options` for a `kind` other than
 * `"approval"` or a signer that isn't an `ApprovalSigner`, and with a `SafetyError` with code `invalid_pending` for a
 * blank field or `invalid_input` for an input with no canonical JSON form.
 */
export function createPendingRequest(
  fields: PendingRequestFields,
  signer: ApprovalSigner,
  options: SignPendingOptions = {},
): Promise<SignedPendingRequest> {
  if (fields?.kind !== "approval") {
    return Promise.reject(
      new SdkError("invalid_run_options", `createPendingRequest() signs approvals only, so kind must be "approval"`),
    );
  }
  if (!isSigner(signer)) {
    return Promise.reject(
      new SdkError("invalid_run_options", "createPendingRequest() needs an ApprovalSigner, such as hmacSigner()"),
    );
  }
  const { kind, callId, tool, input, policyVersion, reason } = fields;
  return signPause(
    {
      kind,
      callId,
      tool,
      input,
      ...(policyVersion === undefined ? {} : { policyVersion }),
      ...(reason === undefined ? {} : { reason }),
    },
    signer,
    options,
  );
}

/** What a blocking approval handler receives besides the request: the input it signs, and the run's abort signal. */
export interface ApprovalDetails {
  /** The input the request signs and the call runs with once allowed. Show the approver this input. */
  readonly input: unknown;
  /** Fires when the run is aborted; the call then doesn't run, whatever the handler answers. */
  readonly signal: AbortSignal;
}

/** Answers one approval request while the run waits: return `{ requestId: request.id, decision }`. */
export type ApprovalHandler = (request: SignedPendingRequest, details: ApprovalDetails) => MaybePromise<Resolution>;

// The handler travels on an interceptors object under this key, so it joins with `composeInterceptors()` and a
// spread, and the six hook moments stay as they are.
const BLOCKING_HANDLER = Symbol("buildanagent.sdk.blockingApprovals");

/** The blocking approval handler an interceptors object carries, if it carries one. */
export function blockingHandlerOf(interceptors: Interceptors): ApprovalHandler | undefined {
  const handler: unknown = (interceptors as Record<symbol, unknown>)[BLOCKING_HANDLER];
  if (handler === undefined) return undefined;
  if (typeof handler !== "function") {
    throw new SdkError("invalid_run_options", "the blockingApprovals() handler must be a function");
  }
  return handler as ApprovalHandler;
}

/** An interceptors object that carries `handler`, for `blockingApprovals()` and `composeInterceptors()`. */
export function withBlockingHandler(interceptors: Interceptors, handler: ApprovalHandler): Interceptors {
  return { ...interceptors, [BLOCKING_HANDLER]: handler } as Interceptors;
}

/**
 * Answers approvals inside the run, for a host where the person answers while the process waits, such as a terminal.
 * Join the result with your gate in `composeInterceptors()`, or spread it into your interceptors. When a gate returns
 * `ask`, the run signs the pending request and emits `approval_request` first, so a crash while it waits still
 * leaves a signed record to resume from. It then calls `handler` and waits for its answer. A `Resolution` with
 * `decision: "allow"` runs the call with the input the request signs, and `"deny"` gives the model an error result
 * with the reason. An answer that doesn't name the request, isn't allow or deny, or comes from a handler that throws
 * denies the call and emits `hook_error`, whatever `onFailure` says, and an abort while the run waits denies it too.
 * A question from `clarificationTool()` still ends the run `clarification_requested`.
 *
 * Use it only where the run and the person share a process. Anywhere else, let the run end `awaiting_approval` and
 * resume it with `continueRun()`. Throws an `SdkError` with code `invalid_run_options` when `handler` isn't a
 * function.
 */
export function blockingApprovals(handler: ApprovalHandler): Interceptors {
  if (typeof handler !== "function") {
    throw new SdkError("invalid_run_options", "blockingApprovals() needs a function that answers each request");
  }
  return withBlockingHandler({}, handler);
}
