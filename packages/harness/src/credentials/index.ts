/**
 * `@buildanagent/harness/credentials`: the credential boundary (HD15). `startEgressProxy()` is a host-side, default-deny
 * egress proxy that logs each request, injects a host-scoped credential on a local route when the sentinel matches, and
 * gates an in-process fetch under the same allowlist. `scrubSecrets()` removes known secrets from an entry before it is
 * appended. The proxy is Node-only; the scrubber and the address check are portable.
 */
export { isAddressLiteral, isPublicAddress } from "./addresses.js";
export {
  type CredentialRoute,
  type EgressProxy,
  type EgressProxyOptions,
  type EgressRecord,
  startEgressProxy,
} from "./egress-proxy.js";
export { REDACTED, scrubSecrets } from "./scrub.js";
