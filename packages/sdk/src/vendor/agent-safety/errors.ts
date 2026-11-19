/**
 * `SafetyError`: the safety package's error for programmer errors, such as a write outcome with a malformed reason, an
 * input that has no canonical JSON form, a key ring that can't sign, or a model request that would use a credential
 * nobody configured.
 */

/**
 * Why a `SafetyError` was thrown. `invalid_outcome`: a write outcome breaks a rule. `invalid_input`: a tool input has
 * no canonical JSON form, or a tool's context fails its `contextSchema`. `invalid_key_ring`: a signer's keys or key
 * ids can't be used. `invalid_pending`: the fields of a pending request can't be signed. `invalid_byok_config`: a
 * model provider's key or base URL is empty, malformed or points at a gateway that may bill another credential.
 * `egress_refused`: a model request would leave for another host or carry another credential. `default_provider`: code
 * resolved a string model id, or another default provider is set, so a call could reach a gateway nobody configured.
 */
export type SafetyErrorCode =
  | "invalid_outcome"
  | "invalid_input"
  | "invalid_key_ring"
  | "invalid_pending"
  | "invalid_byok_config"
  | "egress_refused"
  | "default_provider";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const SAFETY_ERROR = Symbol.for("buildanagent.agent-safety.SafetyError");

/** Thrown for a mistake in how the safety package is called. A write that fails is an outcome, never this error. */
export class SafetyError extends Error {
  override readonly name = "SafetyError";
  readonly code: SafetyErrorCode;

  constructor(code: SafetyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, SAFETY_ERROR, { value: true });
  }
}

/** True for a `SafetyError`, including one from another copy of the package. */
export function isSafetyError(error: unknown): error is SafetyError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[SAFETY_ERROR] === true;
}
