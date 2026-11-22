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

const plus = (list: readonly string[], item: string): string[] => (list.includes(item) ? [...list] : [...list, item]);

/**
 * `policy` with exactly the denial's target added, or `undefined` when the denial can't be widened: a path that is the
 * root, relative or untidy, a host with a wildcard or anything but a host and port, or a host the policy's own
 * `network.deny` names, since the host closed it on purpose.
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
      if (!isWidenableHost(host) || network.deny.includes(host)) return undefined;
      return { ...base, network: { ...base.network, allow: plus(network.allow, host) } };
    }
    default:
      return undefined;
  }
}
