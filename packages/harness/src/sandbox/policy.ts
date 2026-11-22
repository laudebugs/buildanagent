/**
 * What a sandbox's applied policy delivers, and the checks around it: `stopsFor()` computes the stops from a tier and a
 * policy, `policyDifference()` compares two policies field by field, and `confirmPolicy()` reads a provisioned
 * sandbox's policy back and throws when it differs from the request. The capability helpers refuse a resume, snapshot
 * or pause that the backend doesn't list. It is portable: it imports no Node module.
 */
import { SandboxPolicyMismatchError, SandboxUnsupportedError } from "./errors.js";
import type { Sandbox, SandboxCapability, SandboxClient, SandboxPolicy, SandboxStop, SandboxTier } from "./types.js";

/**
 * The method by which `resumeSandbox()` sets the stops of a sandbox whose `stops` is a getter, such as a backend
 * sandbox's, so that a later `confirm()` still updates what the getter reads. It is internal to the package.
 */
export const APPLY_STOPS: unique symbol = Symbol("applyStops");

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

// Why the applied policy can't deliver each stop, in words that hold no path or host from either policy.
const UNDELIVERED: Record<SandboxStop, string> = {
  mistakes: "the policy reads or writes the whole disk, so the sandbox cannot stop mistakes",
  exfiltration: "the policy allows all hosts, so the sandbox cannot stop exfiltration",
  hostile_process: "this tier shares a kernel with the host, so the sandbox cannot stop a hostile process",
};

/** The options of `confirmPolicy()`. */
interface ConfirmOptions {
  /** Whether a mismatch disposes the sandbox before it is thrown. Defaults to `true`. */
  readonly dispose?: boolean;
}

/**
 * Reads back the policy `sandbox` applied and compares it with `requested`. It resolves with the stops the applied
 * policy delivers, and it throws `SandboxPolicyMismatchError` when a field differs, when the client claims a stop that
 * the applied policy doesn't deliver (`stops`, with the cause in the message), or when a client that claims a stop has
 * no read-back or its read-back fails (`readBack`, or the read-back's own field when it threw a mismatch). A client
 * that claims no stop needs no read-back. It disposes the sandbox before it throws, unless `options.dispose` is
 * `false`, which leaves the sandbox to the caller.
 */
export async function confirmPolicy(
  client: SandboxClient,
  sandbox: Sandbox,
  requested: SandboxPolicy,
  options: ConfirmOptions = {},
): Promise<readonly SandboxStop[]> {
  const refuse = async (field: string, more?: { cause?: unknown; reason?: string }): Promise<never> => {
    if (options.dispose !== false) await sandbox.dispose().catch(() => undefined);
    throw new SandboxPolicyMismatchError(field, more);
  };
  if (typeof sandbox.readBack !== "function") {
    if (client.stops.length === 0) return [];
    return refuse("readBack");
  }
  let applied: SandboxPolicy;
  try {
    applied = await sandbox.readBack();
  } catch (error) {
    // A read-back that found the mismatch itself, such as a settings file with another write root, names its field.
    return refuse(error instanceof SandboxPolicyMismatchError ? error.field : "readBack", { cause: error });
  }
  const field = policyDifference(requested, applied);
  if (field !== undefined) return refuse(field);
  const delivered = stopsFor(client.tier, applied);
  const missing = client.stops.filter((stop) => !delivered.includes(stop));
  if (missing.length > 0) {
    return refuse("stops", { reason: [...new Set(missing)].map((stop) => UNDELIVERED[stop]).join("; ") });
  }
  return delivered;
}

/** Whether `client` lists `capability`. A client that lists none has none. */
export function hasCapability(client: SandboxClient, capability: SandboxCapability): boolean {
  return Array.isArray(client.capabilities) && client.capabilities.includes(capability);
}

/**
 * Reattaches to a sandbox by its id, or starts one from a snapshot's id, then confirms its policy as `provision()`
 * does and sets the sandbox's `stops` to what the confirmed policy delivers. It throws `SandboxUnsupportedError` when
 * the client doesn't list `resume` or has no `resume()`, and `SandboxPolicyMismatchError` when the resumed sandbox's
 * policy differs from `policy`. A mismatch does not dispose the sandbox, which may be a paused one worth keeping: the
 * caller decides whether to dispose it, and must not run anything in it under the requested policy.
 */
export async function resumeSandbox(client: SandboxClient, id: string, policy: SandboxPolicy): Promise<Sandbox> {
  if (!hasCapability(client, "resume") || typeof client.resume !== "function") {
    throw new SandboxUnsupportedError("resume", client.tier);
  }
  const sandbox = await client.resume(id, policy);
  const stops = await confirmPolicy(client, sandbox, policy, { dispose: false });
  const apply = (sandbox as { [APPLY_STOPS]?: (stops: readonly SandboxStop[]) => void })[APPLY_STOPS];
  if (typeof apply === "function") {
    // An own `stops` would shadow the getter, so a later confirm() could no longer change what the sandbox reports.
    apply.call(sandbox, stops);
    return sandbox;
  }
  const set = Reflect.defineProperty(sandbox, "stops", { value: stops, enumerable: true, configurable: true });
  if (!set && !sameEntries(sandbox.stops ?? [], stops)) {
    throw new SandboxPolicyMismatchError("stops", { reason: "the resumed sandbox's stops can't be set" });
  }
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
