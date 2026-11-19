/**
 * `SdkError`: the SDK's error for programmer errors, such as a tool definition that breaks the name rule or a tool
 * that returns something other than a tool result. A failure the model caused, such as invalid tool input, is never
 * thrown: the tool pipeline returns it to the model as an error result.
 */

/** Why an `SdkError` was thrown. */
export type SdkErrorCode = "invalid_tool_definition" | "invalid_tool_result";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const SDK_ERROR = Symbol.for("buildanagent.sdk.SdkError");

/**
 * Thrown for a mistake in how the SDK is called. `invalid_tool_definition`: a tool's name, description or schema
 * is unusable, or two tools share a name. `invalid_tool_result`: a tool's `execute` returned a malformed result or
 * write outcome.
 */
export class SdkError extends Error {
  override readonly name = "SdkError";
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
