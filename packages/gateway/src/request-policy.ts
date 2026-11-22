/**
 * The process-wide switch behind `allowModelRequests()` (SDK decision 14; SDK plan §5.4).
 *
 * Every adapter calls `assertModelRequestAllowed(transport)` before it sends a request. When tests have turned real
 * requests off, any transport not marked as a mock throws before anything leaves the process.
 */
import { GatewayError } from "./errors.js";
import type { Transport } from "./runtime-types.js";

const MOCK_TRANSPORT = Symbol.for("buildanagent.gateway.mockTransport");

let modelRequestsAllowed = true;

/** Turns real model requests on or off for the whole process. Tests turn them off in the shared setup. */
export function setModelRequestsAllowed(allowed: boolean): void {
  modelRequestsAllowed = allowed;
}

/** Whether real model requests are on for this process. They are on until `setModelRequestsAllowed(false)` turns them off. */
export function modelRequestsAreAllowed(): boolean {
  return modelRequestsAllowed;
}

/** Marks a transport as an in-process mock, which `allowModelRequests(false)` still lets through. */
export function markMockTransport<T extends Transport>(transport: T): T {
  Object.defineProperty(transport, MOCK_TRANSPORT, { value: true });
  return transport;
}

/** Whether `transport` was marked as a mock, which may send requests while real model requests are off. */
export function isMockTransport(transport: Transport | undefined): boolean {
  return transport !== undefined && (transport as unknown as Record<symbol, unknown>)[MOCK_TRANSPORT] === true;
}

/**
 * Thrown before a request is sent while real model requests are off and the transport is not a mock. It is a
 * `GatewayError` with code `model_requests_disabled`, so `isGatewayError()` recognises it too.
 */
export class ModelRequestsDisabledError extends GatewayError {
  override readonly name = "ModelRequestsDisabledError";

  constructor(message: string) {
    super("model_requests_disabled", message);
  }
}

/** Throws unless real requests are allowed or the transport is a mock. Adapters call it before sending. */
export function assertModelRequestAllowed(transport: Transport | undefined): void {
  if (modelRequestsAllowed || isMockTransport(transport)) return;
  throw new ModelRequestsDisabledError(
    "Model requests are disabled (allowModelRequests(false)); use a mock transport or ScriptedModel in tests.",
  );
}
