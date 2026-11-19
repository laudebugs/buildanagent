/**
 * `SdkError`: the SDK's error for programmer errors, such as a tool definition that breaks the name rule or a tool
 * that returns something other than a tool result. A failure the model caused, such as invalid tool input, is never
 * thrown: the tool pipeline returns it to the model as an error result. Two subclasses keep their own names:
 * `RunStoppedError`, which `runOrThrow()` throws for a run that did not finish, and the testing export's
 * `UnexpectedModelCallError`.
 */
import type { Context, UnfinishedResult } from "./result.js";

/** Why an `SdkError` was thrown. */
export type SdkErrorCode =
  | "invalid_tool_definition"
  | "invalid_tool_result"
  | "invalid_run_options"
  | "invalid_model_stream"
  | "run_stopped"
  | "unexpected_model_call";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const SDK_ERROR = Symbol.for("buildanagent.sdk.SdkError");

/**
 * Thrown for a mistake in how the SDK is called. `invalid_tool_definition`: a tool's name, description, schema or
 * exposure is unusable, or two tools share a name. `invalid_tool_result`: a tool's `execute` returned a malformed
 * result or write outcome. `invalid_run_options`: `run()` or `continueRun()` got an option it can't use, such as a
 * model that isn't from `createModel()`. `invalid_model_stream`: a model's stream ended without a final message.
 * `run_stopped`: `runOrThrow()` was given a run that did not finish (a `RunStoppedError`). `unexpected_model_call`: a
 * `ScriptedModel` was called more times than its script allows (an `UnexpectedModelCallError`).
 */
export class SdkError extends Error {
  override readonly name: string = "SdkError";
  readonly code: SdkErrorCode;

  constructor(code: SdkErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, SDK_ERROR, { value: true });
  }
}

/** True for an `SdkError`, including one from another copy of the package. */
export function isSdkError(error: unknown): error is SdkError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[SDK_ERROR] === true;
}

const RUN_STOPPED_ERROR = Symbol.for("buildanagent.sdk.RunStoppedError");

/**
 * Thrown by `runOrThrow()` for a run that ended any way other than `done`, such as one that reached `maxSteps`. It
 * carries the whole result, and the context to continue from. It is an `SdkError` with code `run_stopped`.
 */
export class RunStoppedError extends SdkError {
  override readonly name = "RunStoppedError";
  readonly stopReason: UnfinishedResult["stopReason"];
  readonly result: UnfinishedResult;
  /** The conversation so far, ready for `continueRun()`. */
  readonly context: Context;

  constructor(result: UnfinishedResult) {
    super("run_stopped", `the run stopped with "${result.stopReason}" after ${result.steps} model calls`);
    this.stopReason = result.stopReason;
    this.result = result;
    this.context = result.context;
    Object.defineProperty(this, RUN_STOPPED_ERROR, { value: true });
  }

  /** True for a `RunStoppedError`, including one from another copy of the package. Use it in place of `instanceof`. */
  static isInstance(error: unknown): error is RunStoppedError {
    return (
      typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[RUN_STOPPED_ERROR] === true
    );
  }
}
