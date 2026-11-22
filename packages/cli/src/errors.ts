/**
 * `CliError`: the CLI's one error class. Each code maps to an exit status, so a script can tell a mistake in how the
 * command was called from a model or provider that could not be reached.
 */

/** Why a `CliError` was thrown. */
export type CliErrorCode =
  | "usage"
  | "no_model"
  | "missing_api_key"
  | "no_state_dir"
  | "unknown_session"
  | "session_unavailable"
  | "otlp_failed";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const CLI_ERROR = Symbol.for("buildanagent.cli.CliError");

/**
 * Thrown for a command the CLI can't run as given. `usage`: an unknown command, flag or missing argument.
 * `no_model`: a command that calls a model was given no `--model`. `missing_api_key`: the provider's key variable is
 * unset. `no_state_dir`: neither `--state-dir`, `XDG_STATE_HOME` nor `HOME` names a folder for sessions.
 * `unknown_session`: no stored session has the id given. `session_unavailable`: the session refused a turn, such as one
 * that another process is writing. `otlp_failed`: the `--otlp-endpoint` collector refused the spans.
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
