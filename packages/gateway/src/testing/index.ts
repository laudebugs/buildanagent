/**
 * `@agent-speak/gateway/testing`: test doubles for the gateway.
 *
 * B1 exposes only the offline guard. B4 adds `mockTransport()`, `startMockServer()` and `allowModelRequests()`.
 */
export {
  assertNoProviderKeys,
  guardedFetch,
  installTestGuards,
  isLoopbackHost,
  PROVIDER_KEY_VARIABLES,
} from "./guards.ts";
