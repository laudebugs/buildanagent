/**
 * `SafetyError`: the safety package's error for programmer errors, such as a write outcome with a malformed reason or
 * an input that has no canonical JSON form.
 */

/** Why a `SafetyError` was thrown. */
export type SafetyErrorCode = "invalid_outcome" | "invalid_input";

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
