/**
 * `fakeSandbox()`: a sandbox in memory, for tests of the code that runs on one. It enforces the policy it is given, so
 * a test can see a denial, and it records every `exec`, but it confines no process and runs no program: it understands
 * a few commands, listed at `FAKE_COMMANDS`. It is portable, so a test can use it on every target.
 */
import { HarnessError } from "../errors.js";
import { SandboxDeniedError, SandboxUnavailableError } from "../sandbox/errors.js";
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxClient,
  SandboxDenial,
  SandboxPolicy,
  WorkspaceManifest,
} from "../sandbox/types.js";

/** The options of `fakeSandbox()`. */
export interface FakeSandboxOptions {
  /** Makes `provision()` throw `SandboxUnavailableError` with this reason, as a backend that can't start does. */
  readonly unavailable?: string;
}

/** One command the fake received, with what the caller passed. */
export interface RecordedExec {
  readonly command: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number | undefined;
}

/** A fake backend, and what it has seen. */
export interface FakeSandboxClient extends SandboxClient {
  /** Every command run through any sandbox this client provisioned, in order. */
  readonly execs: readonly RecordedExec[];
  /** The files of the latest sandbox, by absolute path. */
  files(): ReadonlyMap<string, Uint8Array>;
  /** Makes `link` an absolute path that stands for `target` in the latest sandbox, as a symlink does. */
  symlink(link: string, target: string): void;
}

/**
 * The commands the fake runs, in the form `[name, ...arguments]`: `echo` prints its arguments, `env` prints the
 * environment it was given as `NAME=value` lines, `cat <path>` prints a file, `write <path> <text>` writes one,
 * `true` and `false` exit with 0 and 1, `sleep <seconds>` waits and honours the timeout and the signal, and
 * `net-probe <host>` reaches a host only if the policy allows it. Any other command exits with 127.
 */
export const FAKE_COMMANDS: readonly string[] = ["echo", "env", "cat", "write", "true", "false", "sleep", "net-probe"];

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

const within = (path: string, root: string): boolean => {
  const base = normalize(root);
  return base === "/" || path === base || path.startsWith(`${base}/`);
};

class FakeSandbox implements Sandbox {
  private disposed = false;
  // What ends each command still running, so `dispose()` can reject them as a real backend does.
  private readonly running = new Set<() => void>();
  readonly store = new Map<string, Uint8Array>();
  readonly links = new Map<string, string>();
  private readonly root: string;
  private readonly policy: SandboxPolicy;
  private readonly log: RecordedExec[];

  constructor(root: string, policy: SandboxPolicy, log: RecordedExec[]) {
    this.root = normalize(root);
    this.policy = policy;
    this.log = log;
  }

  private live(): void {
    if (this.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
  }

  /** The absolute path a name stands for: joined to the root, tidied of `.` and `..`, then followed through links. */
  resolve(path: string, base = this.root): string {
    const tidy = normalize(path.startsWith("/") ? path : `${base}/${path}`);
    for (const [link, target] of this.links) {
      if (tidy === link || tidy.startsWith(`${link}/`)) return normalize(`${target}${tidy.slice(link.length)}`);
    }
    return tidy;
  }

  private readDenial(path: string): SandboxDenial | undefined {
    const roots = [...this.policy.readRoots, ...this.policy.writeRoots];
    if (roots.some((root) => within(path, root))) return undefined;
    return { kind: "filesystem_read", target: path, reason: "the path is outside the read roots" };
  }

  private writeDenial(path: string): SandboxDenial | undefined {
    if (this.policy.writeRoots.some((root) => within(path, root))) return undefined;
    return { kind: "filesystem_write", target: path, reason: "the path is outside the write roots" };
  }

  private networkDenial(host: string): SandboxDenial | undefined {
    const { allow, deny } = this.policy.network;
    if (allow.includes(host) && !deny.includes(host)) return undefined;
    return { kind: "network", target: host, reason: "the host is not on the network allowlist" };
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.live();
    const target = this.resolve(path);
    const denial = this.readDenial(target);
    if (denial) throw new SandboxDeniedError(denial);
    const data = this.store.get(target);
    if (data === undefined) throw new HarnessError("sandbox_not_found", `no such file: ${target}`);
    return data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.live();
    const target = this.resolve(path);
    const denial = this.writeDenial(target);
    if (denial) throw new SandboxDeniedError(denial);
    this.store.set(target, data.slice());
  }

  /** Writes a file without a policy check, for the manifest's own files. */
  seed(path: string, data: Uint8Array): void {
    this.store.set(this.resolve(path), data.slice());
  }

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    this.live();
    if (!Array.isArray(command) || command.length === 0) {
      throw new HarnessError("invalid_sandbox_options", "a sandbox command is a non-empty list of strings");
    }
    options.signal.throwIfAborted();
    const cwd = this.resolve(options.cwd ?? ".");
    const denial = this.readDenial(cwd);
    if (denial) return { denied: denial };
    this.log.push({ command: [...command], cwd: options.cwd, env: { ...options.env }, timeoutMs: options.timeoutMs });
    const [name = "", ...args] = command;
    return this.run(name, args, options);
  }

  private async run(name: string, args: string[], options: ExecOptions): Promise<ExecResult> {
    const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "" });
    switch (name) {
      case "echo":
        return ok(`${args.join(" ")}\n`);
      case "env":
        return ok(
          Object.entries(options.env)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(""),
        );
      case "true":
        return ok();
      case "false":
        return { exitCode: 1, stdout: "", stderr: "" };
      case "cat":
        return this.cat(args[0] ?? "");
      case "write":
        return this.writeCommand(args[0] ?? "", args.slice(1).join(" "));
      case "net-probe": {
        const host = args[0] ?? "";
        const denial = this.networkDenial(host);
        return denial ? { denied: denial } : ok(`reached ${host}\n`);
      }
      case "sleep":
        return this.sleep(Number(args[0] ?? 0) * 1000, options);
      default:
        return { exitCode: 127, stdout: "", stderr: `command not found: ${name}\n` };
    }
  }

  private cat(path: string): ExecResult {
    const target = this.resolve(path);
    const denial = this.readDenial(target);
    if (denial) return { denied: denial };
    const data = this.store.get(target);
    return data === undefined
      ? { exitCode: 1, stdout: "", stderr: `no such file: ${target}\n` }
      : { exitCode: 0, stdout: DECODER.decode(data), stderr: "" };
  }

  private writeCommand(path: string, text: string): ExecResult {
    const target = this.resolve(path);
    const denial = this.writeDenial(target);
    if (denial) return { denied: denial };
    this.store.set(target, ENCODER.encode(text));
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  private sleep(ms: number, options: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const done = (result: ExecResult) => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", aborted);
        this.running.delete(disposed);
        resolve(result);
      };
      const aborted = () => {
        clearTimeout(timer);
        this.running.delete(disposed);
        reject(options.signal.reason);
      };
      const disposed = () => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", aborted);
        reject(new HarnessError("sandbox_disposed", "the sandbox was disposed"));
      };
      this.running.add(disposed);
      const stopAt = options.timeoutMs !== undefined && options.timeoutMs < ms ? options.timeoutMs : ms;
      const timer = setTimeout(() => {
        const timedOut = stopAt < ms;
        done({ exitCode: timedOut ? 124 : 0, stdout: "", stderr: timedOut ? `timed out after ${stopAt} ms\n` : "" });
      }, stopAt);
      options.signal.addEventListener("abort", aborted, { once: true });
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const stop of [...this.running]) stop();
    this.running.clear();
  }
}

/**
 * Builds a fake backend with the tier `os` and the stops `mistakes` and `exfiltration`, because it enforces the
 * policy's file roots and network allowlist in memory. That says nothing about a real process: it runs none.
 */
export function fakeSandbox(options: FakeSandboxOptions = {}): FakeSandboxClient {
  const execs: RecordedExec[] = [];
  let latest: FakeSandbox | undefined;
  return {
    tier: "os",
    stops: ["mistakes", "exfiltration"],
    execs,
    files: () => latest?.store ?? new Map(),
    symlink(link: string, target: string) {
      latest?.links.set(normalize(link), normalize(target));
    },
    async provision(manifest: WorkspaceManifest, policy: SandboxPolicy) {
      if (options.unavailable !== undefined) throw new SandboxUnavailableError("fake", options.unavailable);
      const sandbox = new FakeSandbox(manifest.root, policy, execs);
      for (const [path, data] of Object.entries(manifest.files ?? {})) {
        sandbox.seed(path, typeof data === "string" ? ENCODER.encode(data) : data);
      }
      latest = sandbox;
      return sandbox;
    },
  };
}
