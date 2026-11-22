/**
 * What the Node-only backends that mount a workspace share: the checks before a command runs, the file calls, and a
 * `dispose()` that every caller waits on. A backend extends it and adds how it starts a command and what it cleans up.
 */
import { HarnessError } from "../errors.js";
import { type HostFiles, workingDirectory } from "./host-files.js";
import { APPLY_STOPS, confirmPolicy } from "./policy.js";
import { checkCommand, checkOptions, type NodeModules } from "./process.js";
import type { ExecOptions, ExecResult, Sandbox, SandboxClient, SandboxPolicy, SandboxStop } from "./types.js";

/** The state a backend's sandbox is built on. */
export interface BackendBase {
  readonly modules: NodeModules;
  /** The workspace's real root. */
  readonly root: string;
  readonly files: HostFiles;
}

/** A sandbox that checks a command the same way, reads and writes files in the host, and disposes once. */
export abstract class BackendSandbox implements Sandbox {
  private disposed = false;
  private disposing: Promise<void> | undefined;
  private applied: readonly SandboxStop[] = [];
  private readonly base: BackendBase;

  protected constructor(base: BackendBase) {
    this.base = base;
  }

  /** Throws `sandbox_disposed` once `dispose()` has been called. */
  protected live(): void {
    if (this.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
  }

  /**
   * Checks a command and its options, and finds its working directory. It returns the real working directory to run in,
   * or the result that settles the call without running anything: a denial for a directory outside the workspace, and
   * exit code 127 for a first word with `=`, which `env` would read as an assignment, as `none` answers a program it
   * can't find.
   */
  protected async prepare(
    command: readonly string[],
    options: ExecOptions,
  ): Promise<{ readonly cwd: string } | ExecResult> {
    this.live();
    checkCommand(command);
    checkOptions(options);
    options.signal.throwIfAborted();
    const located = await workingDirectory(this.base.modules, this.base.root, options);
    if ("denied" in located) return located;
    // The sandbox or the signal may have changed while the folder was checked.
    this.live();
    options.signal.throwIfAborted();
    if (command[0]?.includes("=")) {
      return { exitCode: 127, stdout: "", stderr: `command not found: ${command[0]}\n` };
    }
    return located;
  }

  abstract exec(command: readonly string[], options: ExecOptions): Promise<ExecResult>;

  /** Reads back the policy this sandbox applies, from what the backend wrote or will pass to each command. */
  abstract readBack(): Promise<SandboxPolicy>;

  /** The stops the applied policy delivers, set by `confirm()` when the sandbox is provisioned. */
  get stops(): readonly SandboxStop[] {
    return this.applied;
  }

  /** Reads the policy back and checks it against `requested`, or disposes the sandbox and throws on a difference. */
  async confirm(client: SandboxClient, requested: SandboxPolicy): Promise<void> {
    this.applied = await confirmPolicy(client, this, requested);
  }

  /** Sets the stops a resumed sandbox's confirmed policy delivers, for `resumeSandbox()`. */
  [APPLY_STOPS](stops: readonly SandboxStop[]): void {
    this.applied = stops;
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.live();
    return this.base.files.readFile(path);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.live();
    return this.base.files.writeFile(path, data);
  }

  /** Stops what is running and cleans up. Every call gets the first call's promise, so a second caller waits too. */
  dispose(): Promise<void> {
    if (this.disposing === undefined) {
      this.disposed = true;
      this.disposing = this.shutDown();
    }
    return this.disposing;
  }

  /** Ends the commands still running and removes what the sandbox made. It runs once. */
  protected abstract shutDown(): Promise<void>;
}
