/**
 * `@agent-speak/gateway/testing`: test doubles for the gateway.
 *
 * It exposes the offline guards, `allowModelRequests()` and `assertStreamContract()`. B4 adds `mockTransport()`, `startMockServer()` and `allowModelRequests()`.
 */

export {
  isMockTransport,
  ModelRequestsDisabledError,
  markMockTransport,
  setModelRequestsAllowed as allowModelRequests,
} from "../request-policy.ts";
export { assertStreamContract, StreamContractError } from "../stream-contract.ts";
export {
  assertNoProviderKeys,
  guardedFetch,
  installTestGuards,
  isLoopbackHost,
  PROVIDER_KEY_VARIABLES,
} from "./guards.ts";
