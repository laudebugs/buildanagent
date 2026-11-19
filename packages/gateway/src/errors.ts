/** `GatewayError`: the gateway's error for programmer errors, such as a missing key or invalid options. */

/** Why a `GatewayError` was thrown. */
export type GatewayErrorCode = "missing_api_key" | "missing_caps" | "invalid_options";

// A registered symbol, so the guard still works when two copies of the package are bundled.
const GATEWAY_ERROR = Symbol.for("buildanagent.gateway.GatewayError");

/**
 * Thrown for a mistake in how the gateway is called. A failed model call is never thrown: it ends its stream with an
 * `error` event instead.
 */
export class GatewayError extends Error {
  override readonly name = "GatewayError";
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
