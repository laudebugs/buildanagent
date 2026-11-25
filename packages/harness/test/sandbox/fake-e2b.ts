import type {
  E2BCommandHandle,
  E2BCreateOptions,
  E2BNetworkOptions,
  E2BNetworkRule,
  E2BRunOptions,
  E2BSandboxInfo,
  E2BSandboxInstance,
  E2BSdk,
} from "@buildanagent/harness/sandbox/e2b";
import { inAddressRange, isAddressLiteral } from "../../src/credentials/addresses.js";

// An in-process stand-in for the part of the `e2b` SDK the backend calls, written from the pinned 2.63.0 declarations
// and E2B's network and secrets pages (docs/plans/reviews/fact-check-e2b-backend.md). It keeps sandboxes by id, runs a
// handful of programs on an in-memory file system, and plays E2B's firewall and egress proxy as documented:
//
// - egress is open unless `denyOut` holds `0.0.0.0/0` or internet access is off, and an `allowOut` entry beats a deny;
// - an `allowOut` domain matches by Host or SNI on ports 80 and 443 only, exactly or by a `*.` wildcard, and `*` matches
//   every name; other traffic is filtered by address;
// - a domain in `allowOut` opens every port of the DNS servers, `8.8.8.8` unless `dnsServers` says otherwise;
// - a rule's headers are added only to HTTPS requests to its host, each `${e2b.secrets.<name>}` is replaced with the
//   stored value outside the sandbox, and a header whose secret is missing is dropped while the request still goes out.
//
// Loopback reaches the VM itself, where nothing listens, and the fake gives the VM no IPv6 route.

/** One request a host outside the sandbox received, with the headers it saw. */
export interface ReceivedRequest {
  readonly host: string;
  readonly scheme: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What the fake recorded, for the tests that check what crossed into the sandbox. */
export interface FakeE2BLog {
  readonly creates: { template: string; opts: E2BCreateOptions }[];
  readonly runs: { sandboxId: string; cmd: string; envs: Record<string, string> }[];
  readonly writes: { sandboxId: string; path: string; data: Uint8Array }[];
  readonly kills: string[];
  readonly exists: string[];
  readonly connects: string[];
  readonly lists: number;
  readonly received: ReceivedRequest[];
}

/** The faults and provider behaviour a test can ask for. */
export interface FakeE2BOptions {
  /** The project's secrets, by name. Names are matched in lower case, as E2B stores them. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** The template's environment, which every command starts with. */
  readonly templateEnv?: Readonly<Record<string, string>>;
  /** What the provider applies, enforces and reports instead of the network it was sent. */
  readonly applied?: (sent: E2BNetworkOptions) => unknown;
  /** What `getInfo()` reports instead of the applied network, while the applied one is still enforced. */
  readonly reported?: (applied: unknown) => unknown;
  /** `before`: `create()` rejects and makes nothing. `after`: it makes the sandbox, then rejects, as a lost reply would. */
  readonly createFails?: "before" | "after";
  /** `Secret.exists()` rejects, as when the API is down. */
  readonly existsFails?: boolean;
  /** How many `Sandbox.kill()` calls reject before one succeeds. */
  readonly killFailures?: number;
  /** `files.write()` rejects. */
  readonly writeFails?: boolean;
  /** `getInfo()` rejects. */
  readonly infoFails?: boolean;
  /** `Sandbox.list()` rejects. */
  readonly listFails?: boolean;
}

const DEFAULT_TEMPLATE_ENV = {
  HOME: "/home/user",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  USER: "user",
  E2B_SANDBOX: "true",
};
const FAKE_PUBLIC_ADDRESS = "203.0.113.10";
const ALL_TRAFFIC = "0.0.0.0/0";
const PLACEHOLDER = /\$\{e2b\.secrets\.([^}]+)\}/g;

interface Process {
  readonly pid: number;
  kill(): void;
}

interface Vm {
  readonly id: string;
  state: "running" | "paused" | "killed";
  readonly metadata: Record<string, string>;
  readonly network: unknown;
  readonly files: Map<string, Uint8Array>;
  readonly processes: Map<number, Process>;
}

const encoder = new TextEncoder();
const later = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** An error shaped like the SDK's, matched by name as the backend matches it. */
function sdkError(name: string, message: string, more: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name }, more);
}

/** The words of a string of single-quoted words, as the backend writes them. */
function unquote(text: string): string[] | undefined {
  const words: string[] = [];
  let rest = text.trim();
  while (rest !== "") {
    const match = /^'((?:[^']|'\\'')*)'(?:\s+|$)/.exec(rest);
    if (match === null) return undefined;
    words.push((match[1] ?? "").replaceAll(`'\\''`, "'"));
    rest = rest.slice(match[0].length);
  }
  return words;
}

/** The variables the backend's prelude keeps, and the program it runs, or `undefined` for any other string. */
function parseScript(cmd: string): { keep: readonly string[] | undefined; argv: string[] } | undefined {
  const exec = cmd.lastIndexOf("; exec ");
  if (exec < 0) {
    const argv = unquote(cmd);
    return argv === undefined ? undefined : { keep: undefined, argv };
  }
  // The prelude keeps only the listed variables when it also unsets the rest; without the unset it keeps them all.
  const prelude = cmd.slice(0, exec);
  const pattern = /case "\$__harness_name" in ([A-Za-z0-9_|]+)\) ;; \*\) unset "\$__harness_name"/.exec(prelude)?.[1];
  if (pattern === undefined && /^for __harness_name in/.test(prelude)) {
    const argv = unquote(cmd.slice(exec + "; exec ".length));
    return argv === undefined ? undefined : { keep: undefined, argv };
  }
  const argv = unquote(cmd.slice(exec + "; exec ".length));
  if (pattern === undefined || argv === undefined) return undefined;
  return { keep: pattern === "_" ? [] : pattern.split("|"), argv };
}

interface Network {
  readonly allowOut?: readonly string[];
  readonly denyOut?: readonly string[];
  readonly dnsServers?: readonly string[];
  readonly rules?: Readonly<Record<string, readonly E2BNetworkRule[]>>;
}

const isLoopback = (host: string) =>
  host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host) || host.endsWith(".localhost");
const isIpv6 = (host: string) => host.startsWith("[") || host.includes(":");

/** Whether a name matches an `allowOut` domain entry. */
function domainMatches(entry: string, name: string): boolean {
  if (entry === "*") return true;
  if (entry.startsWith("*.")) return name.endsWith(entry.slice(1));
  return entry === name;
}

/** Whether an address matches an `allowOut` or `denyOut` address entry. */
const addressMatches = (entry: string, address: string): boolean =>
  entry.includes("/") ? inAddressRange(address, entry) : entry === address;

/** Whether E2B's firewall lets the sandbox reach `host` on `port`. */
export function firewallAllows(network: Network | undefined, internet: boolean, host: string, port: number): boolean {
  const allowOut = network?.allowOut ?? [];
  const denyOut = network?.denyOut ?? [];
  const closed = !internet || denyOut.includes(ALL_TRAFFIC);
  const domains = allowOut.filter((entry) => !isAddressLiteral(entry) && !entry.includes("/"));
  const dns = domains.length > 0 ? (network?.dnsServers ?? ["8.8.8.8"]) : [];
  if (isAddressLiteral(host)) {
    if (allowOut.some((entry) => addressMatches(entry, host)) || dns.includes(host)) return true;
    return !(closed || denyOut.some((entry) => addressMatches(entry, host)));
  }
  if ((port === 80 || port === 443) && domains.some((entry) => domainMatches(entry, host))) return true;
  // Any other name is filtered by the address it resolves to, which is a public one here.
  if (allowOut.some((entry) => addressMatches(entry, FAKE_PUBLIC_ADDRESS))) return true;
  return !(closed || denyOut.some((entry) => addressMatches(entry, FAKE_PUBLIC_ADDRESS)));
}

/** The fake SDK, and what it recorded. */
export class FakeE2B {
  readonly log: FakeE2BLog = {
    creates: [],
    runs: [],
    writes: [],
    kills: [],
    exists: [],
    connects: [],
    lists: 0,
    received: [],
  };
  readonly vms = new Map<string, Vm>();
  readonly sdk: E2BSdk;
  private readonly options: FakeE2BOptions;
  private readonly secrets: Map<string, string>;
  private killFailures: number;
  private nextId = 1;
  private nextPid = 100;

  constructor(options: FakeE2BOptions = {}) {
    this.options = options;
    this.secrets = new Map(Object.entries(options.secrets ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    this.killFailures = options.killFailures ?? 0;
    this.sdk = {
      Sandbox: {
        create: (template, opts) => this.create(template, opts),
        connect: (id) => this.connect(id),
        kill: (id) => this.kill(id),
        list: (opts) => this.list(opts.query.metadata),
      },
      Secret: {
        exists: async (name) => {
          (this.log.exists as string[]).push(name);
          if (options.existsFails) throw sdkError("SecretError", "the secrets API is unavailable");
          return this.secrets.has(name.toLowerCase());
        },
        fill: (name) => {
          if (name === "" || /[{}\p{Cc}]/u.test(name)) throw sdkError("InvalidArgumentError", "bad secret name");
          return `\${e2b.secrets.${name}}`;
        },
      },
    };
  }

  /** The ids of sandboxes E2B still holds, running or paused. */
  held(): string[] {
    return [...this.vms.values()].filter((vm) => vm.state !== "killed").map((vm) => vm.id);
  }

  /** Deletes a secret, as the owner might between two provisions. */
  deleteSecret(name: string): void {
    this.secrets.delete(name.toLowerCase());
  }

  private async create(template: string, opts: E2BCreateOptions): Promise<E2BSandboxInstance> {
    await later();
    (this.log.creates as unknown[]).push({ template, opts: structuredClone(opts) });
    if (this.options.createFails === "before") throw sdkError("SandboxError", "the API refused the create");
    const id = `sbx${this.nextId++}`;
    const network = this.options.applied ? this.options.applied(structuredClone(opts.network)) : opts.network;
    const vm: Vm = {
      id,
      state: "running",
      metadata: { ...opts.metadata },
      network: structuredClone(network),
      files: new Map(),
      processes: new Map(),
    };
    this.vms.set(id, vm);
    if (this.options.createFails === "after") throw sdkError("TimeoutError", "the reply to the create was lost");
    return this.instance(vm);
  }

  private async connect(id: string): Promise<E2BSandboxInstance> {
    await later();
    (this.log.connects as string[]).push(id);
    const vm = this.vms.get(id);
    if (vm === undefined || vm.state === "killed") throw sdkError("SandboxNotFoundError", "no such sandbox");
    vm.state = "running";
    return this.instance(vm);
  }

  private async kill(id: string): Promise<boolean> {
    await later();
    (this.log.kills as string[]).push(id);
    if (this.killFailures > 0) {
      this.killFailures--;
      throw sdkError("SandboxError", "the kill failed");
    }
    const vm = this.vms.get(id);
    if (vm === undefined || vm.state === "killed") return false;
    vm.state = "killed";
    for (const process of vm.processes.values()) process.kill();
    return true;
  }

  private list(metadata: Record<string, string>) {
    (this.log as { lists: number }).lists++;
    if (this.options.listFails) {
      return {
        hasNext: true,
        nextItems: () => Promise.reject(sdkError("SandboxError", "the list failed")),
      };
    }
    const found = [...this.vms.values()].filter(
      (vm) => vm.state !== "killed" && Object.entries(metadata).every(([key, value]) => vm.metadata[key] === value),
    );
    let done = false;
    return {
      get hasNext() {
        return !done;
      },
      nextItems: async () => {
        done = true;
        return found.map((vm) => ({ sandboxId: vm.id }));
      },
    };
  }

  private running(vm: Vm): void {
    if (vm.state !== "running") throw sdkError("SandboxNotRunningError", `the sandbox is ${vm.state}`);
  }

  private instance(vm: Vm): E2BSandboxInstance {
    return {
      sandboxId: vm.id,
      commands: {
        run: async (cmd, opts) => {
          await later();
          this.running(vm);
          (this.log.runs as unknown[]).push({ sandboxId: vm.id, cmd, envs: { ...(opts.envs ?? {}) } });
          return this.start(vm, cmd, opts);
        },
      },
      files: {
        read: async (path) => {
          await later();
          this.running(vm);
          const data = vm.files.get(path);
          if (data === undefined) throw sdkError("FileNotFoundError", `no such file: ${path}`);
          return data.slice();
        },
        write: async (path, data) => {
          await later();
          this.running(vm);
          if (this.options.writeFails) throw sdkError("SandboxError", "the write failed");
          (this.log.writes as unknown[]).push({ sandboxId: vm.id, path, data: data.slice() });
          vm.files.set(path, data.slice());
          return { path };
        },
        makeDir: async () => {
          await later();
          this.running(vm);
          return true;
        },
      },
      getInfo: async (): Promise<E2BSandboxInfo> => {
        await later();
        if (this.options.infoFails) throw sdkError("SandboxError", "getInfo failed");
        if (vm.state === "killed") throw sdkError("SandboxNotFoundError", "no such sandbox");
        const network = this.options.reported ? this.options.reported(structuredClone(vm.network)) : vm.network;
        return {
          sandboxId: vm.id,
          state: vm.state,
          metadata: { ...vm.metadata },
          network: structuredClone(network) as E2BSandboxInfo["network"],
        };
      },
      pause: async () => {
        await later();
        this.running(vm);
        vm.state = "paused";
        for (const process of vm.processes.values()) process.kill();
        return true;
      },
    };
  }

  /** Starts a command in the background and returns its handle. */
  private start(vm: Vm, cmd: string, opts: E2BRunOptions): E2BCommandHandle {
    const pid = this.nextPid++;
    let settle: (code: number) => void = () => {};
    const exit = new Promise<number>((resolve) => {
      settle = resolve;
    });
    let killed = false;
    const process: Process = {
      pid,
      kill: () => {
        killed = true;
        settle(-1);
        vm.processes.delete(pid);
      },
    };
    vm.processes.set(pid, process);
    const io: Io = { out: (text) => opts.onStdout?.(text), err: (text) => opts.onStderr?.(text) };
    void (async () => {
      await later();
      const code = await this.program(vm, cmd, opts, io, () => killed, exit);
      settle(code);
      vm.processes.delete(pid);
    })();
    return {
      pid,
      wait: async () => {
        const code = await exit;
        if (code === 0) return { exitCode: 0 };
        throw sdkError("CommandExitError", `exit status ${code}`, {
          exitCode: code,
          error: code === -1 ? "signal: killed" : `exit status ${code}`,
        });
      },
      kill: async () => {
        await later();
        const running = vm.processes.has(pid);
        process.kill();
        return running;
      },
    };
  }

  /** Runs one program and resolves with its exit code. */
  private async program(
    vm: Vm,
    cmd: string,
    opts: E2BRunOptions,
    io: Io,
    killed: () => boolean,
    exit: Promise<number>,
  ): Promise<number> {
    if (/^kill -KILL -- -\d+ 2>\/dev\/null; true$/.test(cmd)) return 0;
    const parsed = parseScript(cmd);
    if (parsed === undefined) {
      io.err("bash: the fake runs only the backend's command strings\n");
      return 2;
    }
    const env = commandEnv(this.options.templateEnv ?? DEFAULT_TEMPLATE_ENV, opts, parsed.keep);
    const [program, ...args] = parsed.argv;
    if (program === "sleep") {
      await Promise.race([new Promise((resolve) => setTimeout(resolve, Number(args[0]) * 1000)), exit]);
      return killed() ? -1 : 0;
    }
    if (program === "curl") return this.curl(vm, args, io);
    if (program === "cat") return cat(vm, opts.cwd ?? "/", args, io);
    const simple = program === undefined ? undefined : SIMPLE_PROGRAMS[program];
    if (simple !== undefined) return simple(args, env, io);
    io.err(`bash: ${program}: command not found\n`);
    return 127;
  }

  /** A small `curl`: one URL, any `-H` headers, and the exit codes real curl gives. */
  private curl(vm: Vm, args: string[], io: Io): number {
    const { headers, target } = curlArgs(args);
    let url: URL;
    try {
      url = new URL(target ?? "");
    } catch {
      io.err("curl: (3) URL rejected\n");
      return 3;
    }
    const host = url.hostname.toLowerCase();
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const network = vm.network as Network | undefined;
    const failure = connectFailure(network, host, port);
    if (failure !== undefined) {
      io.err(failure.message);
      return failure.code;
    }
    const seen = url.protocol === "https:" ? this.inject(network, host, headers) : { ...headers };
    this.log.received.push({ host, scheme: url.protocol.slice(0, -1), headers: seen });
    io.out("200");
    return 0;
  }

  /** The headers the host receives after E2B's proxy applies the host's rules, outside the sandbox. */
  private inject(network: Network | undefined, host: string, headers: Record<string, string>): Record<string, string> {
    const seen = { ...headers };
    for (const rule of network?.rules?.[host] ?? []) {
      for (const [name, value] of Object.entries(rule.transform?.headers ?? {})) {
        let resolved = true;
        const filled = value.replaceAll(PLACEHOLDER, (_whole, secret: string) => {
          const stored = this.secrets.get(secret.toLowerCase());
          if (stored === undefined) resolved = false;
          return stored ?? "";
        });
        // A header whose secret doesn't resolve is dropped in full, the sandbox's own header of that name too.
        if (resolved) seen[name.toLowerCase()] = filled;
        else delete seen[name.toLowerCase()];
      }
    }
    return seen;
  }
}

/** Where a program writes its output. */
interface Io {
  out(text: string): void;
  err(text: string): void;
}

/** The environment a program sees: the template's and the given variables, less what the prelude unset. */
function commandEnv(
  template: Readonly<Record<string, string>>,
  opts: E2BRunOptions,
  keep: readonly string[] | undefined,
): Record<string, string> {
  const base = { ...template, ...(opts.envs ?? {}) };
  const env =
    keep === undefined ? base : Object.fromEntries(Object.entries(base).filter(([name]) => keep.includes(name)));
  // `bash` sets these itself, as the conformance suite allows.
  env.PWD = opts.cwd ?? "/home/user";
  env.SHLVL = "1";
  return env;
}

/** The programs that only print. */
const SIMPLE_PROGRAMS: Record<string, (args: string[], env: Record<string, string>, io: Io) => number> = {
  echo: (args, _env, io) => {
    io.out(`${args.join(" ")}\n`);
    return 0;
  },
  true: () => 0,
  false: () => 1,
  pwd: (_args, env, io) => {
    io.out(`${env.PWD}\n`);
    return 0;
  },
  env: (_args, env, io) => {
    io.out(
      Object.entries(env)
        .map(([name, value]) => `${name}=${value}\n`)
        .join(""),
    );
    return 0;
  },
};

/** `cat` over the VM's files. */
function cat(vm: Vm, cwd: string, paths: string[], io: Io): number {
  let code = 0;
  for (const path of paths) {
    const data = vm.files.get(path.startsWith("/") ? path : `${cwd}/${path}`);
    if (data === undefined) {
      io.err(`cat: ${path}: No such file or directory\n`);
      code = 1;
    } else io.out(new TextDecoder().decode(data));
  }
  return code;
}

/** The URL and the `-H` headers of a `curl` command line. */
function curlArgs(args: string[]): { headers: Record<string, string>; target: string | undefined } {
  const headers: Record<string, string> = {};
  let target: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-H") {
      const [name, ...value] = (args[++index] ?? "").split(":");
      headers[(name ?? "").trim().toLowerCase()] = value.join(":").trim();
    } else if (["-o", "-w", "--max-time"].includes(arg)) index++;
    else if (!arg.startsWith("-")) target = arg;
  }
  return { headers, target };
}

/** Why a connection from the sandbox fails, as curl reports it, or `undefined` when the host is reached. */
function connectFailure(
  network: Network | undefined,
  host: string,
  port: number,
): { code: number; message: string } | undefined {
  if (isLoopback(host)) return { code: 7, message: "curl: (7) Failed to connect: Connection refused\n" };
  if (isIpv6(host)) return { code: 7, message: "curl: (7) Failed to connect: Network is unreachable\n" };
  // E2B accepts the TCP connection and then drops it, so curl times out rather than being refused.
  if (!firewallAllows(network, true, host, port)) return { code: 28, message: "curl: (28) Operation timed out\n" };
  return undefined;
}

/** The bytes of a string, for tests. */
export const bytes = (text: string) => encoder.encode(text);
