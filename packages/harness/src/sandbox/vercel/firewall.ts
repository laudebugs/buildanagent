/**
 * The Vercel firewall side of an `EgressPolicy`: it compiles the policy into the `networkPolicy` that `Sandbox.create()`
 * takes, with each header route's credential in a `transform` rule that the firewall applies outside the sandbox, and it
 * reads back the policy Vercel reports. It refuses what the firewall can't enforce as written: a wildcard, a port, a git
 * route's ref filter, and `subnets.allow`, which lets traffic go around the domain allowlist. It imports only types from
 * `@vercel/sandbox`, so it is pure and portable.
 */
import type { NetworkPolicy, NetworkPolicyRule } from "@vercel/sandbox";
import { compileEgressPolicy, type EgressPolicy, type HeaderEgressRoute } from "../../credentials/egress-policy.js";
import { HarnessError } from "../../errors.js";
import { SandboxPolicyMismatchError } from "../errors.js";

/**
 * The address ranges the compiled firewall policy denies by default: loopback, private, shared, link-local (which holds
 * the cloud metadata address 169.254.169.254) and the IPv6 unique-local, link-local and loopback ranges. Vercel's
 * firewall gives `subnets.deny` precedence over the allowed domains, so an allowed name that resolves to one of these is
 * still refused.
 */
export const VERCEL_DENIED_SUBNETS: readonly string[] = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
  "fe80::/10",
  "::1/128",
];

/** The thrown error for a credential the egress policy names but the host can't supply. */
export class VercelSecretError extends HarnessError {
  override readonly name = "VercelSecretError";
  /** The name of the credential, such as `GITHUB_TOKEN`. Never its value. */
  readonly credential: string;

  constructor(credential: string, reason: string) {
    super("egress_secret_unresolved", `the credential ${credential} ${reason}, so no Vercel sandbox was provisioned`);
    this.credential = credential;
  }
}

/** One header route as the firewall applies it: on which host, which header and which methods. */
export interface FirewallInjection {
  readonly host: string;
  readonly header: string;
  readonly methods: readonly string[];
}

/** A compiled firewall policy, with what the read-back compares it against and the values it must keep out of sight. */
export interface CompiledFirewall {
  /** The `networkPolicy` to send. It holds credential values, so it is never logged, returned or kept on a handle. */
  readonly networkPolicy: NetworkPolicy;
  /** Every host the firewall allows, in the order the policy names them. */
  readonly hosts: readonly string[];
  readonly injections: readonly FirewallInjection[];
  readonly deniedSubnets: readonly string[];
  /** The credential values, which the sandbox scans its commands and files for and scrubs from what it returns. */
  readonly secrets: readonly string[];
}

/** The options of `compileFirewall()`. */
export interface CompileFirewallOptions {
  /** Reads a credential by name, on the host. */
  readonly secret: (name: string) => Promise<string>;
  readonly deniedSubnets: readonly string[];
}

const invalid = (message: string) => new HarnessError("invalid_egress_options", message);
// A host the firewall can match as written: lower case, with no port and no wildcard. `compileEgressPolicy()` has
// already refused a wildcard and an address literal, so this only adds the case and the port.
const FIREWALL_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** Whether `value` can be a header value: it holds no control character, which would end the header or start another. */
const usableHeaderValue = (value: string): boolean =>
  [...value].every((char) => {
    const code = char.charCodeAt(0);
    return code === 0x09 || (code >= 0x20 && code !== 0x7f);
  });
// The IPv4 or IPv6 range an entry of `deniedSubnets` must be.
const CIDR = /^([0-9]{1,3}(\.[0-9]{1,3}){3}\/[0-9]{1,2}|[0-9a-f:]+\/[0-9]{1,3})$/i;

/** Throws unless every host is one the firewall can match exactly. The message names only the entry's place. */
function checkHosts(egress: EgressPolicy): void {
  for (const [index, host] of egress.allow.entries()) {
    if (!FIREWALL_HOST.test(host)) {
      throw invalid(`allow entry ${index} must be a lower-case host name with no port for the Vercel firewall`);
    }
  }
  const seen = new Set<string>();
  for (const [index, route] of egress.routes.entries()) {
    if (route.kind === "git") {
      throw invalid(`route ${index} is a git route, and the Vercel firewall can't enforce its ref filter`);
    }
    if (!FIREWALL_HOST.test(route.host)) {
      throw invalid(`the host of route ${index} must be a lower-case host name with no port for the Vercel firewall`);
    }
    // The firewall applies the rules for a host in order, so a second route on one host could never be told apart.
    if (seen.has(route.host)) throw invalid(`route ${index} shares its host with another route`);
    seen.add(route.host);
  }
}

/** Throws unless every entry of `deniedSubnets` is a range. */
function checkSubnets(subnets: readonly string[]): void {
  if (!Array.isArray(subnets) || subnets.some((entry) => typeof entry !== "string" || !CIDR.test(entry))) {
    throw new HarnessError("invalid_sandbox_options", "deniedSubnets must be a list of address ranges");
  }
}

/** Reads each credential the routes name once, or throws `VercelSecretError` naming the first one that fails. */
async function readSecrets(
  routes: readonly HeaderEgressRoute[],
  secret: CompileFirewallOptions["secret"],
): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const { credential } of routes) {
    if (values.has(credential)) continue;
    let value: unknown;
    try {
      value = await secret(credential);
    } catch {
      // The reader's own error may quote what it read, so it is not kept as the cause.
      throw new VercelSecretError(credential, "could not be read");
    }
    if (typeof value !== "string" || value === "") throw new VercelSecretError(credential, "is empty");
    if (!usableHeaderValue(value)) throw new VercelSecretError(credential, "holds a character a header value can't");
    values.set(credential, value);
  }
  return values;
}

/** The firewall rules for one host: the route's injection, and a refusal of the rest when the host is not in `allow`. */
function rulesFor(route: HeaderEgressRoute | undefined, value: string | undefined, tunnel: boolean) {
  const rules: NetworkPolicyRule[] = [];
  if (route !== undefined && value !== undefined) {
    rules.push({
      match: { method: route.methods.map((method) => method.toUpperCase()) },
      // The firewall terminates TLS for this host anyway, so the rule also pins `host`, which stops a request that
      // names the allowed host in its SNI from reaching another virtual host behind it with the credential.
      transform: [{ headers: { [route.header.toLowerCase()]: value, host: route.host } }],
    });
  }
  // A host reached only through a route takes only the route's methods, as the local proxy's routes do.
  if (route !== undefined && !tunnel) rules.push({ response: { statusCode: 403 } });
  return rules;
}

/**
 * Checks `egress` and compiles it for the Vercel firewall. It runs `compileEgressPolicy()`'s checks first, then refuses
 * a git route, a port, a host that isn't lower case and two routes on one host, with `invalid_egress_options`. It reads
 * each credential once, and throws `VercelSecretError` for one that can't be read, is empty or holds a control character.
 * An empty policy compiles to `"deny-all"`.
 */
export async function compileFirewall(
  egress: EgressPolicy,
  options: CompileFirewallOptions,
): Promise<CompiledFirewall> {
  compileEgressPolicy(egress, { secret: async () => "" });
  checkHosts(egress);
  checkSubnets(options.deniedSubnets);
  const routes = egress.routes.filter((route): route is HeaderEgressRoute => route.kind === "header");
  const values = await readSecrets(routes, options.secret);
  const hosts = [...new Set([...egress.allow, ...routes.map((route) => route.host)])];
  const injections = routes.flatMap((route) => {
    const methods = route.methods.map((method) => method.toUpperCase());
    const header = route.header.toLowerCase();
    return [
      { host: route.host, header, methods },
      ...(header === "host" ? [] : [{ host: route.host, header: "host", methods }]),
    ];
  });
  const secrets = [...values.values()];
  if (hosts.length === 0) {
    return { networkPolicy: "deny-all", hosts, injections, deniedSubnets: [], secrets };
  }
  const allow: Record<string, NetworkPolicyRule[]> = {};
  for (const host of hosts) {
    const route = routes.find((candidate) => candidate.host === host);
    allow[host] = rulesFor(
      route,
      route === undefined ? undefined : values.get(route.credential),
      egress.allow.includes(host),
    );
  }
  const networkPolicy: NetworkPolicy = { allow, subnets: { deny: [...options.deniedSubnets] } };
  checkVercelNetworkPolicy(networkPolicy);
  return { networkPolicy, hosts, injections, deniedSubnets: [...options.deniedSubnets], secrets };
}

/**
 * Throws `invalid_egress_options` unless `policy` keeps egress closed to everything it doesn't name: it refuses
 * `"allow-all"`, a `subnets.allow` (whose ranges go around the domain allowlist and its credential rules), a wildcard
 * domain and a `forwardURL` rule. `vercelSandbox()` runs it on every policy it sends; run it on a policy you build
 * yourself before passing it to `@vercel/sandbox`.
 */
export function checkVercelNetworkPolicy(policy: NetworkPolicy): void {
  if (policy === "deny-all") return;
  if (policy === "allow-all" || typeof policy !== "object" || policy === null) {
    throw invalid("a Vercel network policy must not allow every host");
  }
  if (policy.subnets?.allow !== undefined) {
    throw invalid("a Vercel network policy must not set subnets.allow, which goes around the domain allowlist");
  }
  const allow = policy.allow ?? [];
  const domains = Array.isArray(allow) ? allow : Object.keys(allow);
  if (domains.some((domain) => domain.includes("*"))) {
    throw invalid("a Vercel network policy must name each domain exactly, with no wildcard");
  }
  if (
    !Array.isArray(allow) &&
    Object.values(allow).some((rules) => rules.some((rule) => "forwardURL" in rule && rule.forwardURL !== undefined))
  ) {
    throw invalid("a Vercel network policy must not forward requests to another proxy");
  }
}

/** The header names and methods of each `transform` rule in a reported policy, by host. */
function reportedInjections(allow: Record<string, NetworkPolicyRule[]>): FirewallInjection[] {
  const found: FirewallInjection[] = [];
  for (const [host, rules] of Object.entries(allow)) {
    for (const rule of rules) {
      if (rule.transform === undefined) continue;
      for (const transform of rule.transform) {
        for (const header of Object.keys(transform.headers ?? {})) {
          found.push({ host, header: header.toLowerCase(), methods: [...(rule.match?.method ?? [])].sort() });
        }
      }
    }
  }
  return found;
}

const injectionKey = (injection: FirewallInjection) =>
  `${injection.host} ${injection.header} ${[...injection.methods]
    .map((m) => m.toUpperCase())
    .sort()
    .join(",")}`;

/** Whether two lists of injections hold the same ones. */
function sameInjections(left: readonly FirewallInjection[], right: readonly FirewallInjection[]): boolean {
  const a = left.map(injectionKey).sort();
  const b = right.map(injectionKey).sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * The hosts the policy Vercel reports allows, checked against `expected`. `"allow-all"` reads back as `*`, which
 * `stopsFor()` treats as open egress. It throws `SandboxPolicyMismatchError` with the field `readBack` when Vercel
 * reports no policy, `network.allow` when the policy sets `subnets.allow`, and `settings` when the credential rules or
 * the denied ranges differ from what was sent. The message never names a host, a header or a value.
 */
export function readBackHosts(reported: NetworkPolicy | undefined, expected: CompiledFirewall): string[] {
  if (reported === undefined) throw new SandboxPolicyMismatchError("readBack");
  if (reported === "allow-all") return ["*"];
  if (reported === "deny-all") {
    if (expected.injections.length > 0) throw new SandboxPolicyMismatchError("settings");
    return [];
  }
  if (typeof reported !== "object" || reported === null) throw new SandboxPolicyMismatchError("readBack");
  checkReportedSubnets(reported.subnets, expected);
  const allow = reported.allow ?? [];
  const injections = Array.isArray(allow) ? [] : reportedInjections(allow);
  if (!sameInjections(injections, expected.injections)) throw new SandboxPolicyMismatchError("settings");
  return Array.isArray(allow) ? [...allow] : Object.keys(allow);
}

/** Throws unless the reported ranges set no `subnets.allow` and deny every range that was sent. */
function checkReportedSubnets(subnets: { allow?: string[]; deny?: string[] } | undefined, expected: CompiledFirewall) {
  if (subnets?.allow !== undefined && subnets.allow.length > 0) {
    throw new SandboxPolicyMismatchError("network.allow", {
      reason: "the firewall's subnets.allow lets traffic go around the domain allowlist",
    });
  }
  const denied = new Set(subnets?.deny ?? []);
  if (!expected.deniedSubnets.every((range) => denied.has(range))) throw new SandboxPolicyMismatchError("settings");
}
