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
  | "sandbox_io_failed"
  | "unsafe_sandbox_not_acknowledged"
  | "invalid_sandbox_options"
  | "invalid_spawn_env"
  | "duplicate_tool"
  | "invalid_tool_registration"
  | "invalid_permission_config"
  | "invalid_lock_options"
  | "session_locked"
  | "session_read_only"
  | "entry_not_found"
  | "unsupported_format"
  | "invalid_turn_options"
  | "approval_not_pending"
  | "approval_unavailable"
  | "invalid_key_store"
  | "session_conflict"
  | "entry_too_large"
  | "invalid_session_entry"
  | "invalid_session_key"
  | "session_corrupt";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const HARNESS_ERROR = Symbol.for("buildanagent.harness.HarnessError");

/**
 * Thrown for a mistake in how the harness is called, and for a sandbox that is unavailable or refuses a file operation.
 * `sandbox_unavailable`: a backend can't start (`SandboxUnavailableError`). `sandbox_denied`: the policy refused a file
 * read or write (`SandboxDeniedError`). `sandbox_disposed`: the sandbox was disposed before the call.
 * `sandbox_not_found`: a file to read doesn't exist. `sandbox_io_failed`: a file call failed for a reason that is
 * neither a missing file nor a denial. `unsafe_sandbox_not_acknowledged`: `noneSandbox()` was called without `unsafe:
 * true`. `invalid_sandbox_options`: a sandbox option, manifest or command is unusable. `invalid_spawn_env`:
 * `spawnEnv()` was given a name or value that can't be part of a clean environment. `duplicate_tool`: a tool registry
 * already holds a tool or alias by that name (`DuplicateToolError`). `invalid_tool_registration`: a tool registration
 * or a registry option is unusable, such as a name that breaks the canonical rule or an unknown source.
 * `invalid_permission_config`: an allow rule makes the host callback unreachable (`PermissionConfigError`).
 * `invalid_lock_options`: a file lock was given a lease, renewal interval or host name it can't use. `session_locked`:
 * another writer holds the session. `session_read_only`: a session opened without a lock was asked to write.
 * `entry_not_found`: an entry id is in no file of the session. `unsupported_format`: a session file's format can't be
 * read or migrated, its header names none, or the store can't read it as written. `invalid_turn_options`: a turn's
 * options can't be used, such as a tool allowlist that names a tool the registry lacks, or a hook that changed the
 * model inside a turn. `approval_not_pending`: a resolution names a request that is not waiting.
 * `approval_unavailable`: the harness has no signer, so no approval can be checked. `invalid_key_store`: a key file is
 * unreadable, malformed or readable by others. `session_conflict`: an append found the log in a state it did not expect
 * (`ConflictError`). `entry_too_large`: an entry is over the store's size bound (`EntryTooLargeError`).
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
