/**
 * `noneSandbox()`: the backend that confines nothing. It runs a command as the host's own user with the environment it
 * is given, and it stops no mistake, no exfiltration and no hostile process, so its `stops` is empty and it refuses to
 * be built without `unsafe: true` (HD4, ADR 0020). It exists for a machine that is already disposable and for tests of
 * the rest of the harness. It is Node-only: it loads Node's modules by `process.getBuiltinModule()` when it is used.
 * It starts each command in its own process group, so a timeout, an abort or a dispose ends the command's whole tree.
 */
import { HarnessError } from "../errors.js";
import { SandboxUnavailableError } from "./errors.js";
import type { ExecOptions, ExecResult, Sandbox, SandboxClient, WorkspaceManifest } from "./types.js";

/** The options of `noneSandbox()`. */
export interface NoneSandboxOptions {
  /** Must be `true`: the caller says it knows this backend confines nothing. Leaving it out is a type error. */
  readonly unsafe: true;
  /** Receives the start-up warning, once for each sandbox provisioned. Defaults to a line on standard error. */
  readonly warn?: (message: string) => void;
}

/** The warning written when a sandbox starts. */
export const NONE_SANDBOX_WARNING =
  "WARNING: the none sandbox confines nothing. Commands run as this user with this machine's files and network.";

// The exit code GNU `timeout` uses, which callers already know.
const TIMEOUT_EXIT_CODE = 124;
// The exit code a shell gives for a program it can't find.
const NOT_FOUND_EXIT_CODE = 127;
// A shell reports a command that a signal killed as 128 plus the signal's number.
const SIGNAL_EXIT_BASE = 128;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

type Modules = {
  readonly cp: typeof import("node:child_process");
  readonly fs: typeof import("node:fs/promises");
  readonly os: typeof import("node:os");
  readonly path: typeof import("node:path");
};

function nodeModules(): Modules {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    throw new SandboxUnavailableError(
      "none",
      "it runs commands through Node's child_process, which this runtime lacks",
    );
  }
  return {
    cp: process.getBuiltinModule("node:child_process"),
    fs: process.getBuiltinModule("node:fs/promises"),
    os: process.getBuiltinModule("node:os"),
    path: process.getBuiltinModule("node:path"),
  };
}

function checkCommand(command: readonly string[]): void {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string")) {
    throw new HarnessError("invalid_sandbox_options", "a sandbox command is a non-empty list of strings");
  }
}

/** Keeps the first `limit` bytes of a stream and drops the rest, but keeps reading so the child never blocks. */
function capture(stream: NodeJS.ReadableStream, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  stream.on("data", (chunk: Uint8Array) => {
    const room = limit - size;
    if (chunk.length <= room) {
      chunks.push(chunk);
      size += chunk.length;
    } else {
      if (room > 0) chunks.push(chunk.subarray(0, room));
      size = limit;
      truncated = true;
    }
  });
  return {
    get truncated() {
      return truncated;
    },
    text(): string {
      const all = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        all.set(chunk, at);
        at += chunk.length;
      }
      return new TextDecoder().decode(all);
    },
  };
}

class NoneSandbox implements Sandbox {
  private disposed = false;
  private readonly root: string;
  private readonly modules: Modules;
  // What stops each command still running, so `dispose()` can end them.
  private readonly running = new Set<() => void>();

  constructor(root: string, modules: Modules) {
    this.root = root;
    this.modules = modules;
  }

  private live(): void {
    if (this.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
  }

  private resolve(path: string): string {
    return this.modules.path.resolve(this.root, path);
  }

  /** Kills the command's whole process group, or just the command where the platform has no groups. */
  private kill(child: import("node:child_process").ChildProcess): void {
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-pid, "SIGKILL");
    } catch {
      // The group is already gone, so there is nothing left to kill.
    }
  }

  /** The working directory as an absolute path, or an error when it isn't an existing folder. */
  private async workingDirectory(options: ExecOptions): Promise<string> {
    const cwd = this.resolve(options.cwd ?? ".");
    const stats = await this.modules.fs.stat(cwd).catch(() => undefined);
    if (!stats?.isDirectory()) {
      throw new HarnessError("invalid_sandbox_options", `the working directory ${cwd} is not an existing folder`);
    }
    return cwd;
  }

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    this.live();
    checkCommand(command);
    options.signal.throwIfAborted();
    const cwd = await this.workingDirectory(options);
    // The sandbox or the signal may have changed while the folder was checked.
    this.live();
    options.signal.throwIfAborted();
    return this.run(command as [string, ...string[]], cwd, options);
  }

  private run([program, ...args]: [string, ...string[]], cwd: string, options: ExecOptions): Promise<ExecResult> {
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    return new Promise((resolve, reject) => {
      const child = this.modules.cp.spawn(program, args, {
        cwd,
        env: { ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      const out = capture(child.stdout, limit);
      const err = capture(child.stderr, limit);
      const output = (note = "") => ({
        stdout: out.text(),
        stderr: `${err.text()}${note}`,
        ...(out.truncated || err.truncated ? { truncated: true } : {}),
      });
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal.removeEventListener("abort", onAbort);
        this.running.delete(onDispose);
        settle();
      };
      // Ends the whole tree and stops waiting for the pipes, which a surviving grandchild would hold open.
      const stop = (settle: () => void) => {
        this.kill(child);
        child.stdout.destroy();
        child.stderr.destroy();
        done(settle);
      };
      const onAbort = () => stop(() => reject(options.signal.reason));
      const onDispose = () => stop(() => reject(new HarnessError("sandbox_disposed", "the sandbox was disposed")));
      options.signal.addEventListener("abort", onAbort, { once: true });
      this.running.add(onDispose);
      if (options.timeoutMs !== undefined) {
        const note = `timed out after ${options.timeoutMs} ms\n`;
        timer = setTimeout(
          () => stop(() => resolve({ exitCode: TIMEOUT_EXIT_CODE, ...output(note) })),
          options.timeoutMs,
        );
      }
      child.on("error", (error: NodeJS.ErrnoException) => {
        done(() => {
          if (error.code === "ENOENT") {
            resolve({ exitCode: NOT_FOUND_EXIT_CODE, stdout: "", stderr: `command not found: ${program}\n` });
          } else {
            reject(error);
          }
        });
      });
      child.on("close", (code, signal) => {
        done(() => resolve({ ...this.exit(code, signal), ...output() }));
      });
    });
  }

  /** The exit code, and the signal's name when a signal killed the command. */
  private exit(code: number | null, signal: NodeJS.Signals | null): { exitCode: number; signal?: string } {
    if (signal === null) return { exitCode: code ?? 1 };
    return { exitCode: SIGNAL_EXIT_BASE + (this.modules.os.constants.signals[signal] ?? 0), signal };
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.live();
    return new Uint8Array(await this.modules.fs.readFile(this.resolve(path)));
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.live();
    const target = this.resolve(path);
    await this.modules.fs.mkdir(this.modules.path.dirname(target), { recursive: true });
    await this.modules.fs.writeFile(target, data);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const stop of [...this.running]) stop();
    this.running.clear();
  }
}

/**
 * Builds the `none` backend. Without `unsafe: true` it is a type error, and at run time it throws a `HarnessError`,
 * code `unsafe_sandbox_not_acknowledged`, so a JavaScript caller can't leave it out either. Provisioning writes the
 * warning, then the manifest's files under its root, which must be an existing absolute folder. The policy is
 * ignored: nothing here enforces it, which is what `stops: []` says.
 */
export function noneSandbox(options: NoneSandboxOptions): SandboxClient {
  if ((options as { unsafe?: unknown } | undefined)?.unsafe !== true) {
    throw new HarnessError(
      "unsafe_sandbox_not_acknowledged",
      "noneSandbox confines nothing, so it needs { unsafe: true } to say the caller knows",
    );
  }
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  return {
    tier: "none",
    stops: [],
    async provision(manifest: WorkspaceManifest) {
      const modules = nodeModules();
      if (!modules.path.isAbsolute(manifest.root)) {
        throw new HarnessError("invalid_sandbox_options", "a workspace manifest's root must be an absolute path");
      }
      const stats = await modules.fs.stat(manifest.root).catch(() => undefined);
      if (!stats?.isDirectory()) {
        throw new HarnessError("invalid_sandbox_options", "a workspace manifest's root must be an existing folder");
      }
      warn(NONE_SANDBOX_WARNING);
      const sandbox = new NoneSandbox(manifest.root, modules);
      const encoder = new TextEncoder();
      for (const [path, data] of Object.entries(manifest.files ?? {})) {
        await sandbox.writeFile(path, typeof data === "string" ? encoder.encode(data) : data);
      }
      return sandbox;
    },
  };
}
