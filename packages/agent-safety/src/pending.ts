/**
 * The signed pending request: what an agent stores when a tool call waits for a person, and what it checks before the
 * call runs. The signature covers D5's six fields in D5's order (request id, kind, call id, tool name, input hash and
 * the optional policy version), so a stored pause whose call, tool or input changed no longer verifies. The shapes
 * match build-sdk.md §3.3 field for field, because our SDK re-exports them.
 */
import { constantTimeEqual } from "./bytes.js";
import { SafetyError } from "./errors.js";
import { canonicalInputHash } from "./hash.js";
import type { ApprovalSigner } from "./signer.js";

/**
 * A pause waiting for a person: an approval of one tool call, or a question about it. `signature` signs `id`, `kind`,
 * `callId`, `tool`, `inputHash` and `policyVersion` under the key `keyId` names. `question`, `reason` and `createdAt`
 * are shown to people and aren't signed, so never let them decide anything.
 */
export interface SignedPendingRequest {
  /** The request's own id, which a `Resolution` names. */
  id: string;
  /** `approval` waits for allow or deny; `clarification` waits for an answer. */
  kind: "approval" | "clarification";
  /** The id of the tool call that waits. */
  callId: string;
  /** The tool's name. */
  tool: string;
  /** `canonicalInputHash()` of the call's input. */
  inputHash: string;
  /** The version of the policy that asked for the pause, if the host versions its policy. */
  policyVersion?: string;
  /**
   * `canonicalInputHash()` of the app data the run held when it paused, such as the signed-in customer, when it held
   * any. The signature covers it, so the call runs only for the caller whose app data the host passes back. A request
   * without it, such as one signed before this field existed, binds no app data.
   */
  appHash?: string;
  /** The question a clarification asks. */
  question?: string;
  /** Why the call needs a person, as shown to the approver. */
  reason?: string;
  /** The id of the key that made `signature`. */
  keyId: string;
  /** The signature, as base64url. */
  signature: string;
  /** When the request was signed, as an ISO 8601 timestamp. */
  createdAt: string;
}

/** A person's answer to a pending request: allow or deny for an approval, an answer for a clarification. */
export type Resolution =
  | { requestId: string; decision: "allow" | "deny"; reason?: string; by?: string }
  | { requestId: string; answer: string; by?: string };

/** The fields `signPending()` signs and stores, with the call's input in place of its hash. */
export interface PendingFields {
  readonly kind: "approval" | "clarification";
  readonly callId: string;
  readonly tool: string;
  /** The tool call's input. `signPending()` stores its `canonicalInputHash()`, never the input itself. */
  readonly input: unknown;
  readonly policyVersion?: string;
  /** `canonicalInputHash()` of the caller's app data, which `signPending()` signs and stores as it is. */
  readonly appHash?: string;
  readonly question?: string;
  readonly reason?: string;
}

/** Where `signPending()` takes its request id and time from. Tests pass fixed ones. */
export interface SignPendingOptions {
  /** Returns a fresh request id. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: () => string;
  /** Returns the current time. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

/** The call a host is about to run, which a pending request must match before it runs. */
export interface PendingCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: unknown;
}

/**
 * Why `verifyResolution()` refused. `malformed`: the stored request isn't a well-formed pending request.
 * `unknown_request`: the resolution names another request. `signature_invalid`: the signature is wrong, or its key id
 * isn't in the ring. `call_mismatch`: the call id or tool differs from the call about to run. `input_changed`: the
 * input differs from the one that was signed. `app_mismatch`: the request is bound to app data, and the host passed
 * none or other data. `resolution_mismatch`: the resolution doesn't fit the request's kind.
 */
export type RejectionCause =
  | "malformed"
  | "unknown_request"
  | "signature_invalid"
  | "call_mismatch"
  | "input_changed"
  | "app_mismatch"
  | "resolution_mismatch";

/** What `verifyResolution()` returns: the resolution, once every check passed, or why it refused. */
export type ResolutionCheck =
  | { readonly ok: true; readonly resolution: Resolution }
  | { readonly ok: false; readonly cause: RejectionCause };

/** The options of `verifyResolution()`. */
export interface VerifyResolutionOptions {
  /** A signer that holds the key the request names. */
  readonly signer: ApprovalSigner;
  /** The call about to run, as the host has it now, not as the pending request records it. */
  readonly call: PendingCall;
  /**
   * `canonicalInputHash()` of the app data the host has now. A request that is bound to app data is refused with
   * `app_mismatch` unless this equals the bound hash, so leaving it out refuses a bound request. A request that binds
   * none ignores it.
   */
  readonly appHash?: string;
}

// Ties a signature to this record and its layout, so it can't verify as some other signed record of this package. A
// request with no app hash keeps the first layout, so every request signed before the hash existed still verifies; a
// request with one signs a second layout that adds it, which a reader of the first layout refuses.
const PAYLOAD_TAG = "buildanagent.pending.v1";
const APP_PAYLOAD_TAG = "buildanagent.pending.v2";
const KINDS: readonly string[] = ["approval", "clarification"];
const INPUT_HASH = /^[0-9a-f]{64}$/;
const ENCODER = new TextEncoder();

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.isWellFormed();
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || isText(value);
}

/** True when `value` has the shape of a pending request; a store's record is untrusted until this and the signature pass. */
function isWellFormed(value: unknown): value is SignedPendingRequest {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    [p.id, p.callId, p.tool, p.keyId, p.signature, p.createdAt].every(isText) &&
    KINDS.includes(p.kind as string) &&
    typeof p.inputHash === "string" &&
    INPUT_HASH.test(p.inputHash) &&
    [p.policyVersion, p.question, p.reason].every(isOptionalText) &&
    (p.appHash === undefined || (typeof p.appHash === "string" && INPUT_HASH.test(p.appHash)))
  );
}

/**
 * The bytes a pending request's signature covers: a JSON array of a fixed tag, then the request id, kind, call id,
 * tool name, input hash and policy version, in that order, with `null` for an absent policy version. A request bound
 * to app data signs a second tag and adds the app hash last. Every field is a well-formed string, so `JSON.stringify`
 * writes the same bytes on every runtime.
 */
export function pendingPayload(
  fields: Pick<SignedPendingRequest, "id" | "kind" | "callId" | "tool" | "inputHash" | "policyVersion" | "appHash">,
): Uint8Array {
  const { id, kind, callId, tool, inputHash, policyVersion, appHash } = fields;
  const head = [id, kind, callId, tool, inputHash, policyVersion ?? null];
  const payload = appHash === undefined ? [PAYLOAD_TAG, ...head] : [APP_PAYLOAD_TAG, ...head, appHash];
  return ENCODER.encode(JSON.stringify(payload));
}

function checkFields(fields: PendingFields, id: unknown): void {
  const bad = (what: string) => new SafetyError("invalid_pending", `a pending request's ${what}`);
  if (!isText(id)) throw bad("id must be a non-empty, well-formed string");
  if (!KINDS.includes(fields.kind)) throw bad(`kind must be "approval" or "clarification"`);
  for (const field of ["callId", "tool"] as const) {
    if (!isText(fields[field])) throw bad(`${field} must be a non-empty, well-formed string`);
  }
  for (const field of ["policyVersion", "question", "reason"] as const) {
    if (!isOptionalText(fields[field])) throw bad(`${field} must be a non-empty, well-formed string when it is set`);
  }
  if (fields.appHash !== undefined && !(typeof fields.appHash === "string" && INPUT_HASH.test(fields.appHash))) {
    throw bad("appHash must be 64 lowercase hex digits when it is set");
  }
}

/**
 * Signs a pending request for a tool call. It hashes the input with `canonicalInputHash()`, signs the fields
 * `pendingPayload()` lists with the signer's current key, and returns the request to store. The input itself isn't stored.
 *
 * Throws a `SafetyError`, code `invalid_pending`, for a blank or malformed field, and code `invalid_input` for an
 * input with no canonical JSON form.
 */
export async function signPending(
  fields: PendingFields,
  signer: ApprovalSigner,
  options: SignPendingOptions = {},
): Promise<SignedPendingRequest> {
  const id = (options.generateId ?? (() => crypto.randomUUID()))();
  checkFields(fields, id);
  const inputHash = await canonicalInputHash(fields.input);
  const signed = { id, kind: fields.kind, callId: fields.callId, tool: fields.tool, inputHash };
  const withPolicy = fields.policyVersion === undefined ? signed : { ...signed, policyVersion: fields.policyVersion };
  const bound = fields.appHash === undefined ? withPolicy : { ...withPolicy, appHash: fields.appHash };
  const signature = await signer.sign(pendingPayload(bound));
  return {
    ...bound,
    ...(fields.question === undefined ? {} : { question: fields.question }),
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
    keyId: signer.keyId,
    signature,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

function fitsKind(pending: SignedPendingRequest, resolution: Resolution): boolean {
  if (pending.kind === "approval") {
    return "decision" in resolution && (resolution.decision === "allow" || resolution.decision === "deny");
  }
  return "answer" in resolution && typeof resolution.answer === "string";
}

/** A request bound to app data needs the host's app hash to equal it; a request that binds none accepts any. */
function appMatches(pending: SignedPendingRequest, appHash: string | undefined): boolean {
  if (pending.appHash === undefined) return true;
  return appHash !== undefined && constantTimeEqual(ENCODER.encode(appHash), ENCODER.encode(pending.appHash));
}

async function inputMatches(pending: SignedPendingRequest, input: unknown): Promise<boolean> {
  try {
    return constantTimeEqual(ENCODER.encode(await canonicalInputHash(input)), ENCODER.encode(pending.inputHash));
  } catch {
    // An input with no canonical form can't be the one that was signed, which had one.
    return false;
  }
}

/**
 * Checks a resolution against its stored pending request before the call runs, failing closed. It accepts only when
 * the request is well formed, the resolution names it, the signature verifies under a key the signer holds, the call
 * id and tool match the call about to run, that call's input hashes to the signed hash, and the resolution fits the
 * request's kind. Otherwise it returns `ok: false` with the first cause it found, and never throws for bad input.
 *
 * A passing check says the request is authentic and unchanged. It doesn't say current policy still allows the call:
 * check that separately, just before the call runs.
 */
export async function verifyResolution(
  pending: unknown,
  resolution: Resolution,
  options: VerifyResolutionOptions,
): Promise<ResolutionCheck> {
  if (!isWellFormed(pending)) return { ok: false, cause: "malformed" };
  if (typeof resolution !== "object" || resolution === null || resolution.requestId !== pending.id) {
    return { ok: false, cause: "unknown_request" };
  }
  // The signature comes first: until it verifies, no other field of the stored request is trusted.
  if (!(await options.signer.verify(pending.keyId, pendingPayload(pending), pending.signature))) {
    return { ok: false, cause: "signature_invalid" };
  }
  const { call } = options;
  if (call.callId !== pending.callId || call.tool !== pending.tool) return { ok: false, cause: "call_mismatch" };
  if (!(await inputMatches(pending, call.input))) return { ok: false, cause: "input_changed" };
  if (!appMatches(pending, options.appHash)) return { ok: false, cause: "app_mismatch" };
  if (!fitsKind(pending, resolution)) return { ok: false, cause: "resolution_mismatch" };
  return { ok: true, resolution };
}

/**
 * Runs current policy for an approved call just before it runs, after its pending request has verified. Resolve to
 * `"allow"` to let the call run, or to `{ deny }` with a reason the model reads, so a policy that changed since the
 * pause can still stop the call.
 */
export type Recheck = (pending: SignedPendingRequest, input: unknown) => Promise<"allow" | { deny: string }>;
