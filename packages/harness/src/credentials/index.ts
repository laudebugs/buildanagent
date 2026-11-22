/**
 * `@buildanagent/harness/credentials`: the credential boundary. `startEgressProxy()` is a host-side, default-deny
 * egress proxy that logs each request, injects a host-scoped credential on a local route when the sentinel matches, and
 * gates an in-process fetch under the same allowlist. `scrubSecrets()` removes known secrets from an entry before it is
 * appended. `compileEgressPolicy()` turns an `EgressPolicy`, which names credentials but never holds them, into the
 * proxy's allowlist and routes, and a `git` route limits git over HTTPS to listed repositories and branches. The proxy
 * is Node-only; the policy compiler, the git checks, the scrubber and the address check are portable.
 */
export { isAddressLiteral, isPublicAddress } from "./addresses.js";
export {
  type CompiledEgressPolicy,
  type CompileEgressOptions,
  compileEgressPolicy,
  type EgressPolicy,
  type EgressRoute,
  type GitEgressRoute,
  type HeaderEgressRoute,
} from "./egress-policy.js";
export {
  type CredentialRoute,
  type EgressProxy,
  type EgressProxyOptions,
  type EgressRecord,
  startEgressProxy,
} from "./egress-proxy.js";
export {
  GIT_MAX_COMMAND_BYTES,
  GIT_MAX_COMMANDS,
  type GitRouteFilter,
  isValidRefName,
  pushVerdict,
} from "./git-route.js";
export { REDACTED, scrubSecrets } from "./scrub.js";
