/**
 * `HarnessError`: the harness's error for programmer errors and for a sandbox that can't do what it was asked. Two
 * subclasses keep their own names for the cases callers catch by class: `SandboxUnavailableError` and
 * `SandboxDeniedError`, both in `./sandbox`.
 */

/** Why a `HarnessError` was thrown. */
export type HarnessErrorCode =
  | "sandbox_unavailable"
  | "sandbox_denied"
  | "sandbox_disposed"
  | "unsafe_sandbox_not_acknowledged"
  | "invalid_sandbox_options"
  | "invalid_spawn_env";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const HARNESS_ERROR = Symbol.for("buildanagent.harness.HarnessError");

/**
 * Thrown for a mistake in how the harness is called, and for a sandbox that is unavailable or refuses a file
 * operation. `sandbox_unavailable`: a backend can't start (`SandboxUnavailableError`). `sandbox_denied`: the policy
 * refused a file read or write (`SandboxDeniedError`). `sandbox_disposed`: the sandbox was disposed before the call.
 * `unsafe_sandbox_not_acknowledged`: `noneSandbox()` was called without `unsafe: true`. `invalid_sandbox_options`: a
 * sandbox option, manifest or command is unusable. `invalid_spawn_env`: `spawnEnv()` was given a name or value that
 * can't be part of a clean environment.
 */
export class HarnessError extends Error {
  override readonly name: string = "HarnessError";
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, HARNESS_ERROR, { value: true });
  }
}

/** True for a `HarnessError`, including one from another copy of the package. */
export function isHarnessError(error: unknown): error is HarnessError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[HARNESS_ERROR] === true;
}
