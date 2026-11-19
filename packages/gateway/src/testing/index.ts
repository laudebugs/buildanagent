/**
 * `@buildanagent/gateway/testing`: test doubles for the gateway.
 *
 * It exposes the offline guards, `allowModelRequests()`, `assertStreamContract()`, `mockTransport()` and
 * `seededRandom()`; `startMockServer()` is planned here (SDK plan §3.2).
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
export {
  type MockTransport,
  mockTransport,
  type RecordedRequest,
  serverSentEvents,
  type WireApi,
  type WireResponse,
  type WireScript,
} from "./mock-transport.ts";
export { seededRandom } from "./random.ts";
