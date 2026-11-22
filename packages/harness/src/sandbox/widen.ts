/**
 * The one place a sandbox policy grows: by exactly the path or host one denial named, and never to host-wide access.
 * Only the escalation runner calls it, with the denial from a verified, signed record and the policy that record
 * holds. No tool input or model output reaches it.
 */
import type { SandboxDenial, SandboxPolicy } from "./types.js";

// A plain host name or address with an optional port: no wildcard, no scheme, no path and no user.
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::[0-9]{1,5})?$/;
const IPV6 = /^\[[0-9a-f:.]+\](?::[0-9]{1,5})?$/;

/** True for an absolute POSIX path in its tidy form, below the root: no `.`, `..`, empty segment or NUL. */
function isWidenablePath(target: string): boolean {
  if (!target.startsWith("/") || target === "/" || target.includes("\u0000")) return false;
  const parts = target.slice(1).split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function isWidenableHost(target: string): boolean {
  return target.length <= 255 && (HOST.test(target) || IPV6.test(target));
}

const KINDS: readonly string[] = ["filesystem_read", "filesystem_write", "network"];

/** True when `value` has the shape of a `SandboxDenial`. A record read from the log is checked with it. */
export function isDenial(value: unknown): value is SandboxDenial {
  if (typeof value !== "object" || value === null) return false;
  const denial = value as Record<string, unknown>;
  return (
    KINDS.includes(denial.kind as string) && typeof denial.target === "string" && typeof denial.reason === "string"
  );
}

/** The host of a host-and-port entry, in lower case: brackets off an IPv6 address, and any `:port` and trailing dot off. */
function hostOf(entry: string): string {
  const lower = entry.trim().toLowerCase();
  if (lower.startsWith("[")) {
    const close = lower.indexOf("]");
    return close < 0 ? lower : lower.slice(1, close);
  }
  const colon = lower.lastIndexOf(":");
  // Two or more colons are an IPv6 address without brackets, which has no port to take off.
  const host = colon >= 0 && lower.indexOf(":") === colon ? lower.slice(0, colon) : lower;
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

const isIpv6 = (host: string): boolean => host.includes(":");

/**
 * True when an entry of `deny` closes `target` on some port. An entry matches as `srt` matches a denied domain: `*`
 * matches every host, `*.name` every name under `name` but not `name` itself, and any other entry the host alone, with
 * case ignored. A `*.name` entry also closes an IPv4 address that ends in `.name`, which `srt` would not match, so
 * the check errs towards asking no one. An entry's port is ignored, so a host closed on one port is never widened on any. An IPv6 address
 * counts as closed while `deny` names any IPv6 address, because one address has many spellings.
 */
function isClosed(deny: readonly string[], target: string): boolean {
  const host = hostOf(target);
  return deny.some((entry) => {
    const pattern = hostOf(entry);
    if (pattern === "*") return true;
    if (isIpv6(host)) return isIpv6(pattern);
    if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}

const plus = (list: readonly string[], item: string): string[] => (list.includes(item) ? [...list] : [...list, item]);

/**
 * `policy` with exactly the denial's target added, or `undefined` when the denial can't be widened: a path that is the
 * root, relative or untidy, a host with a wildcard or anything but a host and port, or a host an entry of the policy's
 * own `network.deny` closes (see `isClosed()`), since the host closed it on purpose and the rerun would be denied again.
 */
export function widenPolicy(policy: SandboxPolicy, denial: SandboxDenial): SandboxPolicy | undefined {
  const { readRoots, writeRoots, network } = policy;
  const base = {
    readRoots: [...readRoots],
    writeRoots: [...writeRoots],
    network: { allow: [...network.allow], deny: [...network.deny] },
  };
  switch (denial.kind) {
    case "filesystem_read":
      return isWidenablePath(denial.target) ? { ...base, readRoots: plus(readRoots, denial.target) } : undefined;
    case "filesystem_write":
      return isWidenablePath(denial.target) ? { ...base, writeRoots: plus(writeRoots, denial.target) } : undefined;
    case "network": {
      const host = denial.target;
      if (!isWidenableHost(host) || isClosed(network.deny, host)) return undefined;
      return { ...base, network: { ...base.network, allow: plus(network.allow, host) } };
    }
    default:
      return undefined;
  }
}
