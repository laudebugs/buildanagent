/**
 * `@buildanagent/harness/sandbox/vercel`: the microVM-tier backend on Vercel Sandbox. Each sandbox is a Firecracker VM
 * whose only way out is Vercel's firewall, which the backend sets to exactly the policy's hosts and to deny-all when
 * the policy names none. A header route's credential is put in a firewall `transform` rule, which adds the header
 * outside the VM, so no credential value enters the sandbox's environment, files or command lines. `provision()` reads
 * the firewall policy back from Vercel and throws on any difference, and a sandbox that fails or is disposed is
 * deleted. It needs `@vercel/sandbox` 3.9.1, an optional peer dependency.
 *
 * @module @buildanagent/harness/sandbox/vercel
 */
import type { EgressPolicy } from "../../credentials/egress-policy.js";
import { scrubString } from "../../credentials/scrub.js";
import { HarnessError } from "../../errors.js";
import { SandboxUnavailableError } from "../errors.js";
import type { Sandbox, SandboxCapability, SandboxClient, SandboxPolicy, WorkspaceManifest } from "../types.js";
import { type CompiledFirewall, compileFirewall, VERCEL_DENIED_SUBNETS } from "./firewall.js";
import { guarded, VercelSandbox } from "./handle.js";
import { checkAbsolute, inside, normalize } from "./paths.js";
import { type VercelCreateParams, type VercelSandboxSdk, vercelSandboxSdk } from "./sdk.js";

export { checkVercelNetworkPolicy, VERCEL_DENIED_SUBNETS, VercelSecretError } from "./firewall.js";
export {
  type VercelCommand,
  type VercelCreateParams,
  type VercelCredentials,
  type VercelFinishedCommand,
  type VercelRunParams,
  type VercelSandboxInstance,
  type VercelSandboxSdk,
  vercelSandboxSdk,
} from "./sdk.js";

/** The options of `vercelSandbox()`. */
export interface VercelSandboxOptions {
  /** The `@vercel/sandbox` client. Defaults to `vercelSandboxSdk()`, which finds its credentials on its own. */
  readonly sdk?: VercelSandboxSdk;
  /**
   * The hosts and credential routes the sandbox may use. Its hosts, those in `allow` and those of its routes, must be
   * exactly the `network.allow` of each policy `provision()` is given. Without it, `network.allow` is the whole
   * allowlist and no credential is injected. A git route is refused, because the firewall can't filter git's refs.
   */
  readonly egress?: EgressPolicy;
  /**
   * Reads a credential that a route names, on the host, when a sandbox is provisioned or resumed. It resolves with the
   * header's whole value, such as `Bearer ghp_…` for an `authorization` header. Needed when `egress` has a route.
   */
  readonly secret?: (name: string) => Promise<string>;
  /** Address ranges the firewall refuses, even for an allowed host that resolves to one. Defaults to `VERCEL_DENIED_SUBNETS`. */
  readonly deniedSubnets?: readonly string[];
  /** Milliseconds before Vercel stops a sandbox on its own, which ends one the host lost. Defaults to 30 minutes. */
  readonly timeoutMs?: number;
  /** Whether a stopped sandbox keeps its files, which `pause` needs. Defaults to `false`. */
  readonly persistent?: boolean;
  /** The image to start from. Leaving it out uses Vercel's default image. */
  readonly image?: string;
  /** The virtual CPUs of each sandbox: 1, or an even number from 2 to 32. Leaving it out uses Vercel's default, 2. */
  readonly vcpus?: number;
  /** Makes the name of each new sandbox. Defaults to `harness-` and 16 random hex digits. */
  readonly name?: () => string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
// A name Vercel takes for a sandbox and a resume id can't be mistaken for a snapshot's.
const SANDBOX_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SNAPSHOT_PREFIX = "snapshot:";

/** A sandbox name from the platform's random source, which every runtime the harness targets has. */
function randomName(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `harness-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Throws `invalid_sandbox_options` unless the options can be used. */
function checkOptions(options: VercelSandboxOptions): void {
  const bad = (what: string) => new HarnessError("invalid_sandbox_options", `${what} is not usable`);
  const { timeoutMs, vcpus, secret, egress, image } = options;
  if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs > 0)) throw bad("timeoutMs");
  // Vercel provisions 1 vCPU or an even number from 2 to 32, as the plan allows.
  if (
    vcpus !== undefined &&
    !(vcpus === 1 || (Number.isInteger(vcpus) && vcpus % 2 === 0 && vcpus >= 2 && vcpus <= 32))
  ) {
    throw bad("vcpus");
  }
  if (image !== undefined && (typeof image !== "string" || image === "")) throw bad("image");
  if (secret !== undefined && typeof secret !== "function") throw bad("secret");
  if ((egress?.routes.length ?? 0) > 0 && secret === undefined) {
    throw new HarnessError("invalid_sandbox_options", "an egress policy with a route needs a secret function");
  }
}

/** Whether two lists hold the same entries, ignoring order and repeats. */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((entry) => b.has(entry));
}

/** The egress policy for `policy`: the configured one, which must name the same hosts, or the bare allowlist. */
function egressFor(policy: SandboxPolicy, configured: EgressPolicy | undefined): EgressPolicy {
  const { allow, deny } = policy.network;
  if (allow.some((host) => deny.includes(host))) {
    throw new HarnessError("invalid_sandbox_options", "a host can't be both allowed and denied");
  }
  if (configured === undefined) return { allow: [...allow], routes: [] };
  const hosts = [...configured.allow, ...configured.routes.map((route) => route.host)];
  if (!sameSet(hosts, allow)) {
    throw new HarnessError(
      "invalid_sandbox_options",
      "the policy's network.allow must list exactly the hosts of the egress policy, its routes' hosts included",
    );
  }
  return configured;
}

/** Throws unless the roots are absolute and the workspace lies in one of them. */
function checkLayout(root: string, policy: SandboxPolicy): void {
  checkAbsolute([root], "the workspace root");
  checkAbsolute([...policy.readRoots, ...policy.writeRoots], "a sandbox root");
  const roots = [...policy.readRoots, ...policy.writeRoots].map(normalize);
  if (!roots.some((candidate) => inside(candidate, normalize(root)))) {
    throw new HarnessError("invalid_sandbox_options", "the workspace root must lie inside a read or write root");
  }
}

/** What provisioning and resuming share. */
interface Backend {
  readonly sdk: VercelSandboxSdk;
  readonly options: VercelSandboxOptions;
  readonly client: SandboxClient;
}

/** Compiles the firewall for `policy`, reading each credential once. */
function firewallFor(backend: Backend, policy: SandboxPolicy): Promise<CompiledFirewall> {
  const { options } = backend;
  return compileFirewall(egressFor(policy, options.egress), {
    secret: options.secret ?? (async () => ""),
    deniedSubnets: options.deniedSubnets ?? VERCEL_DENIED_SUBNETS,
  });
}

/** Deletes the sandbox called `name` if it exists, for a create that failed after Vercel may have made it. */
async function deleteIfMade(sdk: VercelSandboxSdk, name: string): Promise<void> {
  try {
    const made = await sdk.get({ name });
    await made.stop().catch(() => undefined);
    await made.delete();
  } catch {
    // Most often it was never made. Vercel stops one that was at its timeout either way.
  }
}

/** Creates the VM, or deletes what a failed create left and throws `SandboxUnavailableError`. */
async function createVm(backend: Backend, firewall: CompiledFirewall, snapshotId: string | undefined) {
  const { sdk, options } = backend;
  const name = (options.name ?? randomName)();
  if (!SANDBOX_NAME.test(name)) throw new HarnessError("invalid_sandbox_options", "the sandbox name is not usable");
  const params: VercelCreateParams = {
    name,
    networkPolicy: firewall.networkPolicy,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    persistent: options.persistent ?? false,
    ...(snapshotId === undefined ? {} : { source: { type: "snapshot", snapshotId } }),
    ...(snapshotId !== undefined || options.image === undefined ? {} : { image: options.image }),
    ...(options.vcpus === undefined ? {} : { vcpus: options.vcpus }),
  };
  try {
    return await sdk.create(params);
  } catch (error) {
    await deleteIfMade(sdk, name);
    // The request carried the credential values, so neither the message nor a cause may quote it.
    const message = error instanceof Error ? scrubString(error.message, guarded(firewall.secrets)) : "an unknown error";
    throw new SandboxUnavailableError("vercel", `the sandbox could not be created: ${message}`);
  }
}

/** Prepares a new sandbox's roots, confirms its policy and writes the manifest, or deletes the sandbox and throws. */
async function finish(sandbox: VercelSandbox, backend: Backend, policy: SandboxPolicy, manifest?: WorkspaceManifest) {
  try {
    await sandbox.prepareRoots();
    await sandbox.confirm(backend.client, policy);
    const encoder = new TextEncoder();
    for (const [path, data] of Object.entries(manifest?.files ?? {})) {
      await sandbox.writeFile(path, typeof data === "string" ? encoder.encode(data) : data);
    }
    return sandbox;
  } catch (error) {
    await sandbox.dispose().catch(() => undefined);
    throw error;
  }
}

/** Starts a sandbox from `snapshotId`, or a fresh one, for `root` under `policy`. */
async function start(
  backend: Backend,
  root: string,
  policy: SandboxPolicy,
  snapshotId?: string,
  manifest?: WorkspaceManifest,
) {
  checkLayout(root, policy);
  const firewall = await firewallFor(backend, policy);
  const vm = await createVm(backend, firewall, snapshotId);
  const persistent = backend.options.persistent ?? false;
  const sandbox = new VercelSandbox({ sdk: backend.sdk, vm, root, requested: policy, firewall, persistent });
  return finish(sandbox, backend, policy, manifest);
}

/** Reattaches to the sandbox called `name`, and applies the policy again with credentials read now. */
async function reattach(backend: Backend, name: string, policy: SandboxPolicy): Promise<Sandbox> {
  if (!SANDBOX_NAME.test(name)) throw new HarnessError("invalid_sandbox_options", "the sandbox id is not usable");
  const root = policy.writeRoots[0] ?? policy.readRoots[0] ?? "";
  checkLayout(root, policy);
  const firewall = await firewallFor(backend, policy);
  const vm = await backend.sdk.get({ name, resume: true }).catch((error: unknown) => {
    throw new SandboxUnavailableError("vercel", `the sandbox ${name} could not be found`, { cause: error });
  });
  await vm.update({ networkPolicy: firewall.networkPolicy }).catch((error: unknown) => {
    const message = error instanceof Error ? scrubString(error.message, guarded(firewall.secrets)) : "an unknown error";
    throw new SandboxUnavailableError("vercel", `the sandbox's network policy could not be applied: ${message}`);
  });
  const persistent = backend.options.persistent ?? false;
  const sandbox = new VercelSandbox({ sdk: backend.sdk, vm, root, requested: policy, firewall, persistent });
  await sandbox.prepareRoots();
  return sandbox;
}

/**
 * Builds the Vercel Sandbox backend: tier `microvm`, claiming `mistakes`, `exfiltration` and `hostile_process`.
 *
 * `provision()` compiles the policy's network into a firewall policy that allows exactly its hosts, denies every other
 * host and the ranges in `deniedSubnets`, and is `"deny-all"` when it names no host. It reads each credential an `egress`
 * route names, and a credential that can't be read throws `VercelSecretError`, which names it, before anything is made.
 * It then creates the sandbox with no environment variable, makes the write roots, reads the firewall policy back from
 * Vercel and throws `SandboxPolicyMismatchError` on any difference, and writes the manifest's files. A failure after the
 * sandbox was made deletes it. The roots are checked on the file calls and on a command's working directory, against
 * each path resolved inside the VM; a command itself can touch the whole VM, which holds nothing of the host's.
 *
 * It can `resume` and `snapshot`, and also `pause` when `persistent` is set. A resume by a sandbox's `id` reattaches to
 * it, and a resume by a snapshot's id starts a new sandbox from it. Both apply the policy's firewall again, with each
 * credential read anew, and resolve relative paths against the policy's first write root.
 */
export function vercelSandbox(options: VercelSandboxOptions = {}): SandboxClient {
  checkOptions(options);
  const capabilities: SandboxCapability[] =
    options.persistent === true ? ["resume", "snapshot", "pause"] : ["resume", "snapshot"];
  const client: SandboxClient = {
    tier: "microvm",
    stops: ["mistakes", "exfiltration", "hostile_process"],
    capabilities,
    provision: (manifest, policy) => start(backend(), manifest.root, policy, undefined, manifest),
    async resume(id, policy) {
      if (!id.startsWith(SNAPSHOT_PREFIX)) return reattach(backend(), id, policy);
      const snapshotId = id.slice(SNAPSHOT_PREFIX.length);
      if (snapshotId === "") throw new HarnessError("invalid_sandbox_options", "the snapshot id is empty");
      return start(backend(), policy.writeRoots[0] ?? policy.readRoots[0] ?? "", policy, snapshotId);
    },
  };
  // The real client is built on first use, so building the backend reads no credential.
  let sdk = options.sdk;
  const backend = (): Backend => {
    sdk ??= vercelSandboxSdk();
    return { sdk, options, client };
  };
  return client;
}
