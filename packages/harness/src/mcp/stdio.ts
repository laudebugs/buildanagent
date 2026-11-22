/**
 * The stdio channel: one MCP server as a child process, one JSON message per line on its standard input and output.
 * The harness spawns the child itself, with `spawnEnv()` plus the server's declared variables, because the MCP client
 * library's own stdio transport adds the parent's `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` to whatever
 * environment it is given. It is Node-only, and loads Node's modules by `process.getBuiltinModule()` when a server
 * starts, not by an import, so the `mcp` entry still loads on a runtime without them.
 *
 * Everything the child writes is bounded: a line longer than `maxLineBytes` closes the connection, a line that is not
 * a JSON object is dropped, and only the newest `maxStderrBytes` of standard error are kept. The child runs in its own
 * process group, so closing ends the server and anything it started.
 */
import { HarnessError } from "../errors.js";
import { spawnEnv } from "../sandbox/spawn-env.js";
import type { McpChannel, McpStdioTransport } from "./types.js";

const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_CLOSE_GRACE_MS = 2000;
const NEWLINE = 0x0a;

type ChildProcess = import("node:child_process").ChildProcess;

// The process groups still running, ended if the harness's own process exits without closing them. An exit handler
// must be synchronous, and `process.kill()` is.
const live = new Set<number>();
let exitHook = false;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

function track(pid: number): void {
  if (!exitHook) {
    exitHook = true;
    process.once("exit", () => {
      for (const group of live) killGroup(group, "SIGKILL");
    });
  }
  live.add(pid);
}

function wholeNumber(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new HarnessError("invalid_mcp_config", `${name} must be a whole number, 1 or more`);
  }
  return value;
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/** Checks a stdio transport's settings, so a typo fails when the manager is made and not when the server starts. */
export function checkStdioTransport(transport: McpStdioTransport): void {
  if (typeof transport.command !== "string" || transport.command === "") {
    throw new HarnessError("invalid_mcp_config", "a stdio server needs a command");
  }
  const args = transport.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new HarnessError("invalid_mcp_config", "a stdio server's args must be a list of strings");
  }
  if (transport.env !== undefined && !Array.isArray(transport.env)) {
    throw new HarnessError("invalid_mcp_config", "a stdio server's env must be a list of variable names");
  }
  // spawnEnv() checks the names and values now; a HOME of the caller's own makes it create no folder. Without Node it
  // can't run, and start() says so.
  if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
    spawnEnv(transport.env ?? [], { ...transport.setEnv, HOME: "/" });
  }
  wholeNumber("maxLineBytes", transport.maxLineBytes, DEFAULT_MAX_LINE_BYTES);
  wholeNumber("maxStderrBytes", transport.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES);
  wholeNumber("closeGraceMs", transport.closeGraceMs, DEFAULT_CLOSE_GRACE_MS);
}

/** A stdio server as a channel. The `pid` and `stderr` fields also tell the MCP client library it is a stdio channel. */
export class StdioChannel implements McpChannel {
  onmessage?: ((message: object) => void) | undefined;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;

  readonly #transport: McpStdioTransport;
  readonly #maxLine: number;
  readonly #maxStderr: number;
  readonly #grace: number;
  readonly #log: (line: string) => void;
  #child: ChildProcess | undefined;
  #home: string | undefined;
  #pending: Uint8Array[] = [];
  #pendingBytes = 0;
  #stderr: Uint8Array = new Uint8Array();
  #exited: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #closed = false;
  #endedByServer = false;
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(transport: McpStdioTransport, log: (line: string) => void) {
    checkStdioTransport(transport);
    this.#transport = transport;
    this.#maxLine = transport.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.#maxStderr = transport.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
    this.#grace = transport.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;
    this.#log = log;
  }

  /** The child's process id once it has started. */
  get pid(): number | undefined {
    return this.#child?.pid;
  }

  /** The newest bytes the child wrote to standard error, as text. */
  get stderr(): string {
    return new TextDecoder().decode(this.#stderr);
  }

  /** True when the server exited before anything asked the channel to close. */
  get endedByServer(): boolean {
    return this.#endedByServer;
  }

  /** True once the channel has closed, whoever closed it. */
  get closed(): boolean {
    return this.#closed;
  }

  async start(): Promise<void> {
    if (this.#child !== undefined) throw new HarnessError("invalid_mcp_config", "a stdio channel starts only once");
    if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
      throw new HarnessError(
        "invalid_mcp_config",
        "a stdio MCP server needs Node's child_process, which this runtime lacks",
      );
    }
    const cp = process.getBuiltinModule("node:child_process");
    const env = spawnEnv(this.#transport.env ?? [], this.#transport.setEnv ?? {});
    // spawnEnv() made this folder unless the server's own HOME replaced it, and the channel removes what it made.
    if (this.#transport.setEnv?.HOME === undefined) this.#home = env.HOME;
    const child = cp.spawn(this.#transport.command, [...(this.#transport.args ?? [])], {
      env,
      ...(this.#transport.cwd === undefined ? {} : { cwd: this.#transport.cwd }),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
    });
    this.#child = child;
    this.#exited = new Promise((resolve) => child.once("exit", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => resolve());
        child.once("error", reject);
      });
    } catch (error) {
      this.#removeHome();
      this.#closed = true;
      throw error;
    }
    if (child.pid !== undefined) track(child.pid);
    child.on("error", (error) => this.onerror?.(error));
    child.stdin?.on("error", () => {
      // A server that exits stops reading; the exit closes the channel, so a failed write needs no second report.
    });
    child.stdout?.on("data", (chunk: Uint8Array) => this.#read(chunk));
    child.stderr?.on("data", (chunk: Uint8Array) => this.#keepStderr(chunk));
    void this.#exited.then(() => {
      if (this.#closing === undefined) {
        this.#endedByServer = true;
        this.#log(`the server exited with code ${String(child.exitCode)} and signal ${String(child.signalCode)}`);
        void this.close();
      }
    });
  }

  async send(message: object): Promise<void> {
    const stdin = this.#child?.stdin;
    if (this.#closing !== undefined || stdin === undefined || stdin === null) {
      throw new HarnessError("mcp_call_failed", "the server's channel is closed");
    }
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      stdin.write(line, (error) => (error ? reject(error) : resolve()));
    });
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutdown();
    return this.#closing;
  }

  async #shutdown(): Promise<void> {
    const child = this.#child;
    const pid = child?.pid;
    if (child !== undefined && pid !== undefined) {
      const running = () => child.exitCode === null && child.signalCode === null;
      try {
        child.stdin?.end();
      } catch {
        // The pipe is already closed.
      }
      if (running() && !(await this.#exitWithin(this.#grace))) {
        killGroup(pid, "SIGTERM");
        if (!(await this.#exitWithin(this.#grace))) killGroup(pid, "SIGKILL");
      }
      // The server may have left children in its group, and they hold nothing the harness needs.
      killGroup(pid, "SIGKILL");
      await this.#exitWithin(this.#grace);
      live.delete(pid);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
    }
    this.#removeHome();
    this.#pending = [];
    this.#pendingBytes = 0;
    this.#closed = true;
    this.onclose?.();
  }

  async #exitWithin(ms: number): Promise<boolean> {
    const exited = this.#exited;
    if (exited === undefined) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    const result = await Promise.race([exited.then(() => true), expired]);
    clearTimeout(timer);
    return result;
  }

  #removeHome(): void {
    const home = this.#home;
    this.#home = undefined;
    if (home === undefined) return;
    try {
      process.getBuiltinModule("node:fs").rmSync(home, { recursive: true, force: true });
    } catch {
      // A temp folder left behind is harmless, and the close must still finish.
    }
  }

  #keepStderr(chunk: Uint8Array): void {
    const joined = concat([this.#stderr, chunk], this.#stderr.length + chunk.length);
    this.#stderr = joined.length <= this.#maxStderr ? joined : joined.slice(joined.length - this.#maxStderr);
  }

  #read(chunk: Uint8Array): void {
    if (this.#closing !== undefined) return;
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(NEWLINE, start);
      const piece = chunk.subarray(start, end === -1 ? chunk.length : end);
      if (this.#pendingBytes + piece.length > this.#maxLine) {
        this.#log(`the server wrote a line over ${this.#maxLine} bytes, so the connection was closed`);
        this.onerror?.(new Error(`the server wrote a line over ${this.#maxLine} bytes`));
        void this.close();
        return;
      }
      if (end === -1) {
        if (piece.length > 0) {
          this.#pending.push(piece.slice());
          this.#pendingBytes += piece.length;
        }
        return;
      }
      const line =
        this.#pending.length === 0 ? piece : concat([...this.#pending, piece], this.#pendingBytes + piece.length);
      this.#pending = [];
      this.#pendingBytes = 0;
      this.#deliver(line);
      start = end + 1;
    }
  }

  #deliver(bytes: Uint8Array): void {
    let message: unknown;
    try {
      const text = this.#decoder.decode(bytes).replace(/\r$/, "");
      if (text.trim() === "") return;
      message = JSON.parse(text);
    } catch {
      message = undefined;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      this.#log("the server wrote a line that is not a JSON object, and it was dropped");
      this.onerror?.(new Error("the server wrote a line that is not a JSON object"));
      return;
    }
    this.onmessage?.(message);
  }
}
