/**
 * `@buildanagent/harness/sandbox/e2b`: the E2B backend, a Firecracker microVM per sandbox, reached through the `e2b`
 * SDK. Egress is closed by default: the sandbox reaches exactly the hosts of its policy, by name, and nothing else.
 * An `EgressPolicy` adds credentials as E2B Secrets that E2B's egress proxy injects outside the sandbox, keyed on host,
 * and provisioning fails when a secret doesn't exist, because E2B would silently send the request without it. It
 * claims all three stops, reads its network policy back from E2B after it provisions, and can pause and resume.
 *
 * The SDK is an optional peer: pass `sdk: { Sandbox, Secret }` from `e2b`, or install `e2b` and the backend loads it on
 * first use. The module imports no Node module, so it runs on any target the SDK runs on.
 *
 * @module @buildanagent/harness/sandbox/e2b
 */
import type { EgressPolicy } from "../../credentials/egress-policy.js";
import { HarnessError } from "../../errors.js";
import {
  SandboxDeniedError,
  SandboxPolicyMismatchError,
  SandboxSecretUnresolvedError,
  SandboxUnavailableError,
} from "../errors.js";
import { APPLY_STOPS, confirmPolicy } from "../policy.js";
import { checkCommand, checkOptions } from "../process.js";
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxCapability,
  SandboxClient,
  SandboxPolicy,
  SandboxStop,
  WorkspaceManifest,
} from "../types.js";
import { commandString, killGroupString } from "./command.js";
import {
  checkAllowList,
  compileE2BEgress,
  type E2BCompiledEgress,
  type E2BHeaderScheme,
  networkFromInfo,
  plainNetwork,
} from "./network.js";
import type { E2BCommandHandle, E2BConnectionOptions, E2BSandboxInstance, E2BSdk } from "./sdk.js";

export {
  compileE2BEgress,
  E2B_ALL_TRAFFIC,
  E2B_DEFAULT_DNS_SERVER,
  type E2BCompiledEgress,
  type E2BEgressOptions,
  type E2BHeaderScheme,
  type E2BSecretReference,
} from "./network.js";
export type {
  E2BCommandHandle,
  E2BCommandResult,
  E2BConnectionOptions,
  E2BCreateOptions,
  E2BNetworkInfo,
  E2BNetworkOptions,
  E2BNetworkRule,
  E2BRunOptions,
  E2BSandboxApi,
  E2BSandboxInfo,
  E2BSandboxInstance,
  E2BSandboxPaginator,
  E2BSdk,
  E2BSecretApi,
} from "./sdk.js";

/** The options of `e2bSandbox()`. */
export interface E2BSandboxOptions {
  /**
   * The SDK: `{ Sandbox, Secret }` from `e2b`, or a function that resolves with it. Without it, the backend imports
   * `e2b` on first use and throws `SandboxUnavailableError` when the package is missing.
   */
  readonly sdk?: E2BSdk | (() => Promise<E2BSdk>);
  /** The template to start from, by name or id. Pin it by id or tag. Defaults to `base`. */
  readonly template?: string;
  /**
   * How long a sandbox lives, in milliseconds, after which E2B kills it even if this process has died: the backstop for
   * a sandbox nobody disposed. Defaults to 15 minutes. E2B caps it at 1 hour on Hobby and 24 hours on Pro.
   */
  readonly timeoutMs?: number;
  /** The E2B API key, kept on the host. Without it, the SDK reads `E2B_API_KEY` from the host's environment. */
  readonly apiKey?: string;
  /** The E2B domain, for a self-hosted or BYOC deployment. */
  readonly domain?: string;
  /** How long one control-plane request may take, in milliseconds. Defaults to the SDK's 60 seconds. */
  readonly requestTimeoutMs?: number;
  /**
   * The credentials a sandbox's requests carry. Its `allow` and its routes' hosts together must be exactly the policy's
   * `network.allow`. Each header route's credential names an E2B Secret, which E2B's egress proxy adds to every HTTPS
   * request to the route's host. Git routes are refused.
   */
  readonly egress?: EgressPolicy;
  /** The E2B secret that holds a credential, by the credential's name. Defaults to the name in lower case. */
  readonly secretName?: (credential: string) => string;
  /** A word to put before a credential's placeholder in its header, by credential name, such as `Bearer`. */
  readonly schemes?: Readonly<Record<string, E2BHeaderScheme>>;
  /**
   * Must be `true` when `egress` has a route, to accept that E2B injects a route's header into every HTTPS request to
   * its host, from every process in the sandbox, whatever the method or path.
   */
  readonly unscopedInjection?: boolean;
}

/** The E2B backend's client: a `SandboxClient` that can resume and pause. */
export interface E2BSandboxClient extends SandboxClient {
  readonly tier: "microvm";
  resume(id: string, policy: SandboxPolicy): Promise<Sandbox>;
}

/** The metadata key that marks a sandbox with the provisioning attempt that created it, for the sweep after a failure. */
export const E2B_PROVISION_LABEL = "buildanagent-provision";
/** The metadata key that records a sandbox's workspace root, which `resume()` reads back. */
export const E2B_ROOT_LABEL = "buildanagent-root";

const BACKEND = "e2b";
const DEFAULT_TEMPLATE = "base";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
// E2B's longest sandbox life, on Pro.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_EXIT_CODE = 124;
const NOT_FOUND_EXIT_CODE = 127;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
// How often a kill that failed is tried again before `dispose()` gives up and leaves the sandbox to its timeout.
const KILL_ATTEMPTS = 3;
const STOPS: readonly SandboxStop[] = ["mistakes", "exfiltration", "hostile_process"];
const CAPABILITIES: readonly SandboxCapability[] = ["resume", "pause"];

const unavailable = (reason: string, cause?: unknown) =>
  new SandboxUnavailableError(BACKEND, reason, cause === undefined ? undefined : { cause });
const invalid = (message: string) => new HarnessError("invalid_sandbox_options", message);
const disposedError = () => new HarnessError("sandbox_disposed", "the sandbox was disposed");

/** Resolves `path` against `base` lexically, as POSIX does, and returns the absolute result. */
function resolvePath(base: string, path: string): string {
  const parts: string[] = [];
  for (const part of `${path.startsWith("/") ? "" : `${base}/`}${path}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Whether `path` is `root` or inside it. Both are absolute and normal. */
const insideRoot = (path: string, root: string): boolean =>
  root === "/" || path === root || path.startsWith(`${root}/`);

/** Throws unless `value` is a list of absolute paths, each one already normal. */
function checkRoots(value: unknown, where: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((root) => typeof root !== "string" || resolvePath("/", root) !== root)) {
    throw invalid(`${where} must be a list of absolute, normal paths`);
  }
}

/** Throws unless `root` is an absolute, normal workspace root inside one of `policy`'s write roots. */
function checkRoot(root: unknown, policy: SandboxPolicy): asserts root is string {
  if (typeof root !== "string" || resolvePath("/", root) !== root || root === "/") {
    throw invalid("the workspace root must be an absolute, normal path other than /");
  }
  if (!policy.writeRoots.some((writeRoot) => insideRoot(root, writeRoot))) {
    throw invalid("the workspace root must be inside a write root");
  }
}

/** The policy's checks that don't depend on E2B: absolute roots, exact hosts and no deny list. */
function checkPolicy(policy: SandboxPolicy): void {
  checkRoots(policy?.readRoots, "readRoots");
  checkRoots(policy.writeRoots, "writeRoots");
  if (!Array.isArray(policy.network?.allow) || !Array.isArray(policy.network.deny)) {
    throw invalid("a policy's network has an allow and a deny list");
  }
  checkAllowList(policy.network.allow, "network.allow");
  if (policy.network.deny.length > 0) {
    throw invalid("E2B can't deny a host name inside the allowlist, so network.deny must be empty");
  }
}

/** Whether two lists hold the same entries. */
const sameSet = (left: readonly string[], right: readonly string[]) =>
  new Set(left).size === new Set(right).size && left.every((entry) => right.includes(entry));

/** What a sandbox's handle needs from its client. */
interface Context {
  readonly sdk: E2BSdk;
  readonly connection: E2BConnectionOptions;
  readonly apiKey: string | undefined;
}

/** The output of one stream, kept up to a byte cap. */
class Capped {
  private readonly parts: string[] = [];
  private bytes = 0;
  truncated = false;
  private readonly encoder = new TextEncoder();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  add(data: string): void {
    if (this.truncated) return;
    const size = this.encoder.encode(data).byteLength;
    if (this.bytes + size <= this.limit) {
      this.parts.push(data);
      this.bytes += size;
      return;
    }
    // Keep what fits, cut on a character boundary, and drop the rest.
    let kept = "";
    for (const character of data) {
      const next = this.encoder.encode(character).byteLength;
      if (this.bytes + next > this.limit) break;
      kept += character;
      this.bytes += next;
    }
    this.parts.push(kept);
    this.truncated = true;
  }

  text(): string {
    return this.parts.join("");
  }
}

/** The exit code a finished command's error carries, such as the SDK's `CommandExitError`, or `undefined`. */
function exitCodeOf(error: unknown): number | undefined {
  const code = (error as { exitCode?: unknown } | null)?.exitCode;
  return typeof code === "number" ? code : undefined;
}

/** Whether the SDK's error says a file is missing. */
const isNotFound = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "FileNotFoundError" || name === "NotFoundError";
};

/** How a command ended: on its own, by a failure of the SDK, at its timeout, by its signal, or by a dispose or pause. */
type Outcome =
  | { readonly kind: "done"; readonly exitCode: number }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "abort" }
  | { readonly kind: "stopped" };

/** Waits for the first of a command's end, its timeout, its signal and `stopped`, and removes every listener after. */
async function settle(handle: E2BCommandHandle, options: ExecOptions, stopped: AbortSignal): Promise<Outcome> {
  const cleanups: (() => void)[] = [];
  const outcome = await new Promise<Outcome>((resolve) => {
    handle.wait().then(
      (result) => resolve({ kind: "done", exitCode: result.exitCode }),
      (error: unknown) => {
        const exitCode = exitCodeOf(error);
        resolve(exitCode === undefined ? { kind: "failed", error } : { kind: "done", exitCode });
      },
    );
    if (options.timeoutMs !== undefined) {
      const timer = setTimeout(() => resolve({ kind: "timeout" }), options.timeoutMs);
      cleanups.push(() => clearTimeout(timer));
    }
    const on = (signal: AbortSignal, kind: "abort" | "stopped") => {
      const listener = () => resolve({ kind });
      if (signal.aborted) listener();
      signal.addEventListener("abort", listener, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", listener));
    };
    on(options.signal, "abort");
    on(stopped, "stopped");
  });
  for (const cleanup of cleanups) cleanup();
  return outcome;
}

/** One provisioned or resumed E2B sandbox. */
class E2BSandbox implements Sandbox {
  readonly id: string;
  private applied: readonly SandboxStop[] = [];
  private state: "running" | "paused" | "disposed" = "running";
  private disposing: Promise<void> | undefined;
  private readonly stopped = new AbortController();
  private readonly instance: E2BSandboxInstance;
  private readonly context: Context;
  private readonly policy: SandboxPolicy;
  private readonly root: string;
  private readonly network: E2BCompiledEgress;

  constructor(
    instance: E2BSandboxInstance,
    context: Context,
    policy: SandboxPolicy,
    root: string,
    network: E2BCompiledEgress,
  ) {
    this.instance = instance;
    this.id = instance.sandboxId;
    this.context = context;
    this.policy = policy;
    this.root = root;
    this.network = network;
  }

  get stops(): readonly SandboxStop[] {
    return this.applied;
  }

  /** Reads the policy back and checks it, or disposes the sandbox and throws on a difference. */
  async confirm(client: SandboxClient, requested: SandboxPolicy): Promise<void> {
    this.applied = await confirmPolicy(client, this, requested);
  }

  [APPLY_STOPS](stops: readonly SandboxStop[]): void {
    this.applied = stops;
  }

  private live(): void {
    if (this.state === "disposed") throw disposedError();
    if (this.state === "paused") throw invalid("the sandbox is paused; resume it by its id");
  }

  /** Throws when `text` holds the E2B API key, which must never reach the sandbox. The message never quotes it. */
  private guard(text: string, where: string): void {
    const key = this.context.apiKey;
    if (key !== undefined && key !== "" && text.includes(key)) {
      throw invalid(`the ${where} holds the E2B API key, which must stay on the host`);
    }
  }

  private guardBytes(data: Uint8Array, where: string): void {
    const key = this.context.apiKey;
    if (key === undefined || key === "") return;
    this.guard(new TextDecoder("utf-8", { fatal: false }).decode(data), where);
  }

  /** The absolute path a file call names, or the denial a path outside the roots gets. */
  private target(path: string, kind: "filesystem_read" | "filesystem_write"): string {
    if (typeof path !== "string" || path.includes("\0")) throw invalid("a path is a string without a NUL character");
    const absolute = resolvePath(this.root, path);
    const roots =
      kind === "filesystem_write" ? this.policy.writeRoots : [...this.policy.readRoots, ...this.policy.writeRoots];
    if (!roots.some((root) => insideRoot(absolute, root))) {
      throw new SandboxDeniedError({ kind, target: absolute, reason: "the path is outside the policy's roots" });
    }
    return absolute;
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.live();
    const absolute = this.target(path, "filesystem_read");
    try {
      return await this.instance.files.read(absolute, { format: "bytes" });
    } catch (error) {
      if (isNotFound(error)) throw new HarnessError("sandbox_not_found", `no such file: ${absolute}`, { cause: error });
      throw new HarnessError("sandbox_io_failed", `the E2B sandbox could not read ${absolute}`, { cause: error });
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.live();
    const absolute = this.target(path, "filesystem_write");
    if (!(data instanceof Uint8Array)) throw invalid("a file's data is a Uint8Array");
    this.guardBytes(data, "file");
    try {
      await this.instance.files.write(absolute, data);
    } catch (error) {
      throw new HarnessError("sandbox_io_failed", `the E2B sandbox could not write ${absolute}`, { cause: error });
    }
  }

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    this.live();
    checkCommand(command);
    checkOptions(options);
    options.signal.throwIfAborted();
    const env = options.env ?? {};
    for (const [name, value] of Object.entries(env)) {
      if (typeof value !== "string") throw invalid(`the value of ${name} must be a string`);
      this.guard(value, `environment variable ${name}`);
    }
    for (const word of command) this.guard(word, "command");
    const cwd = resolvePath(this.root, options.cwd ?? ".");
    if (![...this.policy.readRoots, ...this.policy.writeRoots].some((root) => insideRoot(cwd, root))) {
      return {
        denied: { kind: "filesystem_read", target: cwd, reason: "the working directory is outside the policy's roots" },
      };
    }
    if (command[0]?.includes("=")) {
      return { exitCode: NOT_FOUND_EXIT_CODE, stdout: "", stderr: `command not found: ${command[0]}\n` };
    }
    const script = commandString(command, Object.keys(env));
    return this.run(script, { ...env }, cwd, options);
  }

  private async run(
    script: string,
    envs: Record<string, string>,
    cwd: string,
    options: ExecOptions,
  ): Promise<ExecResult> {
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const output = { stdout: new Capped(limit), stderr: new Capped(limit) };
    let handle: E2BCommandHandle;
    try {
      handle = await this.instance.commands.run(script, {
        background: true,
        retainOutput: false,
        cwd,
        envs,
        // The backend times the command itself, so E2B's own command timeout is off.
        timeoutMs: 0,
        onStdout: (data) => output.stdout.add(data),
        onStderr: (data) => output.stderr.add(data),
      });
    } catch (error) {
      if (this.state === "disposed") throw disposedError();
      throw new HarnessError("sandbox_io_failed", "the E2B sandbox could not start the command", { cause: error });
    }
    const outcome = await settle(handle, options, this.stopped.signal);
    if (outcome.kind !== "done" && outcome.kind !== "failed") await this.kill(handle);
    return this.result(outcome, output, options);
  }

  /** The result a command's outcome resolves with, or the error it rejects with. */
  private result(outcome: Outcome, output: { stdout: Capped; stderr: Capped }, options: ExecOptions): ExecResult {
    const truncated = output.stdout.truncated || output.stderr.truncated ? { truncated: true } : {};
    const text = { stdout: output.stdout.text(), stderr: output.stderr.text() };
    switch (outcome.kind) {
      case "done":
        return { exitCode: outcome.exitCode, ...text, ...truncated };
      case "timeout":
        return { exitCode: TIMEOUT_EXIT_CODE, ...text, timedOut: true, ...truncated };
      case "abort":
        throw options.signal.reason ?? new Error("the command was aborted");
      case "stopped":
        if (this.state === "paused") throw invalid("the sandbox was paused while the command ran");
        throw disposedError();
      default:
        if (this.state === "disposed") throw disposedError();
        throw new HarnessError("sandbox_io_failed", "the E2B sandbox lost the command", { cause: outcome.error });
    }
  }

  /** Kills a command and, when E2B made it a process group's leader, the processes it started. */
  private async kill(handle: { readonly pid: number; kill(): Promise<boolean> }): Promise<void> {
    await handle.kill().catch(() => false);
    if (this.state !== "running") return;
    await this.instance.commands
      .run(killGroupString(handle.pid), { background: true, retainOutput: false, timeoutMs: 0 })
      .then((group) => group.wait())
      .catch(() => undefined);
  }

  async readBack(): Promise<SandboxPolicy> {
    if (this.state === "disposed") throw disposedError();
    const info = await this.instance.getInfo();
    if (info.sandboxId !== this.id) throw new SandboxPolicyMismatchError("readBack");
    return {
      readRoots: [...this.policy.readRoots],
      writeRoots: [...this.policy.writeRoots],
      network: networkFromInfo(info, this.network.network),
    };
  }

  async pause(): Promise<void> {
    this.live();
    try {
      await this.instance.pause();
    } catch (error) {
      throw new HarnessError("sandbox_io_failed", "the E2B sandbox could not be paused", { cause: error });
    }
    this.state = "paused";
    this.stopped.abort();
  }

  /** Kills the sandbox, trying again when a kill fails. Every call gets the first call's promise. */
  dispose(): Promise<void> {
    if (this.disposing === undefined) {
      this.state = "disposed";
      this.stopped.abort();
      this.disposing = killSandbox(this.context, this.id);
    }
    return this.disposing;
  }
}

/** Kills a sandbox by its id, paused or running, trying again when a kill fails, and rejects if it never succeeds. */
async function killSandbox(context: Context, id: string): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < KILL_ATTEMPTS; attempt++) {
    try {
      // `false` means E2B no longer has the sandbox, which is what a kill wants.
      await context.sdk.Sandbox.kill(id, context.connection);
      return;
    } catch (error) {
      last = error;
    }
  }
  throw new HarnessError("sandbox_io_failed", "the E2B sandbox could not be killed; E2B ends it at its timeout", {
    cause: last,
  });
}

/** Kills every sandbox E2B lists with this attempt's label, after a create that failed may have left one behind. */
async function sweep(context: Context, label: string): Promise<void> {
  const found: string[] = [];
  try {
    const pages = context.sdk.Sandbox.list({
      ...context.connection,
      query: { metadata: { [E2B_PROVISION_LABEL]: label } },
    });
    while (pages.hasNext) for (const item of await pages.nextItems()) found.push(item.sandboxId);
  } catch {
    // The list failed, so nothing more can be found; the sandbox's timeout is the backstop.
  }
  await Promise.all(found.map((id) => killSandbox(context, id).catch(() => undefined)));
}

/** A random label for one provisioning attempt, in the lower-case letters and digits E2B accepts in metadata. */
function provisionLabel(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Loads the SDK from the option, or imports `e2b`, or throws `SandboxUnavailableError`. */
async function loadSdk(option: E2BSandboxOptions["sdk"]): Promise<E2BSdk> {
  let sdk: unknown;
  try {
    if (typeof option === "function") sdk = await option();
    else if (option !== undefined) sdk = option;
    else {
      const specifier = "e2b";
      sdk = await import(specifier);
    }
  } catch (error) {
    throw unavailable("the e2b package could not be loaded; install e2b or pass sdk", error);
  }
  const { Sandbox: api, Secret: secrets } = (sdk ?? {}) as Partial<E2BSdk>;
  if (
    typeof api?.create !== "function" ||
    typeof secrets?.exists !== "function" ||
    typeof secrets.fill !== "function"
  ) {
    throw unavailable("the sdk option has no Sandbox.create, Secret.exists or Secret.fill");
  }
  return { Sandbox: api, Secret: secrets };
}

/** The backend's client, which holds the options and the SDK once it has loaded. */
class E2BClient implements E2BSandboxClient {
  readonly tier = "microvm" as const;
  readonly stops = STOPS;
  readonly capabilities = CAPABILITIES;
  private readonly options: E2BSandboxOptions;
  private readonly template: string;
  private readonly lifetime: number;
  private readonly connection: E2BConnectionOptions;
  private loading: Promise<E2BSdk> | undefined;

  constructor(options: E2BSandboxOptions) {
    this.options = options;
    this.template = options.template ?? DEFAULT_TEMPLATE;
    if (typeof this.template !== "string" || this.template === "") {
      throw invalid("template must be a non-empty string");
    }
    this.lifetime = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.lifetime) || this.lifetime < 1000 || this.lifetime > MAX_TIMEOUT_MS) {
      throw invalid(`timeoutMs must be a whole number of milliseconds from 1000 to ${MAX_TIMEOUT_MS}`);
    }
    this.connection = {
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.domain === undefined ? {} : { domain: options.domain }),
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    };
  }

  /** The SDK and the connection, loading the SDK on first use. A failed load is tried again on the next call. */
  private async context(): Promise<Context> {
    this.loading ??= loadSdk(this.options.sdk);
    const sdk = await this.loading.catch((error: unknown) => {
      this.loading = undefined;
      throw error;
    });
    return { sdk, connection: this.connection, apiKey: this.options.apiKey };
  }

  /** The network a policy compiles to, and the secrets its rules name. */
  private compile(sdk: E2BSdk, policy: SandboxPolicy): E2BCompiledEgress {
    const { egress, secretName, schemes, unscopedInjection } = this.options;
    if (egress === undefined) return plainNetwork(policy.network.allow);
    const compiled = compileE2BEgress(egress, {
      fill: (name) => sdk.Secret.fill(name),
      ...(secretName === undefined ? {} : { secretName }),
      ...(schemes === undefined ? {} : { schemes }),
      ...(unscopedInjection === undefined ? {} : { unscopedInjection }),
    });
    if (!sameSet(compiled.network.allowOut, policy.network.allow)) {
      throw invalid("the egress policy's allow and route hosts must be exactly the policy's network.allow");
    }
    return compiled;
  }

  /** Throws `SandboxSecretUnresolvedError` for the first secret that doesn't exist. Nothing reads a value. */
  private async checkSecrets({ sdk }: Context, compiled: E2BCompiledEgress): Promise<void> {
    for (const { secret, credential } of compiled.secrets) {
      let exists: boolean;
      try {
        exists = await sdk.Secret.exists(secret, this.connection);
      } catch (error) {
        throw unavailable("E2B could not say whether a secret the egress rules name exists", error);
      }
      if (exists !== true) throw new SandboxSecretUnresolvedError(BACKEND, secret, credential);
    }
  }

  async provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox> {
    checkPolicy(policy);
    checkRoot(manifest?.root, policy);
    const context = await this.context();
    const compiled = this.compile(context.sdk, policy);
    await this.checkSecrets(context, compiled);
    const instance = await this.create(context, manifest.root, compiled);
    const sandbox = new E2BSandbox(instance, context, policy, manifest.root, compiled);
    try {
      await instance.files.makeDir(manifest.root);
      for (const [path, data] of Object.entries(manifest.files ?? {})) {
        await sandbox.writeFile(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
      }
      await sandbox.confirm(this, policy);
    } catch (error) {
      await sandbox.dispose().catch(() => undefined);
      if (error instanceof HarnessError) throw error;
      throw unavailable("the E2B sandbox could not be prepared", error);
    }
    return sandbox;
  }

  /** Creates the sandbox, or sweeps away any that a failed create left and throws `SandboxUnavailableError`. */
  private async create(context: Context, root: string, compiled: E2BCompiledEgress): Promise<E2BSandboxInstance> {
    const label = provisionLabel();
    try {
      return await context.sdk.Sandbox.create(this.template, {
        ...this.connection,
        timeoutMs: this.lifetime,
        metadata: { [E2B_PROVISION_LABEL]: label, [E2B_ROOT_LABEL]: root },
        network: structuredClone(compiled.network),
        lifecycle: { onTimeout: "kill" },
      });
    } catch (error) {
      await sweep(context, label);
      throw unavailable("E2B could not create the sandbox", error);
    }
  }

  async resume(id: string, policy: SandboxPolicy): Promise<Sandbox> {
    if (typeof id !== "string" || id === "") throw invalid("a sandbox id is a non-empty string");
    checkPolicy(policy);
    const context = await this.context();
    const compiled = this.compile(context.sdk, policy);
    // Before connect, which wakes a paused sandbox: one whose secret is gone stays paused.
    await this.checkSecrets(context, compiled);
    let instance: E2BSandboxInstance;
    try {
      instance = await context.sdk.Sandbox.connect(id, { ...this.connection, timeoutMs: this.lifetime });
    } catch (error) {
      throw unavailable("E2B could not reattach to the sandbox", error);
    }
    try {
      const info = await instance.getInfo();
      const root = info.metadata?.[E2B_ROOT_LABEL];
      // A sandbox this backend didn't create has no recorded root.
      checkRoot(root, policy);
      return new E2BSandbox(instance, context, policy, root, compiled);
    } catch (error) {
      // Connecting woke the sandbox, so it goes back to sleep rather than run unattended; its work is kept.
      await instance.pause().catch(() => undefined);
      if (error instanceof HarnessError) throw error;
      throw unavailable("E2B could not report the resumed sandbox", error);
    }
  }
}

/**
 * The E2B backend. Each `provision()` checks the policy, compiles the network, checks that every secret the rules name
 * exists, creates a sandbox with exactly that network, writes the manifest's files and reads the network back from
 * E2B. A sandbox is killed on every path that doesn't return it, and E2B kills any sandbox at `timeoutMs` regardless.
 */
export function e2bSandbox(options: E2BSandboxOptions = {}): E2BSandboxClient {
  return new E2BClient(options);
}
