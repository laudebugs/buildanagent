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
 * `net-probe <host>` reaches a host only if the policy allows it. `find <dir>` lists the files under a folder, one per
 * line or ending in NUL with `-print0`, and leaves out every folder named by a `-name` when the command has `-prune`,
 * the starting folder included unless `! -path <start>` exempts it. It exits with 0 and prints nothing for a folder
 * with no files, and with 1 for a path that does not exist. `grep [-i] -e <pattern> -- <file>...` prints each
 * matching line as `file:line:text`, reading the pattern as a JavaScript regular expression and skipping a file that
 * holds a NUL byte. It exits with 1 when nothing matches, and with 2 after a missing file or a pattern it can't read,
 * as grep does. A command that runs past its timeout exits with 124 and `timedOut: true`, and each stream keeps at
 * most `maxOutputBytes`, with `truncated: true` when more was dropped.
 * `bash -c <script>` and `sh -c <script>` split the script on whitespace and run its words as one of these commands,
 * with no shell syntax. Any other command exits with 127.
 */
export const FAKE_COMMANDS: readonly string[] = [
  "echo",
  "env",
  "cat",
  "write",
  "true",
  "false",
  "sleep",
  "net-probe",
  "find",
  "grep",
  "bash",
  "sh",
];

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
// What a real backend keeps of each stream when the caller names no cap.
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** The lines of `text` that match, as `grep -n -H` prints them. */
function matchingLines(file: string, text: string, pattern: RegExp): string {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return lines.map((line, index) => (pattern.test(line) ? `${file}:${index + 1}:${line}\n` : "")).join("");
}

/** A `find -path` pattern with its backslash escapes removed, as the literal path it names. */
const literalOf = (pattern: string | undefined): string | undefined => pattern?.replace(/\\(.)/g, "$1");

/** `text` cut to its first `bytes` UTF-8 bytes, never splitting a character, and whether anything was cut. */
function capped(text: string, bytes: number): { text: string; cut: boolean } {
  const encoded = ENCODER.encode(text);
  if (encoded.length <= bytes) return { text, cut: false };
  let end = bytes;
  while (end > 0 && ((encoded[end] as number) & 0b1100_0000) === 0b1000_0000) end -= 1;
  return { text: DECODER.decode(encoded.subarray(0, end)), cut: true };
}

/** The pattern of a `grep` command's flags, or the result grep gives for a pattern it can't read. */
function patternOf(flags: readonly string[]): RegExp | ExecResult {
  const at = flags.indexOf("-e");
  try {
    return new RegExp(at < 0 ? "" : (flags[at + 1] ?? ""), flags.includes("-i") ? "i" : "");
  } catch (error) {
    // grep reports a pattern it can't read on standard error and exits with 2, before it reads any file.
    return { exitCode: 2, stdout: "", stderr: `grep: ${(error as Error).message}\n` };
  }
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
    const result = await this.run(name, args, options);
    if ("denied" in result) return result;
    // Each stream keeps at most `maxOutputBytes`, as a real backend's does.
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const stdout = capped(result.stdout, limit);
    const stderr = capped(result.stderr, limit);
    if (!stdout.cut && !stderr.cut) return result;
    return { ...result, stdout: stdout.text, stderr: stderr.text, truncated: true };
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
      case "find":
        return this.find(args);
      case "grep":
        return this.grep(args);
      case "bash":
      case "sh":
        return this.shell(args, options);
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

  /** The script's words as one command, so a test can drive a shell tool without a shell. */
  private shell(args: string[], options: ExecOptions): Promise<ExecResult> {
    if (args[0] !== "-c") return Promise.resolve({ exitCode: 2, stdout: "", stderr: "the fake shell runs only -c\n" });
    const [name = "", ...rest] = (args[1] ?? "").trim().split(/\s+/);
    return this.run(name, rest, options);
  }

  /** Whether `path` is a folder: the root, a folder above it, or a folder that holds a file. */
  private isFolder(path: string): boolean {
    if (within(this.root, path)) return true;
    const prefix = path === "/" ? "/" : `${path}/`;
    return [...this.store.keys()].some((file) => file.startsWith(prefix));
  }

  private find(args: string[]): ExecResult {
    const start = this.resolve(args[0] ?? ".");
    const denial = this.readDenial(start);
    if (denial) return { denied: denial };
    if (!this.store.has(start) && !this.isFolder(start)) {
      return { exitCode: 1, stdout: "", stderr: `find: '${args[0] ?? "."}': No such file or directory\n` };
    }
    const named = args.flatMap((arg, index) => (arg === "-name" ? [args[index + 1] ?? ""] : []));
    const pruned = new Set(args.includes("-prune") ? named : []);
    // `! -path <start>` exempts the starting point from the prune, as it does for find; without it the prune tests
    // the starting point's own name too, so a search that starts in a pruned folder finds nothing.
    const exempt = args.some(
      (arg, index) => arg === "!" && args[index + 1] === "-path" && literalOf(args[index + 2]) === start,
    );
    const ownName = start.split("/").at(-1) ?? "";
    if (!exempt && ownName !== "" && pruned.has(ownName)) return { exitCode: 0, stdout: "", stderr: "" };
    const files = [...this.store.keys()]
      .filter((path) => path === start || path.startsWith(`${start === "/" ? "" : start}/`))
      .filter(
        (path) =>
          !path
            .slice(start.length)
            .split("/")
            .some((part) => pruned.has(part)),
      )
      .sort();
    const end = args.includes("-print0") ? "\0" : "\n";
    return { exitCode: 0, stdout: files.map((path) => `${path}${end}`).join(""), stderr: "" };
  }

  private grep(args: string[]): ExecResult {
    const split = args.indexOf("--");
    const flags = split < 0 ? args : args.slice(0, split);
    const files = split < 0 ? [] : args.slice(split + 1);
    const pattern = patternOf(flags);
    if (!(pattern instanceof RegExp)) return pattern;
    let stdout = "";
    let stderr = "";
    for (const file of files) {
      const target = this.resolve(file);
      const denial = this.readDenial(target);
      if (denial) return { denied: denial };
      const data = this.store.get(target);
      if (data === undefined) stderr += `grep: ${file}: No such file or directory\n`;
      else if (!data.includes(0)) stdout += matchingLines(file, DECODER.decode(data), pattern);
    }
    // grep exits with 2 after any error, even when other files matched.
    return { exitCode: stderr !== "" ? 2 : stdout === "" ? 1 : 0, stdout, stderr };
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
        done(
          timedOut
            ? { exitCode: 124, stdout: "", stderr: `timed out after ${stopAt} ms\n`, timedOut: true }
            : { exitCode: 0, stdout: "", stderr: "" },
        );
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
