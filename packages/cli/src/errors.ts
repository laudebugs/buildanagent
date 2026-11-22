/** `CliError`: the CLI's one error class, with a `code` that says why the command could not run. */

/** Why a `CliError` was thrown. */
export type CliErrorCode =
  /** An unknown command, flag or missing argument. */
  | "usage"
  /** A command that calls a model was given no `--model`. */
  | "no_model"
  /** The provider's key variable is unset. */
  | "missing_api_key"
  /** Neither `--state-dir`, `XDG_STATE_HOME` nor `HOME` names a folder for sessions. */
  | "no_state_dir"
  /** No stored session has the id given. */
  | "unknown_session"
  /** The session refused a turn, such as one that another process is writing. */
  | "session_unavailable"
  /** The `--otlp-endpoint` collector could not be reached or refused the spans. */
  | "otlp_failed"
  /** `rpc` was run on a `CliIo` that gives no standard streams. */
  | "no_streams";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const CLI_ERROR = Symbol.for("buildanagent.cli.CliError");

/**
 * Thrown for a command the CLI can't run as given. `runCli()` reports one on standard error and exits 2, so a script
 * reads `code` to tell a bad command line from a missing key or a session it can't use. A model or provider failure
 * during a turn is a stop reason, so it exits 1.
 */
export class CliError extends Error {
  override readonly name = "CliError";
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, CLI_ERROR, { value: true });
  }
}

/** True for a `CliError`, including one from another copy of the package. */
export function isCliError(error: unknown): error is CliError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[CLI_ERROR] === true;
}
