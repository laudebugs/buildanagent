/**
 * `@buildanagent/gateway/testing`: test doubles for the gateway.
 *
 * It exposes the offline guards, `allowModelRequests()`, `assertStreamContract()`, `mockTransport()` with its
 * `serverSentEvents()` and `chatCompletionEvents()` body writers, `startMockServer()`, the credential strippers that
 * every recorder uses, and `seededRandom()`.
 */

export {
  isMockTransport,
  ModelRequestsDisabledError,
  markMockTransport,
  setModelRequestsAllowed as allowModelRequests,
} from "../request-policy.js";
export { assertStreamContract, StreamContractError } from "../stream-contract.js";
export {
  CREDENTIAL_HEADERS,
  isCredentialName,
  REDACTED,
  redactHeaders,
  stripCredentials,
} from "./credentials.js";
export {
  assertNoProviderKeys,
  guardedFetch,
  installTestGuards,
  isLoopbackHost,
  PROVIDER_KEY_VARIABLES,
} from "./guards.js";
export { type MockServer, type MockServerOptions, startMockServer } from "./mock-server.js";
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
