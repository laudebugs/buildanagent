/**
 * `noneSandbox()`: the backend that confines nothing. It runs a command as the host's own user with the environment it
 * is given, and it stops no mistake, no exfiltration and no hostile process, so its `stops` is empty and it refuses to
 * be built without `unsafe: true` (HD4, ADR 0020). It exists for a machine that is already disposable and for tests of
 * the rest of the harness. It is Node-only: it loads Node's modules by `process.getBuiltinModule()` when it is used.
 * It starts each command in its own process group, so a timeout, an abort or a dispose ends the command's whole tree.
 */
import { HarnessError } from "../errors.js";
import { checkCommand, checkOptions, type NodeModules, nodeModules, ProcessRunner } from "./process.js";
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

class NoneSandbox implements Sandbox {
  private disposed = false;
  private readonly root: string;
  private readonly modules: NodeModules;
  private readonly runner: ProcessRunner;

  constructor(root: string, modules: NodeModules) {
    this.root = root;
    this.modules = modules;
    this.runner = new ProcessRunner(modules);
  }

  private live(): void {
    if (this.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
  }

  private resolve(path: string): string {
    return this.modules.path.resolve(this.root, path);
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
    checkOptions(options);
    options.signal.throwIfAborted();
    const cwd = await this.workingDirectory(options);
    // The sandbox or the signal may have changed while the folder was checked.
    this.live();
    options.signal.throwIfAborted();
    const [program, ...args] = command as [string, ...string[]];
    const { stdoutBytes: _bytes, ...result } = await this.runner.run(
      { program, args, cwd, env: options.env, missingProgram: "result" },
      options,
    );
    return result;
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.live();
    const target = this.resolve(path);
    try {
      return new Uint8Array(await this.modules.fs.readFile(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HarnessError("sandbox_not_found", `no such file: ${target}`, { cause: error });
      }
      throw error;
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.live();
    const target = this.resolve(path);
    await this.modules.fs.mkdir(this.modules.path.dirname(target), { recursive: true });
    await this.modules.fs.writeFile(target, data);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.runner.stopAll();
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
      const modules = nodeModules("none");
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
