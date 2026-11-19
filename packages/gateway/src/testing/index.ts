/**
 * `@buildanagent/gateway/testing`: test doubles for the gateway.
 *
 * It exposes the offline guards, `allowModelRequests()`, `assertStreamContract()`, `mockTransport()` with its
 * `serverSentEvents()` and `chatCompletionEvents()` body writers, and `seededRandom()`; `startMockServer()` is planned
 * here (SDK plan §3.2).
 */

export {
  isMockTransport,
  ModelRequestsDisabledError,
  markMockTransport,
  setModelRequestsAllowed as allowModelRequests,
} from "../request-policy.js";
export { assertStreamContract, StreamContractError } from "../stream-contract.js";
export {
  assertNoProviderKeys,
  guardedFetch,
  installTestGuards,
  isLoopbackHost,
  PROVIDER_KEY_VARIABLES,
} from "./guards.js";
export {
  chatCompletionEvents,
  type MockTransport,
  mockTransport,
  type RecordedRequest,
  serverSentEvents,
  type WireApi,
  type WireResponse,
  type WireScript,
} from "./mock-transport.js";
export { seededRandom } from "./random.js";
