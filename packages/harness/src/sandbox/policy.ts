/**
 * What a sandbox's applied policy delivers, and the checks around it: `stopsFor()` computes the stops from a tier and a
 * policy, `policyDifference()` compares two policies field by field, and `confirmPolicy()` reads a provisioned
 * sandbox's policy back and throws when it differs from the request. The capability helpers refuse a resume, snapshot
 * or pause that the backend doesn't list. It is portable: it imports no Node module.
 */
import { SandboxPolicyMismatchError, SandboxUnsupportedError } from "./errors.js";
import type { Sandbox, SandboxCapability, SandboxClient, SandboxPolicy, SandboxStop, SandboxTier } from "./types.js";

// Allowlist entries a hosted provider reads as "every host", so a policy holding one leaves egress open.
const OPEN_EGRESS = new Set(["*", "0.0.0.0/0", "::/0"]);

/** Whether a root is the whole file system, however many slashes it is written with. */
const isWholeDisk = (root: string): boolean => /^\/+$/.test(root);

/**
 * The stops a backend of `tier` delivers under `policy`. A `none` tier stops nothing. Any other tier stops `mistakes`
 * unless a root is `/`, and `exfiltration` unless the allowlist holds an entry that opens every host (`*`, `0.0.0.0/0`
 * or `::/0`). Only a `microvm` stops a `hostile_process`, because every other tier shares a kernel with the host or
 * relies on one that runs in user space.
 */
export function stopsFor(tier: SandboxTier, policy: SandboxPolicy): SandboxStop[] {
  if (tier === "none") return [];
  const stops: SandboxStop[] = [];
  if (![...policy.readRoots, ...policy.writeRoots].some(isWholeDisk)) stops.push("mistakes");
  if (!policy.network.allow.some((entry) => OPEN_EGRESS.has(entry.trim()))) stops.push("exfiltration");
  if (tier === "microvm") stops.push("hostile_process");
  return stops;
}

/** Whether `value` is a list of strings, which is the only shape a policy's lists may have. */
const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Whether two lists hold the same entries, ignoring order and repeats. */
function sameEntries(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((entry) => b.has(entry));
}

/**
 * The first field in which `applied` differs from `requested`, or `undefined` when they hold the same entries. The
 * fields are compared as sets in the order `readRoots`, `writeRoots`, `network.allow`, `network.deny`, and a field
 * that isn't a list of strings differs. Paths and hosts compare as written, so a backend reads back in the request's
 * spelling.
 */
export function policyDifference(requested: SandboxPolicy, applied: SandboxPolicy): string | undefined {
  const network = (applied as { network?: unknown }).network as Partial<SandboxPolicy["network"]> | undefined;
  const fields: [string, readonly string[], unknown][] = [
    ["readRoots", requested.readRoots, (applied as { readRoots?: unknown }).readRoots],
    ["writeRoots", requested.writeRoots, (applied as { writeRoots?: unknown }).writeRoots],
    ["network.allow", requested.network.allow, network?.allow],
    ["network.deny", requested.network.deny, network?.deny],
  ];
  for (const [field, wanted, got] of fields) {
    if (!isStringList(got) || !sameEntries(wanted, got)) return field;
  }
  return undefined;
}

/** Disposes the sandbox, ignoring a failure, and throws the mismatch. */
async function refuse(sandbox: Sandbox, field: string, cause?: unknown): Promise<never> {
  await sandbox.dispose().catch(() => undefined);
  throw new SandboxPolicyMismatchError(field, cause === undefined ? undefined : { cause });
}

/**
 * Reads back the policy `sandbox` applied and compares it with `requested`. It resolves with the stops the applied
 * policy delivers, and it disposes the sandbox and throws `SandboxPolicyMismatchError` when a field differs, when the
 * client claims a stop that the applied policy doesn't deliver (`stops`), or when a client that claims a stop has no
 * read-back or its read-back fails (`readBack`). A client that claims no stop needs no read-back.
 */
export async function confirmPolicy(
  client: SandboxClient,
  sandbox: Sandbox,
  requested: SandboxPolicy,
): Promise<readonly SandboxStop[]> {
  if (typeof sandbox.readBack !== "function") {
    if (client.stops.length === 0) return [];
    return refuse(sandbox, "readBack");
  }
  let applied: SandboxPolicy;
  try {
    applied = await sandbox.readBack();
  } catch (error) {
    return refuse(sandbox, "readBack", error);
  }
  const field = policyDifference(requested, applied);
  if (field !== undefined) return refuse(sandbox, field);
  const delivered = stopsFor(client.tier, applied);
  if (!client.stops.every((stop) => delivered.includes(stop))) return refuse(sandbox, "stops");
  return delivered;
}

/** Whether `client` lists `capability`. A client that lists none has none. */
export function hasCapability(client: SandboxClient, capability: SandboxCapability): boolean {
  return Array.isArray(client.capabilities) && client.capabilities.includes(capability);
}

/**
 * Reattaches to a sandbox by its id, or starts one from a snapshot's id, then confirms its policy as `provision()`
 * does. It throws `SandboxUnsupportedError` when the client doesn't list `resume` or has no `resume()`, and
 * `SandboxPolicyMismatchError` when the resumed sandbox's policy differs from `policy`.
 */
export async function resumeSandbox(client: SandboxClient, id: string, policy: SandboxPolicy): Promise<Sandbox> {
  if (!hasCapability(client, "resume") || typeof client.resume !== "function") {
    throw new SandboxUnsupportedError("resume", client.tier);
  }
  const sandbox = await client.resume(id, policy);
  await confirmPolicy(client, sandbox, policy);
  return sandbox;
}

/** Snapshots `sandbox` and resolves with the id `resumeSandbox()` takes, or throws `SandboxUnsupportedError`. */
export async function snapshotSandbox(client: SandboxClient, sandbox: Sandbox): Promise<string> {
  if (!hasCapability(client, "snapshot") || typeof sandbox.snapshot !== "function") {
    throw new SandboxUnsupportedError("snapshot", client.tier);
  }
  return sandbox.snapshot();
}

/** Pauses `sandbox` until `resumeSandbox()` with its `id`, or throws `SandboxUnsupportedError`. */
export async function pauseSandbox(client: SandboxClient, sandbox: Sandbox): Promise<void> {
  if (!hasCapability(client, "pause") || typeof sandbox.pause !== "function") {
    throw new SandboxUnsupportedError("pause", client.tier);
  }
  await sandbox.pause();
}
