/**
 * The process handling that the Node-only sandbox backends share: checking a command's options, running it in its own
 * process group, capping its output, and ending the whole tree on a timeout, an abort or a dispose. It loads Node's
 * modules by `process.getBuiltinModule()` when it is used, so importing it costs a portable bundle nothing.
 */
import { HarnessError } from "../errors.js";
import { SandboxUnavailableError } from "./errors.js";
import type { ExecOptions, ExecResult } from "./types.js";

// The exit code GNU `timeout` uses, which callers already know.
const TIMEOUT_EXIT_CODE = 124;
// The exit code a shell gives for a program it can't find.
const NOT_FOUND_EXIT_CODE = 127;
// A shell reports a command that a signal killed as 128 plus the signal's number.
const SIGNAL_EXIT_BASE = 128;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
// The longest delay a timer takes: a larger one fires at once.
const MAX_TIMER_MS = 2 ** 31 - 1;
// The longest a stop waits for a backend's `onStop` hook.
const STOP_HOOK_MAX_MS = 15_000;

/** The Node modules the backends use. */
export type NodeModules = {
  readonly cp: typeof import("node:child_process");
  readonly fs: typeof import("node:fs/promises");
  readonly os: typeof import("node:os");
  readonly path: typeof import("node:path");
  readonly url: typeof import("node:url");
};

/** Node's modules, or a `SandboxUnavailableError` for `backend` on a runtime that lacks them. */
export function nodeModules(backend: string): NodeModules {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    throw new SandboxUnavailableError(
      backend,
      "it runs commands through Node's child_process, which this runtime lacks",
    );
  }
  return {
    cp: process.getBuiltinModule("node:child_process"),
    fs: process.getBuiltinModule("node:fs/promises"),
    os: process.getBuiltinModule("node:os"),
    path: process.getBuiltinModule("node:path"),
    url: process.getBuiltinModule("node:url"),
  };
}

/** The length to keep of cut output, backing up over a UTF-8 character that the cut split. */
function whole(chunks: readonly Uint8Array[], size: number): number {
  const last = chunks[chunks.length - 1];
  if (last === undefined) return 0;
  // Find the lead byte of the last character within the final three bytes, and drop it if its character is incomplete.
  for (let back = 1; back <= Math.min(3, last.length); back += 1) {
    const byte = last[last.length - back] as number;
    if ((byte & 0xc0) === 0x80) continue;
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return need > back ? size - back : size;
  }
  return size;
}

/** Throws unless the options are usable. */
export function checkOptions(options: ExecOptions): void {
  const { maxOutputBytes, timeoutMs } = options;
  if (maxOutputBytes !== undefined && !(Number.isInteger(maxOutputBytes) && maxOutputBytes >= 0)) {
    throw new HarnessError("invalid_sandbox_options", "maxOutputBytes must be a non-negative whole number");
  }
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMER_MS)) {
    throw new HarnessError("invalid_sandbox_options", `timeoutMs must be a number from 1 to ${MAX_TIMER_MS}`);
  }
}

/** Throws unless the command is a non-empty list of strings. */
export function checkCommand(command: readonly string[]): void {
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
  const joined = (): Uint8Array => {
    const all = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      all.set(chunk, at);
      at += chunk.length;
    }
    return all;
  };
  return {
    get truncated() {
      return truncated;
    },
    bytes: joined,
    text(): string {
      const all = joined();
      return new TextDecoder().decode(truncated ? all.subarray(0, whole(chunks, size)) : all);
    },
  };
}

type Capture = ReturnType<typeof capture>;

/** A process's captured output as the fields of a result, with `note` added to the end of standard error. */
function outputOf(out: Capture, err: Capture, note: string) {
  return {
    stdout: out.text(),
    stdoutBytes: out.bytes(),
    stderr: `${err.text()}${note}`,
    ...(out.truncated || err.truncated ? { truncated: true } : {}),
  };
}

/** The result for a program that can't be started, as a shell reports it. */
function notFound(program: string) {
  return {
    exitCode: NOT_FOUND_EXIT_CODE,
    stdout: "",
    stdoutBytes: new Uint8Array(),
    stderr: `command not found: ${program}\n`,
  };
}

/** What one process is started with. */
export interface ProcessSpec {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Bytes to write to the process's standard input before closing it. Without it, standard input is closed at once. */
  readonly input?: Uint8Array;
  /** Whether a program that can't be started is a result with exit code 127, as a shell gives, or a rejection. */
  readonly missingProgram: "result" | "reject";
  /**
   * How long a stopped process's group has to exit after a `SIGTERM`, which lets a program clean up, before a `SIGKILL`
   * ends what is left. Without it the group is killed at once.
   */
  readonly graceMs?: number;
  /**
   * Runs, and is awaited, when a timeout, an abort or `stopAll()` ends the process, before its group is killed. A
   * backend whose commands run outside the process's group, such as in a container, ends them here.
   */
  readonly onStop?: () => Promise<void>;
}

/** A finished process: the `ExecResult` fields, and the raw bytes of standard output. */
export type ProcessResult = Extract<ExecResult, { exitCode: number }> & { readonly stdoutBytes: Uint8Array };

/** Runs processes, each in its own group, and ends them all on `stopAll()`. */
export class ProcessRunner {
  private readonly modules: NodeModules;
  // What stops each process still running, so `stopAll()` can end them.
  private readonly running = new Set<() => Promise<void>>();

  constructor(modules: NodeModules) {
    this.modules = modules;
  }

  /** Kills the process's whole group, or just the process where the platform has no groups. */
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

  /** The exit code, and the signal's name when a signal killed the process. */
  private exit(code: number | null, signal: NodeJS.Signals | null): { exitCode: number; signal?: string } {
    if (signal === null) return { exitCode: code ?? 1 };
    return { exitCode: SIGNAL_EXIT_BASE + (this.modules.os.constants.signals[signal] ?? 0), signal };
  }

  /** Ends every process still running, each one's promise rejecting with `sandbox_disposed`, and waits until they have. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.running].map((stop) => stop()));
  }

  /** Ends the process's group: at once, or with a `SIGTERM` first and a `SIGKILL` after `graceMs` for what is left. */
  private async end(
    child: import("node:child_process").ChildProcess,
    graceMs: number,
    onStop?: () => Promise<void>,
  ): Promise<void> {
    // Runs beside the kill, and is waited for only so long, so a hook that hangs can't hold the call.
    const hook = onStop?.().catch(() => {});
    const running = child.exitCode === null && child.signalCode === null;
    if (graceMs > 0 && process.platform !== "win32" && child.pid !== undefined && running) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      });
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The group is already gone.
      }
      await Promise.race([exited, expired]);
      clearTimeout(timer);
    }
    this.kill(child);
    if (hook !== undefined)
      await Promise.race([hook, new Promise<void>((resolve) => setTimeout(resolve, STOP_HOOK_MAX_MS).unref())]);
  }

  /**
   * Runs the process and resolves when it exits, its signal aborts it, its timeout passes (exit code 124) or `stopAll()`
   * runs. An abort rejects with the signal's reason, and `stopAll()` with `sandbox_disposed`.
   */
  run(spec: ProcessSpec, options: ExecOptions): Promise<ProcessResult> {
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    return new Promise((resolve, reject) => {
      const child = this.modules.cp.spawn(spec.program, [...spec.args], {
        cwd: spec.cwd,
        env: { ...spec.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      const out = capture(child.stdout, limit);
      const err = capture(child.stderr, limit);
      const output = (note = "") => outputOf(out, err, note);
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
      let stopping: Promise<void> | undefined;
      const stop = (settle: () => void): Promise<void> => {
        if (stopping !== undefined || settled) return stopping ?? Promise.resolve();
        stopping = this.end(child, spec.graceMs ?? 0, spec.onStop).then(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          done(settle);
        });
        return stopping;
      };
      const onAbort = () => void stop(() => reject(options.signal.reason));
      const onDispose = () => stop(() => reject(new HarnessError("sandbox_disposed", "the sandbox was disposed")));
      options.signal.addEventListener("abort", onAbort, { once: true });
      this.running.add(onDispose);
      if (options.timeoutMs !== undefined) {
        const note = `timed out after ${options.timeoutMs} ms\n`;
        timer = setTimeout(
          () => void stop(() => resolve({ exitCode: TIMEOUT_EXIT_CODE, ...output(note) })),
          options.timeoutMs,
        );
      }
      child.on("error", (error: NodeJS.ErrnoException) => {
        done(() => {
          if (error.code === "ENOENT" && spec.missingProgram === "result") {
            resolve(notFound(spec.program));
          } else {
            reject(error);
          }
        });
      });
      child.on("close", (code, signal) => {
        // A stop in progress settles the call itself, with the reason that began it.
        if (stopping !== undefined) return;
        // A failure while building the result must reject, not leave the promise pending.
        done(() => {
          try {
            resolve({ ...this.exit(code, signal), ...output() });
          } catch (error) {
            reject(error);
          }
        });
      });
      // A process that exits before it reads its input closes the pipe, which is no error of ours.
      child.stdin.on("error", () => {});
      child.stdin.end(spec.input);
    });
  }
}
