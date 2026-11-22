/**
 * The one place a sandbox policy grows: by exactly the path or host one denial named, and never to host-wide access.
 * Only the escalation runner calls it, with the denial from a verified, signed record and the policy that record
 * holds. No tool input or model output reaches it.
 */
import { ipv4Of, isAddressLiteral, isLocalAddress } from "../credentials/addresses.js";
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

// Names that resolve to the host itself on common systems without asking DNS.
const LOCAL_NAMES: readonly string[] = ["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"];
// A last label that a URL parser or `inet_aton()` reads as a number, which makes the whole host an IPv4 address.
const NUMERIC_LABEL = /^(?:0x[0-9a-f]*|[0-9]+)$/;

/**
 * True for a host and optional port that a rerun may be allowed to reach. An address must be written in its one
 * canonical form, so it can be compared with a deny entry: an IPv4 address as four decimal octets with no leading
 * zero, and an IPv6 address that does not wrap an IPv4 one. A host whose last label is a number is an IPv4 address, so
 * `127.1`, `2130706433` and `0x7f.1` are refused rather than read as names. A host that reaches the machine itself or
 * its link is never widened, whatever `deny` says: `localhost` and the names under it, and the unspecified, loopback
 * and link-local addresses, which hold the cloud metadata address.
 */
function isWidenableHost(target: string): boolean {
  if (target.length > 255) return false;
  const host = hostOf(target);
  if (IPV6.test(target)) return isAddressLiteral(host) && ipv4Of(host) === undefined && !isLocalAddress(host);
  if (!HOST.test(target)) return false;
  if (LOCAL_NAMES.includes(host) || host.endsWith(".localhost")) return false;
  const last = host.slice(host.lastIndexOf(".") + 1);
  if (NUMERIC_LABEL.test(last)) return isAddressLiteral(host) && !isLocalAddress(host);
  return true;
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

/** One part of an IPv4 address as `inet_aton()` reads it: decimal, octal after a `0`, or hex after `0x`. */
function looseOctets(part: string): number | undefined {
  if (/^0x[0-9a-f]*$/.test(part)) return part.length === 2 ? 0 : Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
  return /^(?:0|[1-9][0-9]*)$/.test(part) ? Number(part) : undefined;
}

/**
 * The IPv4 address a deny entry's host names in any form `inet_aton()` accepts (`127.1`, `2130706433`, `0x7f.0.0.1`,
 * `0177.0.0.1`), or in an IPv6 form that wraps one, as a number. `undefined` when it names no IPv4 address.
 */
function denyIpv4(pattern: string): number | undefined {
  if (isIpv6(pattern)) return ipv4Of(pattern);
  const parts = pattern.split(".");
  if (parts.length > 4) return undefined;
  const values: number[] = [];
  for (const part of parts) {
    const value = looseOctets(part);
    if (value === undefined || !Number.isSafeInteger(value)) return undefined;
    values.push(value);
  }
  const last = values.pop() as number;
  if (values.some((value) => value > 255) || last >= 256 ** (4 - values.length)) return undefined;
  return values.reduce((sum, value, index) => sum + value * 256 ** (3 - index), 0) + last;
}

/**
 * True when an entry of `deny` closes `target` on some port. An entry matches as `srt` matches a denied domain: `*`
 * matches every host, `*.name` every name under `name` but not `name` itself, and any other entry the host alone, with
 * case ignored. A `*.name` entry also closes an IPv4 address that ends in `.name`, which `srt` would not match. That
 * errs towards not asking. An entry's port is ignored, so a host closed on one port is never widened on any. An IPv4
 * target is closed by an entry that names the same address in any spelling, such as `127.1`, `2130706433` or an IPv6
 * form that wraps it. An IPv6 address counts as closed while `deny` names any IPv6 address, because one address has
 * many spellings. A loopback or link-local entry needs no rule of its own: `isWidenableHost()` refuses every such
 * target. A name that DNS resolves to a closed address can't be seen here; the backend's own deny list covers it.
 */
function isClosed(deny: readonly string[], target: string): boolean {
  const host = hostOf(target);
  const address = isIpv6(host) ? undefined : ipv4Of(host);
  return deny.some((entry) => {
    const pattern = hostOf(entry);
    if (pattern === "*") return true;
    if (isIpv6(host)) return isIpv6(pattern);
    if (address !== undefined && denyIpv4(pattern) === address) return true;
    if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}

const plus = (list: readonly string[], item: string): string[] => (list.includes(item) ? [...list] : [...list, item]);

/**
 * `policy` with exactly the denial's target added, or `undefined` when the denial can't be widened: a path that is the
 * root, relative or untidy, a host with a wildcard or anything but a host and port, an address in a form other than
 * its canonical one, a host that reaches the machine itself or its link (see `isWidenableHost()`), or a host an entry
 * of the policy's own `network.deny` closes (see `isClosed()`), since the host closed it on purpose.
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
