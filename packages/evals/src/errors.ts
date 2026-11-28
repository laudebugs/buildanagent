/**
 * Why the evals refused their input. `invalid_row`: an `EvalRow` breaks one of its rules, such as `passed: null`
 * without an `unscored` reason. `duplicate_trial`: two rows of one harness, ablation and run name the same task and
 * trial. `invalid_option`: an option is out of range, such as a `k` below 1, or rows that must be one configuration
 * span several. `unfinished_session`: a session's last turn did not finish, so it has no outcome to report.
 * `invalid_session`: a session log cannot be read as a trial, because it holds a stop reason this package does not
 * know or ends a turn it never started.
 */
export type EvalsErrorCode =
  | "invalid_row"
  | "duplicate_trial"
  | "invalid_option"
  | "unfinished_session"
  | "invalid_session";

/** The error every `@buildanagent/evals` function throws. Read `code` to tell the causes apart. */
export class EvalsError extends Error {
  override readonly name: string = "EvalsError";
  readonly code: EvalsErrorCode;

  constructor(code: EvalsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, EVALS_ERROR, { value: true });
  }
}

// A symbol marker, as the protocol's error class uses, so a copy of this package from another bundle still matches.
const EVALS_ERROR = Symbol.for("@buildanagent/evals/EvalsError");

/** True for an `EvalsError`, including one from another copy of the package. */
export function isEvalsError(error: unknown): error is EvalsError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[EVALS_ERROR] === true;
}
