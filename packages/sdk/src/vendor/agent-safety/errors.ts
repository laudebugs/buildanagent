/**
 * `SafetyError`: the safety package's error for programmer errors, such as a write outcome with a malformed reason, an
 * input that has no canonical JSON form, a key ring that can't sign, or a model request that would use a credential
 * nobody configured. Its subclass `BudgetExceeded`, in the `./cost` subpath, is the refusal of a model call that would
 * pass a USD cap.
 */

/**
 * Why a `SafetyError` was thrown. `invalid_outcome`: a write outcome breaks a rule. `invalid_input`: a tool input has
 * no canonical JSON form, or a tool's context fails its `contextSchema`. `invalid_key_ring`: a signer's keys or key
 * ids can't be used. `invalid_pending`: the fields of a pending request can't be signed. `invalid_byok_config`: a
 * model provider's key or base URL is empty, malformed or points at a gateway that may bill another credential.
 * `egress_refused`: a model request would leave for another host or carry another credential. `default_provider`: code
 * resolved a string model id, or another default provider is set, so a call could reach a gateway nobody configured.
 * `invalid_effect`: a guarded write's scope, business key or options break a rule. `invalid_budget`: a cost guard's
 * cap is not a finite number of dollars, 0 or more. `budget_exceeded`: a model call was refused before it was sent,
 * because what the run or session has spent plus the call's projected cost would pass its USD cap. `unknown_price`: a
 * model call was refused before it was sent, because the model has no catalog price or an earlier call reported no
 * usage, so the cap can't be checked.
 */
export type SafetyErrorCode =
  | "invalid_outcome"
  | "invalid_input"
  | "invalid_key_ring"
  | "invalid_pending"
  | "invalid_byok_config"
  | "egress_refused"
  | "default_provider"
  | "invalid_effect"
  | "invalid_budget"
  | "budget_exceeded"
  | "unknown_price";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const SAFETY_ERROR = Symbol.for("buildanagent.agent-safety.SafetyError");

/**
 * Thrown for a mistake in how the safety package is called, and, as its subclass `BudgetExceeded`, for a model call
 * refused under a USD cap. A write that fails is an outcome, never this error.
 */
export class SafetyError extends Error {
  override readonly name: string = "SafetyError";
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
