/**
 * One provisioned Vercel sandbox, as a `Sandbox`. Every command runs under `env -i`, so it holds only the variables it
 * was given. The file calls resolve each path inside the VM and check it against the policy's roots, and every command,
 * variable and file is scanned for the credential values the firewall injects, which never enter the sandbox. The
 * underlying `@vercel/sandbox` object lives in a private field, so the handle serializes to its id alone.
 */
import { scrubCutString, scrubString } from "../../credentials/scrub.js";
import { HarnessError } from "../../errors.js";
import { SandboxDeniedError, SandboxUnsupportedError } from "../errors.js";
import { isProtectedPath } from "../host-files.js";
import { APPLY_STOPS, confirmPolicy } from "../policy.js";
import { checkCommand, checkOptions } from "../process.js";
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxClient,
  SandboxDenial,
  SandboxPolicy,
  SandboxStop,
} from "../types.js";
import { type CompiledFirewall, readBackHosts } from "./firewall.js";
import { inside, normalize, parentOf, relativeTo, resolveAgainst } from "./paths.js";
import type { VercelCommand, VercelFinishedCommand, VercelSandboxInstance, VercelSandboxSdk } from "./sdk.js";

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
// Vercel stops a command on its own this long after the host's timeout, in case the host's kill never arrives.
const BACKSTOP_MS = 5000;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENCODER = new TextEncoder();

/** What a handle is built from. */
export interface HandleState {
  readonly sdk: VercelSandboxSdk;
  readonly vm: VercelSandboxInstance;
  /** The workspace root, which relative paths resolve against. */
  readonly root: string;
  readonly requested: SandboxPolicy;
  readonly firewall: CompiledFirewall;
  readonly persistent: boolean;
}

/** A command that is still running, which `dispose()` ends. */
interface Running {
  cancel(): void;
}

/** A copy of an SDK error that holds no credential value and no nested cause, which may quote a request. */
export function sanitized(error: unknown, secrets: readonly string[]): Error {
  const message = error instanceof Error ? error.message : String(error);
  const copy = new Error(scrubString(message, secrets));
  copy.name = error instanceof Error ? error.name : "Error";
  return copy;
}

// The shortest part of a header value worth looking for on its own, so a short scheme word redacts nothing.
const MIN_TOKEN = 8;

/**
 * The values to keep out of the sandbox and scrub from what it returns: each header value, and the token after its
 * scheme, such as the `ghp_…` of `Bearer ghp_…`, which a command could carry without the scheme.
 */
export function guarded(values: readonly string[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    found.add(value);
    const token = /^[A-Za-z][A-Za-z0-9_-]* (.+)$/.exec(value)?.[1]?.trim();
    if (token !== undefined && token.length >= MIN_TOKEN) found.add(token);
  }
  return [...found];
}

/** Where `needle` starts in `data` at or after `from`, or -1. */
function indexOfBytes(data: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let start = from; start + needle.length <= data.length; start += 1) {
    for (let at = 0; at < needle.length; at += 1) if (data[start + at] !== needle[at]) continue outer;
    return start;
  }
  return -1;
}

/** `data` with each secret's UTF-8 bytes replaced by `[REDACTED]`, longest secret first. */
function redactBytes(data: Uint8Array, secrets: readonly string[]): Uint8Array {
  let result = data;
  const marker = ENCODER.encode("[REDACTED]");
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    const needle = ENCODER.encode(secret);
    const parts: Uint8Array[] = [];
    let from = 0;
    for (let at = indexOfBytes(result, needle); at >= 0; at = indexOfBytes(result, needle, from)) {
      parts.push(result.subarray(from, at), marker);
      from = at + needle.length;
    }
    if (parts.length === 0) continue;
    parts.push(result.subarray(from));
    const joined = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    result = joined;
  }
  return result;
}

/** The text kept of one stream: at most `limit` UTF-8 bytes, backing up over a character the cut split. */
function capped(text: string, limit: number): { text: string; truncated: boolean } {
  const bytes = ENCODER.encode(text);
  if (bytes.length <= limit) return { text, truncated: false };
  let end = limit;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true };
}

/** A provisioned Vercel sandbox. */
export class VercelSandbox implements Sandbox {
  readonly id: string;
  readonly #state: HandleState;
  #secrets: readonly string[];
  #applied: readonly SandboxStop[] = [];
  #disposed = false;
  #disposing: Promise<void> | undefined;
  readonly #running = new Set<Running>();
  readonly #kills = new Set<Promise<unknown>>();
  // The real paths of the roots, which a path is checked against once the VM has resolved its links.
  #realRead: readonly string[] = [];
  #realWrite: readonly string[] = [];

  constructor(state: HandleState) {
    this.#state = state;
    this.id = state.vm.name;
    this.#secrets = guarded(state.firewall.secrets);
  }

  get stops(): readonly SandboxStop[] {
    return this.#applied;
  }

  /** Sets the stops a resumed sandbox's confirmed policy delivers, for `resumeSandbox()`. */
  [APPLY_STOPS](stops: readonly SandboxStop[]): void {
    this.#applied = stops;
  }

  /** The handle as JSON: its id only, so a serialized session never carries the SDK object or its token. */
  toJSON(): { id: string } {
    return { id: this.id };
  }

  #live(): void {
    if (this.#disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
  }

  /** Throws unless no string holds a credential value, before anything is sent to the sandbox. */
  #refuseSecrets(texts: readonly string[], what: string): void {
    if (texts.some((text) => this.#secrets.some((secret) => text.includes(secret)))) {
      throw new HarnessError("invalid_sandbox_options", `${what} holds the value of a credential the firewall injects`);
    }
  }

  /** Makes the roots and the workspace, and records their real paths. Run once, before the sandbox is handed out. */
  async prepareRoots(): Promise<void> {
    const { requested, root } = this.#state;
    const folders = [...new Set([...requested.writeRoots, root].map(normalize))];
    if (folders.length > 0) await this.#helper("mkdir", ["-p", "--", ...folders]);
    const real = async (paths: readonly string[]) => Promise.all(paths.map((path) => this.#realPath(normalize(path))));
    this.#realWrite = await real(requested.writeRoots);
    this.#realRead = [...(await real(requested.readRoots)), ...this.#realWrite];
  }

  /** Reads the policy back and checks it against `requested`, or disposes the sandbox and throws on a difference. */
  async confirm(client: SandboxClient, requested: SandboxPolicy): Promise<void> {
    this.#applied = await confirmPolicy(client, this, requested);
  }

  /** Runs a helper program, outside the caller's environment, and resolves with its standard output. */
  async #helper(cmd: string, args: string[]): Promise<string> {
    const finished = await this.#call(async () => {
      const command = await this.#state.vm.runCommand({ cmd, args, cwd: "/", detached: true, sudo: false });
      return command.wait();
    });
    const stdout = await this.#call(() => finished.stdout());
    if (finished.exitCode !== 0) {
      throw new HarnessError("sandbox_io_failed", `the sandbox's ${cmd} failed with exit code ${finished.exitCode}`);
    }
    return stdout;
  }

  /** Runs an SDK call, and turns its failure into `sandbox_io_failed` with a copy of the error that holds no credential. */
  async #call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("sandbox_io_failed", "a call to the Vercel sandbox failed", {
        cause: sanitized(error, this.#secrets),
      });
    }
  }

  /** The path with its links resolved inside the VM. A missing tail is kept as written. */
  async #realPath(path: string): Promise<string> {
    const printed = await this.#helper("realpath", ["-m", "--", path]);
    return normalize(printed.replace(/\n$/, ""));
  }

  /** The real path of `path` for a read or a write, or a `SandboxDeniedError` when the policy refuses it. */
  async #allowed(path: string, kind: "filesystem_read" | "filesystem_write"): Promise<string> {
    if (typeof path !== "string" || path === "" || /[\0\n\r]/.test(path)) {
      throw new HarnessError("invalid_sandbox_options", "a sandbox path is a non-empty string with no NUL or newline");
    }
    this.#refuseSecrets([path], "the path");
    const requested = this.#state.requested;
    const lexical = resolveAgainst(this.#state.root, path);
    this.#check(
      lexical,
      kind,
      kind === "filesystem_write" ? requested.writeRoots : [...requested.readRoots, ...requested.writeRoots],
      path,
    );
    const real = await this.#realPath(lexical);
    this.#live();
    this.#check(real, kind, kind === "filesystem_write" ? this.#realWrite : this.#realRead, path);
    return real;
  }

  /** Throws `SandboxDeniedError` unless `path` lies in one of `roots` and, for a write, is not a protected file. */
  #check(path: string, kind: SandboxDenial["kind"], roots: readonly string[], target: string): void {
    const holding = roots.map(normalize).filter((root) => inside(root, path));
    if (holding.length === 0) {
      throw new SandboxDeniedError({ kind, target, reason: "the path is outside the sandbox's roots" });
    }
    if (kind === "filesystem_write" && holding.every((root) => isProtectedPath(relativeTo(root, path)))) {
      throw new SandboxDeniedError({ kind, target, reason: "the path is a protected file" });
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.#live();
    const real = await this.#allowed(path, "filesystem_read");
    const data = await this.#call(() => this.#state.vm.readFileToBuffer({ path: real }));
    this.#live();
    if (data === null) throw new HarnessError("sandbox_not_found", `no file at ${path}`);
    // A process in the sandbox could have saved a credential that an allowed service echoed back.
    return redactBytes(new Uint8Array(data), this.#secrets);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.#live();
    if (!(data instanceof Uint8Array)) throw new HarnessError("invalid_sandbox_options", "file data is a Uint8Array");
    if (this.#secrets.some((secret) => indexOfBytes(data, ENCODER.encode(secret)) >= 0)) {
      throw new HarnessError(
        "invalid_sandbox_options",
        "the file holds the value of a credential the firewall injects",
      );
    }
    const real = await this.#allowed(path, "filesystem_write");
    await this.#helper("mkdir", ["-p", "--", parentOf(real)]);
    this.#live();
    await this.#call(() => this.#state.vm.writeFiles([{ path: real, content: data }]));
  }

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    this.#live();
    checkCommand(command);
    checkOptions(options);
    options.signal.throwIfAborted();
    const env = options.env ?? {};
    const assignments: string[] = [];
    for (const [name, value] of Object.entries(env)) {
      if (!VARIABLE_NAME.test(name) || typeof value !== "string" || value.includes("\0")) {
        throw new HarnessError("invalid_sandbox_options", `${JSON.stringify(name)} is not a usable variable`);
      }
      assignments.push(`${name}=${value}`);
    }
    this.#refuseSecrets([...command, ...assignments, options.cwd ?? ""], "the command");
    const cwd = await this.#workingDirectory(options.cwd);
    if (typeof cwd !== "string") return cwd;
    this.#live();
    options.signal.throwIfAborted();
    if (command[0]?.includes("=")) return { exitCode: 127, stdout: "", stderr: `command not found: ${command[0]}\n` };
    // `env -i` clears the image's own variables, and `--` ends its options, so a first word that starts with `-` is a
    // program name.
    return this.#run(["-i", "--", ...assignments, ...command], cwd, options);
  }

  /** The real working directory, or the denial for one outside the roots. */
  async #workingDirectory(cwd: string | undefined): Promise<string | ExecResult> {
    if (cwd === undefined) return normalize(this.#state.root);
    try {
      return await this.#allowed(cwd, "filesystem_read");
    } catch (error) {
      if (error instanceof SandboxDeniedError) return { denied: error.denial };
      throw error;
    }
  }

  /** Starts `env` with `args`, and settles at its end, its timeout, the caller's abort or `dispose()`. */
  #run(args: string[], cwd: string, options: ExecOptions): Promise<ExecResult> {
    const controller = new AbortController();
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let started: VercelCommand | undefined;
    let done = false;
    return new Promise<ExecResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const entry: Running = {
        cancel: () => stop(() => reject(new HarnessError("sandbox_disposed", "the sandbox was disposed"))),
      };
      const finish = (settle: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal.removeEventListener("abort", onAbort);
        this.#running.delete(entry);
        settle();
      };
      const stop = (settle: () => void) => {
        finish(settle);
        controller.abort();
        if (started !== undefined) this.#kill(started);
      };
      const onAbort = () => stop(() => reject(options.signal.reason));
      this.#running.add(entry);
      options.signal.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        const note = `timed out after ${options.timeoutMs} ms\n`;
        timer = setTimeout(
          () => stop(() => resolve({ exitCode: 124, stdout: "", stderr: note, timedOut: true })),
          options.timeoutMs,
        );
      }
      const backstop = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs + BACKSTOP_MS };
      this.#state.vm
        .runCommand({ cmd: "env", args, cwd, detached: true, sudo: false, signal: controller.signal, ...backstop })
        .then(async (command) => {
          started = command;
          // A stop that came while the command was starting could not kill it then.
          if (done) return this.#kill(command);
          const finished = await command.wait({ signal: controller.signal });
          const result = await this.#result(finished, limit);
          finish(() => resolve(result));
        })
        .catch((error: unknown) =>
          finish(() =>
            reject(
              new HarnessError("sandbox_io_failed", "a command in the Vercel sandbox failed to run", {
                cause: sanitized(error, this.#secrets),
              }),
            ),
          ),
        );
    });
  }

  /** Sends `SIGKILL`, and keeps the call in the set `dispose()` waits for. */
  #kill(command: VercelCommand): void {
    const kill = command.kill("SIGKILL").catch(() => undefined);
    this.#kills.add(kill);
    void kill.then(() => this.#kills.delete(kill));
  }

  /** A finished command's result, capped and with every credential value scrubbed from its output. */
  async #result(finished: VercelFinishedCommand, limit: number): Promise<ExecResult> {
    const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()]);
    const out = capped(stdout, limit);
    const err = capped(stderr, limit);
    const scrub = (part: { text: string; truncated: boolean }) =>
      part.truncated ? scrubCutString(part.text, this.#secrets) : scrubString(part.text, this.#secrets);
    return {
      exitCode: finished.exitCode,
      stdout: scrub(out),
      stderr: scrub(err),
      ...(out.truncated || err.truncated ? { truncated: true } : {}),
    };
  }

  /**
   * The policy Vercel reports for this sandbox, fetched again by name, so a change made since `provision()` shows.
   * The hosts come from the firewall policy; the roots come from the backend's own record, because Vercel holds none.
   */
  async readBack(): Promise<SandboxPolicy> {
    this.#live();
    const fresh = await this.#call(() => this.#state.sdk.get({ name: this.id }));
    const hosts = readBackHosts(fresh.networkPolicy, this.#state.firewall);
    const { requested } = this.#state;
    return {
      readRoots: [...requested.readRoots],
      writeRoots: [...requested.writeRoots],
      network: { allow: hosts, deny: [...requested.network.deny] },
    };
  }

  /** Saves the file system and resolves with the id `resume()` starts a new sandbox from. Vercel stops this one. */
  async snapshot(): Promise<string> {
    this.#live();
    const saved = await this.#call(() => this.#state.vm.snapshot());
    return `snapshot:${saved.snapshotId}`;
  }

  /** Stops the sandbox's session. Its files are kept, because the backend made it persistent. */
  async pause(): Promise<void> {
    this.#live();
    if (!this.#state.persistent) throw new SandboxUnsupportedError("pause", "microvm");
    await this.#call(() => this.#state.vm.stop());
  }

  /** Ends every running command, stops the sandbox and deletes it. Every call gets the first call's promise. */
  dispose(): Promise<void> {
    if (this.#disposing === undefined) {
      this.#disposed = true;
      this.#disposing = this.#shutDown();
    }
    return this.#disposing;
  }

  async #shutDown(): Promise<void> {
    for (const running of [...this.#running]) running.cancel();
    await Promise.allSettled([...this.#kills]);
    const { vm } = this.#state;
    // A stopped sandbox can't stop again, and the delete that follows removes it either way.
    await vm.stop().catch(() => undefined);
    try {
      await vm.delete();
    } catch (error) {
      throw new HarnessError(
        "sandbox_io_failed",
        `the Vercel sandbox ${this.id} could not be deleted, so delete it in the Vercel dashboard`,
        { cause: sanitized(error, this.#secrets) },
      );
    } finally {
      this.#secrets = [];
    }
  }
}
