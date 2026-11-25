/**
 * How the E2B backend turns a policy into E2B's network configuration, and E2B's report back into a policy. It is
 * portable: it imports no Node module and no part of the `e2b` SDK.
 *
 * E2B leaves egress open unless a sandbox denies it, matches an `allowOut` domain only on ports 80 and 443, opens all
 * traffic to its DNS servers once `allowOut` holds a domain, and lets an allow entry win over a deny entry. So the
 * backend sends `denyOut: ["0.0.0.0/0"]`, `dnsServers: []` and an `allowOut` of exactly the policy's hosts, and refuses
 * what E2B would widen: a wildcard, an address, a port and a deny list.
 */

import { isAddressLiteral } from "../../credentials/addresses.js";
import {
  compileEgressPolicy,
  type EgressPolicy,
  type EgressRoute,
  type HeaderEgressRoute,
} from "../../credentials/egress-policy.js";
import { HarnessError } from "../../errors.js";
import { SandboxPolicyMismatchError } from "../errors.js";
import type { SandboxPolicy } from "../types.js";
import type { E2BNetworkInfo, E2BNetworkOptions, E2BNetworkRule, E2BSandboxInfo } from "./sdk.js";

/** The `denyOut` entry that stands for every IPv4 address, which E2B calls `ALL_TRAFFIC`. */
export const E2B_ALL_TRAFFIC = "0.0.0.0/0";
/** The DNS server E2B opens to all traffic when `allowOut` holds a domain and `dnsServers` is left out. */
export const E2B_DEFAULT_DNS_SERVER = "8.8.8.8";

/** A word that may come before a secret's placeholder in its header, such as `Bearer`. */
export type E2BHeaderScheme = "Bearer" | "Basic" | "token";

/** The options of `compileE2BEgress()`. */
export interface E2BEgressOptions {
  /** Formats the placeholder for a secret, which is `Secret.fill` from `e2b`. Build it no other way. */
  readonly fill: (secret: string) => string;
  /**
   * The E2B secret that holds a credential, by the credential's name. Defaults to the name in lower case, so
   * `GITHUB_TOKEN` is the secret `github_token`, because E2B stores every secret name in lower case.
   */
  readonly secretName?: (credential: string) => string;
  /** A word to put before a credential's placeholder, by credential name, such as `{ GITHUB_TOKEN: "Bearer" }`. */
  readonly schemes?: Readonly<Record<string, E2BHeaderScheme>>;
  /**
   * Must be `true` for a policy with any route. E2B adds a route's header to every HTTPS request to its host, from every
   * process in the sandbox, whatever the method or path, so a route's `methods` and `route` are not enforced.
   */
  readonly unscopedInjection?: boolean;
}

/** One secret a compiled policy names. */
export interface E2BSecretReference {
  /** The E2B secret's name. */
  readonly secret: string;
  /** The `EgressPolicy` credential it stands for. */
  readonly credential: string;
}

/** An `EgressPolicy` compiled for E2B. */
export interface E2BCompiledEgress {
  /** The `network` option of `Sandbox.create()`. */
  readonly network: E2BNetworkOptions;
  /** The secrets the rules name, each once, which provisioning checks exist before it creates a sandbox. */
  readonly secrets: readonly E2BSecretReference[];
}

const invalid = (message: string) => new HarnessError("invalid_egress_options", message);
const invalidPolicy = (message: string) => new HarnessError("invalid_sandbox_options", message);

// An exact DNS name in lower case: what E2B matches by Host header or SNI, and the spelling E2B stores rules in.
const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
// What E2B accepts as a secret name: 1 to 128 ASCII letters, digits, `_` or `-`. `sec_` starts a secret's id instead.
const SECRET_NAME = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED_SECRET_PREFIX = /^sec_/i;
const SCHEMES = new Set<string>(["Bearer", "Basic", "token"]);

/** Whether `entry` is a host E2B can match exactly and nothing wider. */
const isExactHost = (entry: unknown): entry is string =>
  typeof entry === "string" && DNS_NAME.test(entry) && !isAddressLiteral(entry);

/**
 * Throws unless every entry of `network.allow` is an exact lower-case host name with no port, and `network.deny` is
 * empty. `where` names the list in the message, which never quotes an entry.
 */
export function checkAllowList(allow: readonly unknown[], where: string): void {
  for (const [index, entry] of allow.entries()) {
    if (!isExactHost(entry)) {
      throw invalidPolicy(
        `${where} entry ${index} must be an exact lower-case host name with no port: E2B would widen a wildcard, an address or a range, and matches a name only on ports 80 and 443`,
      );
    }
  }
}

/** The default secret name for a credential: its name in lower case. */
const defaultSecretName = (credential: string) => credential.toLowerCase();

/** The header value for one route: the placeholder, after the scheme when one is set. */
function headerValue(route: HeaderEgressRoute, secret: string, options: E2BEgressOptions): string {
  const placeholder = options.fill(secret);
  const scheme = options.schemes?.[route.credential];
  if (scheme === undefined) return placeholder;
  if (!SCHEMES.has(scheme)) throw invalid(`the scheme for ${route.credential} must be Bearer, Basic or token`);
  return `${scheme} ${placeholder}`;
}

/** The E2B secret for one route, after the checks that a route E2B can enforce must pass. */
function secretFor(
  route: EgressRoute,
  index: number,
  options: E2BEgressOptions,
): { readonly secret: string; readonly route: HeaderEgressRoute } {
  if (route.kind !== "header") {
    throw invalid(
      `route ${index} is a git route, and E2B can't filter a push by ref; reach git through the egress proxy`,
    );
  }
  if (!isExactHost(route.host)) throw invalid(`the host of route ${index} must be a lower-case host name with no port`);
  const secret = (options.secretName ?? defaultSecretName)(route.credential);
  if (typeof secret !== "string" || !SECRET_NAME.test(secret) || RESERVED_SECRET_PREFIX.test(secret)) {
    throw invalid(`the E2B secret name for route ${index} must be 1 to 128 letters, digits, _ or -, not starting sec_`);
  }
  return { secret, route };
}

/**
 * Compiles `policy` for E2B: `allowOut` is exactly `allow` plus each route's host, `denyOut` denies every other
 * address, `dnsServers` is empty, and each header route becomes a rule on its host whose header is the placeholder for
 * the credential's E2B secret. It checks the policy as `compileEgressPolicy()` does, and refuses, with
 * `invalid_egress_options`, what E2B can't enforce:
 *
 * - a git route, because E2B can't filter a push by ref;
 * - a host with a port or in upper case, because E2B matches names only on ports 80 and 443, and stores them in lower case;
 * - a route, unless `unscopedInjection` is `true`, because E2B doesn't check a route's method or path;
 * - two routes that set the same header on one host, and a secret name E2B would refuse.
 *
 * It never reads a credential: the compiled rules hold placeholders, which E2B's egress proxy resolves outside the
 * sandbox for each HTTPS request.
 */
export function compileE2BEgress(policy: EgressPolicy, options: E2BEgressOptions): E2BCompiledEgress {
  if (typeof options?.fill !== "function") throw invalid("compileE2BEgress needs the SDK's Secret.fill");
  compileEgressPolicy(policy, {
    secret: () => Promise.reject(new Error("an E2B policy is never given a credential's value")),
  });
  for (const [index, entry] of policy.allow.entries()) {
    if (!isExactHost(entry)) throw invalid(`allow entry ${index} must be a lower-case host name with no port`);
  }
  if (policy.routes.length > 0 && options.unscopedInjection !== true) {
    throw invalid(
      "E2B adds a route's header to every HTTPS request to its host, whatever the method or path; set unscopedInjection: true to accept that",
    );
  }
  const rules: Record<string, Record<string, string>> = {};
  const secrets = new Map<string, E2BSecretReference>();
  for (const [index, entry] of policy.routes.entries()) {
    const { secret, route } = secretFor(entry, index, options);
    const header = route.header.toLowerCase();
    const headers = rules[route.host] ?? {};
    if (header in headers) throw invalid(`route ${index} sets a header that another route sets on the same host`);
    headers[header] = headerValue(route, secret, options);
    rules[route.host] = headers;
    if (!secrets.has(secret)) secrets.set(secret, { secret, credential: route.credential });
  }
  const allowOut = [...new Set([...policy.allow, ...policy.routes.map((route) => route.host)])];
  const network: E2BNetworkOptions = { allowOut, denyOut: [E2B_ALL_TRAFFIC], dnsServers: [] };
  const hosts = Object.keys(rules);
  if (hosts.length > 0) {
    network.rules = Object.fromEntries(hosts.map((host) => [host, [{ transform: { headers: { ...rules[host] } } }]]));
  }
  return { network, secrets: [...secrets.values()] };
}

/** The network configuration for a policy with no credential routes: its hosts, and nothing else. */
export function plainNetwork(allow: readonly string[]): E2BCompiledEgress {
  return { network: { allowOut: [...allow], denyOut: [E2B_ALL_TRAFFIC], dnsServers: [] }, secrets: [] };
}

/** Whether `entry` in `allowOut` is a domain, which opens E2B's DNS servers, rather than an address or a range. */
const isDomain = (entry: string): boolean => !isAddressLiteral(entry) && !entry.includes("/");

/** Whether two lists of rules are the same, header by header, compared as E2B stores them. */
function sameRules(
  expected: Readonly<Record<string, readonly E2BNetworkRule[]>> | undefined,
  reported: Readonly<Record<string, readonly E2BNetworkRule[]>> | undefined,
): boolean {
  const normal = (rules: Readonly<Record<string, readonly E2BNetworkRule[]>> | undefined) =>
    JSON.stringify(
      Object.entries(rules ?? {})
        .filter(([, list]) => list.length > 0)
        .map(([host, list]) => [
          host.toLowerCase(),
          list.map((rule) =>
            Object.entries(rule.transform?.headers ?? {})
              .map(([name, value]) => [name.toLowerCase(), value])
              .sort(),
          ),
        ])
        .sort(),
    );
  return normal(expected) === normal(reported);
}

/**
 * The network half of a policy, read from what E2B reports for a sandbox. `allow` is `allowOut`, plus `0.0.0.0/0`
 * when nothing denies every address, plus the DNS servers E2B opens when `allowOut` holds a domain (`8.8.8.8` when E2B
 * reports none). It throws `SandboxPolicyMismatchError` with the field `network.deny` for a deny list other than
 * `0.0.0.0/0`, `egress.rules` for rules other than `expected`'s, and `egress.proxy` for a SOCKS5 proxy.
 */
export function networkFromInfo(info: E2BSandboxInfo, expected: E2BNetworkOptions): SandboxPolicy["network"] {
  const network: E2BNetworkInfo = info.network ?? {};
  const allowOut = [...(network.allowOut ?? [])];
  const denyOut = [...(network.denyOut ?? [])];
  if (denyOut.some((entry) => entry !== E2B_ALL_TRAFFIC)) throw new SandboxPolicyMismatchError("network.deny");
  if (network.egressProxy !== undefined && network.egressProxy !== null) {
    throw new SandboxPolicyMismatchError("egress.proxy");
  }
  if (!sameRules(expected.rules, network.rules)) throw new SandboxPolicyMismatchError("egress.rules");
  const allow = [...allowOut];
  // `allowInternetAccess: false` denies every address as `denyOut: ["0.0.0.0/0"]` does, and `allowOut` still wins.
  const closed = denyOut.includes(E2B_ALL_TRAFFIC) || info.allowInternetAccess === false;
  if (!closed) allow.push(E2B_ALL_TRAFFIC);
  if (allowOut.some(isDomain)) allow.push(...(network.dnsServers ?? [E2B_DEFAULT_DNS_SERVER]));
  return { allow, deny: [] };
}
