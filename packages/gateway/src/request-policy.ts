/**
 * The process-wide switch behind `allowModelRequests()` (SDK decision 14; SDK plan §5.4).
 *
 * Every adapter calls `assertModelRequestAllowed(transport)` before it sends a request. When tests have turned real
 * requests off, any transport not marked as a mock throws before anything leaves the process.
 */
import type { Transport } from "./runtime-types.ts";

const MOCK_TRANSPORT = Symbol.for("agent-speak.gateway.mockTransport");

let modelRequestsAllowed = true;

/** Turns real model requests on or off for the whole process. Tests turn them off in the shared setup. */
export function setModelRequestsAllowed(allowed: boolean): void {
  modelRequestsAllowed = allowed;
}

export function modelRequestsAreAllowed(): boolean {
  return modelRequestsAllowed;
}

/** Marks a transport as an in-process mock, which `allowModelRequests(false)` still lets through. */
export function markMockTransport<T extends Transport>(transport: T): T {
  Object.defineProperty(transport, MOCK_TRANSPORT, { value: true });
  return transport;
}

export function isMockTransport(transport: Transport | undefined): boolean {
  return transport !== undefined && (transport as unknown as Record<symbol, unknown>)[MOCK_TRANSPORT] === true;
}

export class ModelRequestsDisabledError extends Error {
  override readonly name = "ModelRequestsDisabledError";
}

/** Throws unless real requests are allowed or the transport is a mock. Adapters call it before sending. */
export function assertModelRequestAllowed(transport: Transport | undefined): void {
  if (modelRequestsAllowed || isMockTransport(transport)) return;
  throw new ModelRequestsDisabledError(
    "Model requests are disabled (allowModelRequests(false)); use a mock transport or ScriptedModel in tests.",
  );
}
