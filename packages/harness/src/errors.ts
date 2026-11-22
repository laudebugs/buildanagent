/**
 * `HarnessError`: the harness's error for programmer errors and for a sandbox that can't do what it was asked. Four
 * subclasses keep their own names for the cases callers catch by class: `SandboxUnavailableError`,
 * `SandboxDeniedError`, `SandboxPolicyMismatchError` and `SandboxUnsupportedError`, all in `./sandbox`.
 */

/** Why a `HarnessError` was thrown. */
export type HarnessErrorCode =
  | "sandbox_unavailable"
  | "sandbox_denied"
  | "sandbox_disposed"
  | "sandbox_not_found"
  | "sandbox_io_failed"
  | "sandbox_policy_mismatch"
  | "sandbox_unsupported"
  | "egress_denied"
  | "invalid_egress_options"
  | "unsafe_sandbox_not_acknowledged"
  | "invalid_sandbox_options"
  | "invalid_spawn_env"
  | "duplicate_tool"
  | "invalid_tool_registration"
  | "invalid_tool_options"
  | "invalid_permission_config"
  | "invalid_lock_options"
  | "session_locked"
  | "session_read_only"
  | "entry_not_found"
  | "unsupported_format"
  | "invalid_turn_options"
  | "invalid_context_options"
  | "invalid_dispatcher_options"
  | "invalid_transport_options"
  | "spill_unavailable"
  | "invalid_extension"
  | "extension_hash_mismatch"
  | "approval_not_pending"
  | "approval_unavailable"
  | "sticky_refused"
  | "approval_reuse_refused"
  | "approver_is_requester"
  | "approval_refused"
  | "invalid_code_call"
  | "invalid_escalation"
  | "invalid_key_store"
  | "key_store_read_only"
  | "session_conflict"
  | "entry_too_large"
  | "invalid_session_entry"
  | "invalid_session_key"
  | "invalid_retention"
  | "session_corrupt"
  | "invalid_completion_config"
  | "invalid_mcp_config"
  | "mcp_connect_failed"
  | "mcp_tool_list_refused"
  | "mcp_call_failed"
  | "invalid_memory_options"
  | "memory_path_refused"
  | "memory_corrupt";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const HARNESS_ERROR = Symbol.for("buildanagent.harness.HarnessError");

/**
 * Thrown for a mistake in how the harness is called, and for a sandbox that is unavailable or refuses a file operation.
 * `sandbox_unavailable`: a backend can't start (`SandboxUnavailableError`). `sandbox_denied`: the policy refused a file
 * read or write (`SandboxDeniedError`). `sandbox_disposed`: the sandbox was disposed before the call.
 * `sandbox_not_found`: a file to read doesn't exist. `sandbox_io_failed`: a file call failed for a reason that is
 * neither a missing file nor a denial. `sandbox_policy_mismatch`: the policy a backend read back after it provisioned or
 * resumed a sandbox differs from the one requested (`SandboxPolicyMismatchError`). `sandbox_unsupported`: a sandbox was
 * asked to resume, snapshot or pause on a backend that lacks the capability (`SandboxUnsupportedError`).
 * `unsafe_sandbox_not_acknowledged`: `noneSandbox()` was called without `unsafe:
 * true`. `invalid_sandbox_options`: a sandbox option, manifest or command is unusable. `invalid_spawn_env`:
 * `spawnEnv()` was given a name or value that can't be part of a clean environment. `duplicate_tool`: a tool registry
 * already holds a tool or alias by that name (`DuplicateToolError`). `invalid_tool_registration`: a tool registration
 * or a registry option is unusable, such as a name that breaks the canonical rule or an unknown source.
 * `invalid_tool_options`: the built-in tools were given a workspace root or a policy root that is not an absolute path.
 * `invalid_permission_config`: an allow rule makes the host callback unreachable (`PermissionConfigError`).
 * `invalid_lock_options`: a file lock was given a lease, renewal interval or host name it can't use. `session_locked`:
 * another writer holds the session. `session_read_only`: a session opened without a lock was asked to write.
 * `entry_not_found`: an entry id is in no file of the session. `unsupported_format`: a session file's format can't be
 * read or migrated, its header names none, or the store can't read it as written. `invalid_turn_options`: a turn's
 * options can't be used, such as a tool allowlist that names a tool the registry lacks, or a hook that changed the
 * model inside a turn.
 * `invalid_context_options`: a context policy's setting can't be used, such as a write cap with no spill store or a mask
 * step of zero. `invalid_dispatcher_options`: a dispatcher's setting can't be used, such as a queue size of zero.
 * `invalid_transport_options`: a transport's setting can't be used, such as a write timeout of zero.
 * `spill_unavailable`: a spill store can't write, such as the file store on a runtime without Node's file
 * system. `invalid_extension`: an extension has no name or version, two share a name, or a project extension's module does not export one. `extension_hash_mismatch`: a project extension's files hash differently from the lock file, or the lock file does not list it. `approval_not_pending`: a resolution names a request that is not waiting.
 * `approval_unavailable`: the harness has no signer, so no approval can be checked. `sticky_refused`: a sticky
 * allowance would cover an interpreter prefix or a secret. `approval_reuse_refused`: the tool's `approvalReuse` forbids
 * a sticky or grouped answer. `approver_is_requester`: the approver is the one who asked. `approval_refused`: a code
 * call's or a sandbox escalation's signed request failed its check when it was resolved, or a classifier tried to
 * approve an escalation, so nothing ran and nothing was written.
 * `invalid_code_call`: `Harness.invokeTool()` or a code call's resolution was given something it can't run, such as a
 * tool the registry lacks or a compensation that names no call that ran. `invalid_escalation`: `escalation()` or one
 * of its calls was given something it can't use, such as a granular policy with no rules, or an edge the escalation
 * table does not list. `invalid_key_store`: a key
 * file or key secret is unreadable or malformed, or a key file is readable by others. `key_store_read_only`: a key store
 * with no `rotate()` or `prune()` was asked to rotate or prune. `session_conflict`: an append found the log in a state it did
 * not expect (`ConflictError`). `entry_too_large`: an entry is over the store's size bound (`EntryTooLargeError`).
 * `invalid_session_entry`: an entry is not valid or is out of place, such as a first entry that is not a header.
 * `invalid_session_key`: a user or session id the store can't use. `invalid_retention`: a retention period that is not a
 * positive number, or an action other than `archive` and `purge`. `session_corrupt`: a log file has a bad line before
 * its last line. `invalid_completion_config`: `.agents/harness.json` is not JSON, or its `completionChecks` is not a list
 * of commands. `invalid_mcp_config`: an MCP server's configuration can't be used, such as a name outside the allowed
 * characters or two servers with one name. `mcp_connect_failed`: an MCP server did not start, did not finish the
 * handshake in time, or closed before it did (`McpError`). `mcp_tool_list_refused`: an MCP server listed tools the
 * harness refuses, such as two with one name, so none of its tools was registered (`McpError`). `mcp_call_failed`: an
 * MCP tool call ended without a result, because the server closed, timed out, asked for input or answered with an
 * error (`McpError`).
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
