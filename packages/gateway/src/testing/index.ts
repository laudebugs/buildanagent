/**
 * `@buildanagent/gateway/testing`: test doubles for the gateway.
 *
 * It exposes the offline guards, `allowModelRequests()` and `assertStreamContract()`; `mockTransport()` and `startMockServer()` are planned here (SDK plan §3.2).
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
