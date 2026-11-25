// An in-process fake of the part of `@vercel/sandbox` the Vercel backend uses. Each VM has a file system in memory, with
// folders and symlinks, and understands the few programs the backend and the conformance suite run: `env -i`, `echo`,
// `env`, `true`, `false`, `sleep`, `flood`, `mkdir -p`, `realpath -m` and `net-probe`. `net-probe <url> [method]` plays the
// firewall: it reaches a host only as the network policy it was given allows, applies the policy's rules in order, and
// prints the headers a `transform` rule set. The VM reports its policy as `@vercel/sandbox` 3.9.1's
// `fromAPINetworkPolicy()` does, with every injected header's value replaced and `response` rules left out.
//
// Every call is recorded, so a test can scan everything that would have crossed into the VM for a credential value.

import type {
  VercelCommand,
  VercelCreateParams,
  VercelFinishedCommand,
  VercelRunParams,
  VercelSandboxInstance,
  VercelSandboxSdk,
} from "@buildanagent/harness/sandbox/vercel";
import type { NetworkPolicy, NetworkPolicyRule } from "@vercel/sandbox";

type Node = { kind: "dir" } | { kind: "file"; data: Uint8Array } | { kind: "link"; target: string };

/** One VM the fake holds. */
export interface FakeVm {
  readonly name: string;
  policy: NetworkPolicy;
  readonly files: Map<string, Node>;
  running: boolean;
  deleted: boolean;
  readonly params: VercelCreateParams;
}

/** Everything the backend sent the fake, in order. */
export type FakeCall =
  | { readonly kind: "create"; readonly params: VercelCreateParams }
  | { readonly kind: "get"; readonly name: string; readonly resume: boolean }
  | { readonly kind: "run"; readonly vm: string; readonly params: Omit<VercelRunParams, "signal"> }
  | { readonly kind: "write"; readonly vm: string; readonly path: string; readonly content: Uint8Array }
  | { readonly kind: "read"; readonly vm: string; readonly path: string }
  | { readonly kind: "update"; readonly vm: string; readonly policy: NetworkPolicy }
  | { readonly kind: "kill"; readonly vm: string }
  | { readonly kind: "stop" | "delete" | "snapshot"; readonly vm: string };

/** The ways a test can make the fake misbehave. */
export interface FakeVercelOptions {
  /** Changes the policy the VM reports, the way an account-wide setting or a provider bug would. */
  readonly report?: (reported: NetworkPolicy) => NetworkPolicy | undefined;
  /** Makes `create` throw after it has made the VM, as a timeout on the response would. */
  readonly failCreateAfterMaking?: boolean;
  /** Makes the named step throw. */
  readonly fail?: ReadonlySet<"create" | "stop" | "delete" | "mkdir" | "write" | "update" | "get">;
  /** What the VM prints for `realpath`, after its own resolution, so a test can play a VM that lies. */
  readonly realpath?: (resolved: string) => string;
  /**
   * Milliseconds a command started through `env` takes to start. An abort of the start's signal in that time rejects
   * `runCommand()` while the command keeps running, as a cancelled request to Vercel's API can.
   */
  readonly startDelayMs?: number;
}

/** The fake, and what it holds. */
export interface FakeVercel {
  readonly sdk: VercelSandboxSdk;
  readonly calls: FakeCall[];
  readonly vms: Map<string, FakeVm>;
  /** Makes `link` a symlink to `target` in every VM that is not deleted. */
  symlink(link: string, target: string): void;
  /** The VMs that are not deleted. */
  live(): FakeVm[];
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Resolves every link in `path`, as `realpath -m` does, keeping a missing tail as written. */
function resolveLinks(files: Map<string, Node>, path: string, depth = 0): string {
  if (depth > 40) throw new Error("too many links");
  const parts = normalize(path).split("/").filter(Boolean);
  let current = "";
  for (const [index, part] of parts.entries()) {
    const next = `${current}/${part}`;
    const node = files.get(next);
    if (node?.kind === "link") {
      const target = node.target.startsWith("/") ? node.target : `${current}/${node.target}`;
      return resolveLinks(files, [target, ...parts.slice(index + 1)].join("/"), depth + 1);
    }
    current = next;
  }
  return current === "" ? "/" : current;
}

function mkdirs(files: Map<string, Node>, path: string): void {
  let current = "";
  for (const part of normalize(path).split("/").filter(Boolean)) {
    current += `/${part}`;
    if (!files.has(current)) files.set(current, { kind: "dir" });
  }
}

/** What the VM reports for the policy it was given, as `fromAPINetworkPolicy()` would rebuild it. */
export function reportedPolicy(policy: NetworkPolicy): NetworkPolicy {
  if (typeof policy === "string") return policy;
  const allow = policy.allow;
  if (allow === undefined || Array.isArray(allow)) return structuredClone(policy);
  const rules: Record<string, NetworkPolicyRule[]> = {};
  for (const [domain, list] of Object.entries(allow)) {
    rules[domain] = list.flatMap((rule): NetworkPolicyRule[] => {
      if (rule.transform === undefined) return [];
      const headers = Object.fromEntries(
        rule.transform.flatMap((transform) => Object.keys(transform.headers ?? {})).map((name) => [name, "<redacted>"]),
      );
      return [
        { ...(rule.match === undefined ? {} : { match: structuredClone(rule.match) }), transform: [{ headers }] },
      ];
    });
  }
  return { allow: rules, ...(policy.subnets === undefined ? {} : { subnets: structuredClone(policy.subnets) }) };
}

/** Whether `host` is an address literal, which the SNI-matched firewall never allows by name. */
const isLiteral = (host: string) => host.startsWith("[") || /^[0-9.]+$/.test(host) || host.includes(":");

type Verdict = { allowed: false; reason: string } | { allowed: true; headers: Record<string, string> };

/** What the first rule a request matches does, in declaration order. A request no rule claims passes as it is. */
function applyRules(rules: readonly NetworkPolicyRule[], method: string): Verdict {
  for (const rule of rules) {
    if (rule.match?.method !== undefined && !rule.match.method.includes(method)) continue;
    if (rule.response !== undefined) return { allowed: false, reason: `response ${rule.response.statusCode}` };
    if (rule.transform !== undefined) {
      return {
        allowed: true,
        headers: Object.assign({}, ...rule.transform.map((transform) => transform.headers ?? {})),
      };
    }
  }
  return { allowed: true, headers: {} };
}

/** What the firewall does with one request: refuse it, or let it through with the headers its rules set. */
export function firewall(policy: NetworkPolicy, url: string, method: string): Verdict {
  const host = new URL(url).hostname;
  if (policy === "allow-all") return { allowed: true, headers: {} };
  if (policy === "deny-all") return { allowed: false, reason: "deny-all" };
  if (isLiteral(host)) return { allowed: false, reason: "address literal" };
  const allow = policy.allow ?? [];
  if (Array.isArray(allow)) {
    return allow.includes(host) ? { allowed: true, headers: {} } : { allowed: false, reason: "not allowed" };
  }
  const rules = allow[host];
  return rules === undefined ? { allowed: false, reason: "not allowed" } : applyRules(rules, method);
}

class FakeCommand implements VercelCommand {
  private killed = false;
  private readonly waiters = new Set<() => void>();
  private readonly finished: Promise<Ran>;
  private readonly vm: FakeVm;
  private readonly calls: FakeCall[];

  constructor(vm: FakeVm, calls: FakeCall[], body: (killed: () => Promise<void>) => Promise<Ran>) {
    this.vm = vm;
    this.calls = calls;
    this.finished = body(() => new Promise<void>((resolve) => this.waiters.add(resolve)));
  }

  wait(params?: { signal?: AbortSignal }): Promise<VercelFinishedCommand> {
    const signal = params?.signal;
    signal?.throwIfAborted();
    if (signal === undefined) return this.finished;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      this.finished.then(resolve, reject);
    });
  }

  async *logs(params?: { signal?: AbortSignal }): AsyncIterable<{ stream: "stdout" | "stderr"; data: string }> {
    const finished = await this.finished;
    for (const chunk of finished.chunks) {
      params?.signal?.throwIfAborted();
      yield chunk;
    }
  }

  async kill(): Promise<void> {
    this.calls.push({ kind: "kill", vm: this.vm.name });
    this.killed = true;
    for (const wake of this.waiters) wake();
  }

  get wasKilled(): boolean {
    return this.killed;
  }
}

/** A finished command, and the chunks its logs stream, in order. */
type Ran = VercelFinishedCommand & { readonly chunks: readonly { stream: "stdout" | "stderr"; data: string }[] };

const done = (exitCode: number, stdout = "", stderr = ""): Ran => ({
  exitCode,
  stdout: async () => stdout,
  stderr: async () => stderr,
  chunks: [
    ...(stdout === "" ? [] : [{ stream: "stdout" as const, data: stdout }]),
    ...(stderr === "" ? [] : [{ stream: "stderr" as const, data: stderr }]),
  ],
});

// How many 64 KiB chunks `flood` writes: 32 MiB, more than the default output cap holds.
const FLOOD_CHUNKS = 512;

/** A command that writes more than the host should ever hold, which `stdout()` refuses to fetch whole. */
const flood = (): Ran => {
  const chunk = "y\n".repeat(32 * 1024);
  const tooBig = async (): Promise<string> => {
    throw new Error("the output is too large to fetch whole");
  };
  return {
    exitCode: 0,
    stdout: tooBig,
    stderr: tooBig,
    chunks: Array.from({ length: FLOOD_CHUNKS }, () => ({ stream: "stdout" as const, data: chunk })),
  };
};

/** Runs one program in `vm`, with `env` as its whole environment. */
async function program(
  vm: FakeVm,
  argv: readonly string[],
  env: Record<string, string>,
  options: FakeVercelOptions,
  killed: () => Promise<void>,
): Promise<Ran> {
  const [name = "", ...args] = argv;
  switch (name) {
    case "echo":
      return done(0, `${args.join(" ")}\n`);
    case "true":
      return done(0);
    case "flood":
      return flood();
    case "false":
      return done(1);
    case "env":
      return done(
        0,
        Object.entries(env)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(""),
      );
    case "sleep": {
      const ms = Number(args[0]) * 1000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const slept = new Promise<"slept">((resolve) => {
        timer = setTimeout(() => resolve("slept"), ms);
      });
      const outcome = await Promise.race([slept, killed().then(() => "killed" as const)]);
      clearTimeout(timer);
      return outcome === "killed" ? done(137) : done(0);
    }
    case "mkdir": {
      if (options.fail?.has("mkdir")) return done(1, "", "mkdir: failed\n");
      for (const path of args.filter((arg) => !arg.startsWith("-"))) mkdirs(vm.files, resolveLinks(vm.files, path));
      return done(0);
    }
    case "realpath": {
      const path = args[args.length - 1] ?? "/";
      const resolved = resolveLinks(vm.files, path);
      return done(0, `${options.realpath?.(resolved) ?? resolved}\n`);
    }
    case "net-probe": {
      const verdict = firewall(vm.policy, args[0] ?? "", args[1] ?? "GET");
      if (!verdict.allowed) return done(7, "", `blocked: ${verdict.reason}\n`);
      return done(0, JSON.stringify(verdict.headers));
    }
    default:
      return done(127, "", `${name}: command not found\n`);
  }
}

/** Splits `env -i -- NAME=value… program args…` into its environment and its command. */
function unwrap(cmd: string, args: readonly string[]): { env: Record<string, string>; argv: string[] } {
  if (cmd !== "env" || args[0] !== "-i" || args[1] !== "--") return { env: {}, argv: [cmd, ...args] };
  const env: Record<string, string> = {};
  let at = 2;
  for (; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    const cut = arg.indexOf("=");
    if (cut <= 0) break;
    env[arg.slice(0, cut)] = arg.slice(cut + 1);
  }
  return { env, argv: args.slice(at) };
}

class FakeInstance implements VercelSandboxInstance {
  private readonly vm: FakeVm;
  private readonly fake: FakeState;

  constructor(vm: FakeVm, fake: FakeState) {
    this.vm = vm;
    this.fake = fake;
  }

  get name(): string {
    return this.vm.name;
  }

  get networkPolicy(): NetworkPolicy | undefined {
    const reported = reportedPolicy(this.vm.policy);
    return this.fake.options.report === undefined ? reported : this.fake.options.report(reported);
  }

  private alive(): void {
    if (this.vm.deleted) throw new Error(`sandbox ${this.vm.name} was deleted`);
    // A stopped session starts again on the next call, as `@vercel/sandbox`'s own resume does.
    this.vm.running = true;
  }

  async runCommand(params: VercelRunParams): Promise<VercelCommand> {
    this.alive();
    const { signal: _signal, ...recorded } = params;
    this.fake.calls.push({ kind: "run", vm: this.vm.name, params: structuredClone(recorded) });
    const { env, argv } = unwrap(params.cmd, params.args);
    const command = new FakeCommand(this.vm, this.fake.calls, (killed) =>
      program(this.vm, argv, env, this.fake.options, killed),
    );
    const delay = this.fake.options.startDelayMs;
    if (delay !== undefined && params.cmd === "env") {
      // The command runs from here on, whatever happens to the request that started it.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        params.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("the request was aborted"));
          },
          { once: true },
        );
      });
    }
    return command;
  }

  async readFileToBuffer(file: { path: string }): Promise<Uint8Array | null> {
    this.alive();
    this.fake.calls.push({ kind: "read", vm: this.vm.name, path: file.path });
    const node = this.vm.files.get(resolveLinks(this.vm.files, file.path));
    return node?.kind === "file" ? new Uint8Array(node.data) : null;
  }

  async writeFiles(files: { path: string; content: Uint8Array }[]): Promise<void> {
    this.alive();
    if (this.fake.options.fail?.has("write")) throw new Error("write failed");
    for (const file of files) {
      this.fake.calls.push({ kind: "write", vm: this.vm.name, path: file.path, content: new Uint8Array(file.content) });
      const real = resolveLinks(this.vm.files, file.path);
      this.vm.files.set(real, { kind: "file", data: new Uint8Array(file.content) });
    }
  }

  async update(params: { networkPolicy: NetworkPolicy }): Promise<void> {
    this.alive();
    this.fake.calls.push({ kind: "update", vm: this.vm.name, policy: structuredClone(params.networkPolicy) });
    if (this.fake.options.fail?.has("update"))
      throw new Error(`update failed: ${JSON.stringify(params.networkPolicy)}`);
    this.vm.policy = structuredClone(params.networkPolicy);
  }

  async snapshot(): Promise<{ readonly snapshotId: string }> {
    this.alive();
    this.fake.calls.push({ kind: "snapshot", vm: this.vm.name });
    const snapshotId = `snap_${this.fake.snapshots.size + 1}`;
    this.fake.snapshots.set(snapshotId, structuredClone(this.vm.files));
    this.vm.running = false;
    return { snapshotId };
  }

  async stop(): Promise<unknown> {
    this.fake.calls.push({ kind: "stop", vm: this.vm.name });
    if (this.fake.options.fail?.has("stop")) throw new Error("stop failed");
    if (this.vm.deleted || !this.vm.running) throw new Error("No active session to stop.");
    this.vm.running = false;
    return {};
  }

  async delete(): Promise<void> {
    this.fake.calls.push({ kind: "delete", vm: this.vm.name });
    if (this.fake.options.fail?.has("delete")) throw new Error("delete failed");
    this.vm.deleted = true;
    this.vm.running = false;
  }
}

interface FakeState {
  readonly options: FakeVercelOptions;
  readonly calls: FakeCall[];
  readonly vms: Map<string, FakeVm>;
  readonly snapshots: Map<string, Map<string, Node>>;
}

/** A fake `@vercel/sandbox` client that holds its VMs in memory. */
export function fakeVercel(options: FakeVercelOptions = {}): FakeVercel {
  const state: FakeState = { options, calls: [], vms: new Map(), snapshots: new Map() };
  const sdk: VercelSandboxSdk = {
    async create(params) {
      const { signal: _signal, ...recorded } = params;
      state.calls.push({ kind: "create", params: structuredClone(recorded) });
      if (options.fail?.has("create")) throw new Error(`create failed for ${JSON.stringify(params.networkPolicy)}`);
      if (state.vms.has(params.name)) {
        // Vercel answers with an API error that carries the HTTP response, as `@vercel/sandbox`'s `APIError` does.
        throw Object.assign(new Error("a sandbox with this name exists"), { response: { status: 409 } });
      }
      const source = params.source === undefined ? undefined : state.snapshots.get(params.source.snapshotId);
      if (params.source !== undefined && source === undefined) throw new Error("snapshot_not_found");
      const files = source === undefined ? new Map<string, Node>([["/", { kind: "dir" }]]) : structuredClone(source);
      const vm: FakeVm = {
        name: params.name,
        policy: structuredClone(params.networkPolicy),
        files,
        running: true,
        deleted: false,
        params: recorded,
      };
      state.vms.set(params.name, vm);
      if (options.failCreateAfterMaking) {
        throw new Error(`timed out waiting for the response to ${JSON.stringify(params.networkPolicy)}`);
      }
      return new FakeInstance(vm, state);
    },
    async get(params) {
      state.calls.push({ kind: "get", name: params.name, resume: params.resume === true });
      if (options.fail?.has("get")) throw new Error("get failed");
      const vm = state.vms.get(params.name);
      if (vm === undefined || vm.deleted) throw new Error("not_found");
      if (params.resume === true) vm.running = true;
      return new FakeInstance(vm, state);
    },
  };
  return {
    sdk,
    calls: state.calls,
    vms: state.vms,
    symlink(link, target) {
      for (const vm of state.vms.values()) {
        if (vm.deleted) continue;
        mkdirs(vm.files, link.slice(0, link.lastIndexOf("/")) || "/");
        vm.files.set(normalize(link), { kind: "link", target });
      }
    },
    live: () => [...state.vms.values()].filter((vm) => !vm.deleted),
  };
}

/** Every string and byte the backend sent into a VM: command lines, variables, working directories and file contents. */
export function sentIntoVms(calls: readonly FakeCall[]): string[] {
  return calls.flatMap((call) => {
    if (call.kind === "run") return [call.params.cmd, ...call.params.args, call.params.cwd];
    if (call.kind === "write") return [call.path, DECODER.decode(call.content)];
    if (call.kind === "read") return [call.path];
    if (call.kind === "create") {
      const { networkPolicy: _policy, ...rest } = call.params;
      return [JSON.stringify(rest)];
    }
    return [];
  });
}

export { ENCODER };
