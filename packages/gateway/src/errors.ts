/**
 * `GatewayError`: the gateway's error for programmer errors, such as a missing key, invalid options, a malformed
 * catalog, a tool name outside the canonical rule, a message with a role the transcript does not have, or a
 * request a mock transport's script did not expect. Two subclasses keep their own names for the cases callers catch
 * by class: `StreamContractError` and `ModelRequestsDisabledError`.
 */

/** Why a `GatewayError` was thrown. */
export type GatewayErrorCode =
  | "missing_api_key"
  | "missing_caps"
  | "invalid_options"
  | "invalid_catalog"
  | "invalid_tool_name"
  | "invalid_message"
  | "unexpected_request"
  | "stream_contract"
  | "model_requests_disabled";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const GATEWAY_ERROR = Symbol.for("buildanagent.gateway.GatewayError");

/**
 * Thrown for a mistake in how the gateway is called. A failed model call is never thrown: it ends its stream with an
 * `error` event instead. `stream_contract`: a stream broke the stream rule (`StreamContractError`).
 * `model_requests_disabled`: a real request was attempted while `allowModelRequests(false)` is in force
 * (`ModelRequestsDisabledError`).
 */
export class GatewayError extends Error {
  override readonly name: string = "GatewayError";
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    Object.defineProperty(this, GATEWAY_ERROR, { value: true });
  }
}

/** True for a `GatewayError`, including one from another copy of the package. */
export function isGatewayError(error: unknown): error is GatewayError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[GATEWAY_ERROR] === true;
}
