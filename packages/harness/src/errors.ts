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
  | "sandbox_not_found"
  | "unsafe_sandbox_not_acknowledged"
  | "invalid_sandbox_options"
  | "invalid_spawn_env"
  | "duplicate_tool"
  | "invalid_tool_registration"
  | "invalid_permission_config"
  | "invalid_lock_options"
  | "session_conflict"
  | "entry_too_large"
  | "invalid_session_entry"
  | "invalid_session_key"
  | "session_corrupt";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const HARNESS_ERROR = Symbol.for("buildanagent.harness.HarnessError");

/**
 * Thrown for a mistake in how the harness is called, and for a sandbox that is unavailable or refuses a file
 * operation. `sandbox_unavailable`: a backend can't start (`SandboxUnavailableError`). `sandbox_denied`: the policy
 * refused a file read or write (`SandboxDeniedError`). `sandbox_disposed`: the sandbox was disposed before the call.
 * `unsafe_sandbox_not_acknowledged`: `noneSandbox()` was called without `unsafe: true`. `invalid_sandbox_options`: a
 * sandbox option, manifest or command is unusable. `invalid_spawn_env`: `spawnEnv()` was given a name or value that
 * can't be part of a clean environment. `duplicate_tool`: a tool registry already holds a tool or alias by that name
 * (`DuplicateToolError`). `invalid_tool_registration`: a tool registration or a registry option is unusable, such as a
 * name that breaks the canonical rule or an unknown source. `invalid_permission_config`: an allow rule makes the host
 * callback unreachable (`PermissionConfigError`). `invalid_lock_options`: a file lock was given a lease or host it can't use. `session_conflict`: an append found the log in a state it did not
 * expect (`ConflictError`). `entry_too_large`: an entry is over the store's size bound (`EntryTooLargeError`).
 * `invalid_session_entry`: an entry is not valid or is out of place, such as a first entry that is not a header.
 * `invalid_session_key`: a user or session id the store can't use. `session_corrupt`: a log file has a bad line before
 * its last line.
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
