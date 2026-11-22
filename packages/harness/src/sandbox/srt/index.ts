/**
 * `@buildanagent/harness/sandbox/srt`: the OS-tier backend. It runs each command under Anthropic's `srt` sandbox
 * runtime, which uses bubblewrap on Linux and starts a proxy that allows only the policy's hosts. It claims to stop
 * `mistakes` and `exfiltration`, never a `hostile_process`: the kernel is shared with the host, and `srt` is a
 * pre-1.0 beta (as of November 2026). Only Linux is supported, because it is the only platform this backend is tested
 * on. A backend that can't start throws `SandboxUnavailableError` and runs nothing. It is Node-only.
 *
 * The file calls run in the host, not under `srt`: two `srt` processes in one workspace can disturb each other, because
 * each makes and removes empty files there. A path outside the roots is refused by its real path, so a symlink that
 * leads out is refused too, and the opened file is checked again through `/proc`, so a path swapped for a link in
 * between is caught. A hostile process could still win that race, which is why no `hostile_process` stop is claimed.
 */
import { HarnessError, isHarnessError } from "../../errors.js";
import { SandboxDeniedError, SandboxUnavailableError } from "../errors.js";
import { checkCommand, checkOptions, type NodeModules, nodeModules, ProcessRunner } from "../process.js";
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxClient,
  SandboxDenial,
  SandboxPolicy,
  WorkspaceManifest,
} from "../types.js";
import { type SrtSettingsInput, srtSettings } from "./settings.js";

export type { SrtPathEntry, SrtSettings, SrtSettingsInput } from "./settings.js";
export { srtSettings } from "./settings.js";

/** The options of `srtSandbox()`. */
export interface SrtSandboxOptions {
  /**
   * The `srt` executable. Without it the backend runs the `srt` that the installed `@anthropic-ai/sandbox-runtime`
   * package ships, with this process's Node. A binary from elsewhere must have its own install folder in
   * `extraReadRoots`, because `srt` reads its helper program from there inside the sandbox.
   */
  readonly binary?: string;
  /** Folders to read besides the policy's roots and the system's, such as the folder a toolchain is installed in. */
  readonly extraReadRoots?: readonly string[];
  /** Folders that stay read-only even inside a write root, such as the session's own log folder. */
  readonly denyWrite?: readonly string[];
  /** An upstream HTTP proxy that the allowed traffic goes through, for a host that sits behind one. */
  readonly parentProxy?: { readonly http?: string; readonly https?: string };
}

/** The system folders a program needs to start. Each one that exists is readable, and nothing else outside the roots. */
export const SRT_SYSTEM_READ_ROOTS: readonly string[] = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/etc",
];

/**
 * The variables `srt` 0.0.83 adds to a command's environment, which are its proxy settings and the few that go with
 * them. A command sees these besides the variables it was given, so a test that compares environments lists them.
 */
export const SRT_ADDED_ENVIRONMENT: readonly string[] = [
  "ALL_PROXY",
  "CLAUDE_CODE_HOST_HTTP_PROXY_PORT",
  "CLAUDE_CODE_HOST_SOCKS_PROXY_PORT",
  "CLOUDSDK_PROXY_ADDRESS",
  "CLOUDSDK_PROXY_PASSWORD",
  "CLOUDSDK_PROXY_PORT",
  "CLOUDSDK_PROXY_TYPE",
  "CLOUDSDK_PROXY_USERNAME",
  "DOCKER_HTTPS_PROXY",
  "DOCKER_HTTP_PROXY",
  "FTP_PROXY",
  "GIT_CONFIG_PARAMETERS",
  "GIT_SSH_COMMAND",
  "GRPC_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "JAVA_TOOL_OPTIONS",
  "NO_PROXY",
  "RSYNC_PROXY",
  "SANDBOX_RUNTIME",
  "all_proxy",
  "ftp_proxy",
  "grpc_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

/** The programs `srt` runs on Linux, which it finds on the `PATH`. */
const REQUIRED_PROGRAMS = ["bwrap", "socat"] as const;
// The most bytes a file call reads or writes, because the whole file is held in memory.
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 20_000;
// How long `srt` has to clean up after a `SIGTERM` before the command's whole group is killed.
const GRACE_MS = 2000;
// The `PATH` `srt` runs with when the host has none.
const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";

/** The program and leading arguments that start `srt`. */
interface SrtCommand {
  readonly program: string;
  readonly args: readonly string[];
  /** The folders `srt` reads inside the sandbox, as absolute paths. */
  readonly readRoots: readonly string[];
}

/** Whether `path` is inside `root`, or is `root`. Both are absolute, with symlinks resolved. */
function inside(modules: NodeModules, root: string, path: string): boolean {
  const relative = modules.path.relative(root, path);
  const climbs = relative === ".." || relative.startsWith(`..${modules.path.sep}`);
  return relative === "" || (!climbs && !modules.path.isAbsolute(relative));
}

/** The real path of `path`, or `path` itself when it doesn't exist. */
async function realOrSelf(modules: NodeModules, path: string): Promise<string> {
  return modules.fs.realpath(path).catch(() => path);
}

/**
 * The real path of `path`, which may not exist: the real path of its deepest folder that does, then the rest as written.
 * A symlink on the way is followed, so a link that points out of a root shows as outside it.
 */
async function realPathOfMissing(modules: NodeModules, path: string): Promise<string> {
  const rest: string[] = [];
  let at = path;
  for (;;) {
    try {
      return modules.path.join(await modules.fs.realpath(at), ...rest);
    } catch {
      const parent = modules.path.dirname(at);
      if (parent === at) return path;
      rest.unshift(modules.path.basename(at));
      at = parent;
    }
  }
}

/** The paths that exist, without repeats. */
async function existing(modules: NodeModules, paths: readonly string[]): Promise<string[]> {
  const present = await Promise.all(
    paths.map((path) =>
      modules.fs.access(path).then(
        () => path,
        () => undefined,
      ),
    ),
  );
  return [...new Set(present.filter((path): path is string => path !== undefined))];
}

/** The first folder of `hostPath` that holds an executable called `name`, or `undefined`. */
async function findOnPath(modules: NodeModules, hostPath: string, name: string): Promise<string | undefined> {
  const folders = hostPath.split(modules.path.delimiter).filter((folder) => folder !== "");
  for (const folder of folders) {
    const candidate = modules.path.join(folder, name);
    try {
      await modules.fs.access(candidate, modules.fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this folder.
    }
  }
  return undefined;
}

/** How to start `srt`, or a `SandboxUnavailableError` when there is nothing to start. */
async function srtCommand(modules: NodeModules, binary: string | undefined): Promise<SrtCommand> {
  if (binary !== undefined) {
    try {
      await modules.fs.access(binary, modules.fs.constants.X_OK);
    } catch (error) {
      throw new SandboxUnavailableError("srt", `${binary} is not an executable file`, { cause: error });
    }
    return { program: binary, args: [], readRoots: [] };
  }
  let cli: string;
  try {
    const url = import.meta.resolve("@anthropic-ai/sandbox-runtime/dist/cli.js");
    cli = await modules.fs.realpath(modules.url.fileURLToPath(url));
  } catch (error) {
    throw new SandboxUnavailableError("srt", "the @anthropic-ai/sandbox-runtime package is not installed", {
      cause: error,
    });
  }
  // `srt` runs its seccomp helper from the package's own folder, inside the sandbox.
  return { program: process.execPath, args: [cli], readRoots: [modules.path.resolve(cli, "..", "..", "vendor")] };
}

/** A `SandboxUnavailableError` unless this platform and host can run `srt`, looking for its programs on `hostPath`. */
async function checkHost(modules: NodeModules, hostPath: string): Promise<void> {
  if (process.platform !== "linux") {
    throw new SandboxUnavailableError(
      "srt",
      `only Linux is supported, because it is the only platform this backend is tested on, and this is ${process.platform}`,
    );
  }
  for (const program of REQUIRED_PROGRAMS) {
    if ((await findOnPath(modules, hostPath, program)) === undefined) {
      throw new SandboxUnavailableError("srt", `${program} is not on the PATH, and srt needs it on Linux`);
    }
  }
}

/** Throws unless every path is absolute, and not `/` where `allowRoot` is false. */
function checkPaths(modules: NodeModules, paths: readonly string[], what: string): void {
  for (const path of paths) {
    if (!modules.path.isAbsolute(path) || modules.path.resolve(path) === "/") {
      throw new HarnessError(
        "invalid_sandbox_options",
        `${what} must be an absolute path other than /, not ${JSON.stringify(path)}`,
      );
    }
  }
}

// What `srt` keeps read-only inside the workspace, which the file calls keep read-only too: the shell start-up files,
// the editor and agent settings, and a repository's hooks and config.
const PROTECTED_PATHS =
  /^(\.bash_profile|\.bashrc|\.zshrc|\.zprofile|\.profile|\.gitconfig|\.gitmodules|\.ripgreprc|\.mcp\.json|\.vscode|\.idea|\.claude)(\/|$)|(^|\/)\.git\/(hooks|config)(\/|$)/;
// A variable name that `env` can set, which is every name a process can be given.
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The real roots a sandbox enforces on file calls. */
interface RealRoots {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly denyWrite: readonly string[];
}

/** Everything a provisioned sandbox holds. */
interface SrtSandboxState {
  readonly modules: NodeModules;
  readonly command: SrtCommand;
  readonly root: string;
  readonly roots: RealRoots;
  /** A private folder that holds the settings file and the run folder, and is removed on dispose. */
  readonly folder: string;
  /** The folder `srt` makes its proxy sockets in, and the only part of `folder` a command may read. */
  readonly runFolder: string;
  readonly settingsFile: string;
  /** The `PATH` that `srt` itself runs with, which finds `bwrap` and `socat`. */
  readonly hostPath: string;
}

class SrtSandbox implements Sandbox {
  private disposed = false;
  private readonly runner: ProcessRunner;
  private readonly state: SrtSandboxState;

  constructor(state: SrtSandboxState) {
    this.state = state;
    this.runner = new ProcessRunner(state.modules);
  }

  private live(): void {
    if (this.disposed) throw new HarnessError("sandbox_disposed", "the sandbox was disposed");
  }

  /** The program that starts `srt`. */
  get program(): string {
    return this.state.command.program;
  }

  /** The arguments that start `srt` with this sandbox's settings, then run `inner`. */
  srtArguments(inner: readonly string[]): string[] {
    return [...this.state.command.args, "--settings", this.state.settingsFile, "--", ...inner];
  }

  /** The environment `srt` itself runs with: where to find its programs, and where to make its sockets. Nothing else. */
  launchEnvironment(): Record<string, string> {
    return { PATH: this.state.hostPath, TMPDIR: this.state.runFolder };
  }

  /**
   * The command that runs inside `srt`. `env` sets the command's whole environment from `srt`'s own, so a variable that
   * makes a program load code, such as `NODE_OPTIONS`, never reaches `srt` or the programs it starts outside the
   * sandbox. The `--` ends `env`'s options, so a first word that starts with `-` is a program name.
   */
  private innerCommand(command: readonly string[], env: Readonly<Record<string, string>>): string[] {
    const unset: string[] = [];
    for (const name of ["PATH", "TMPDIR"]) {
      if (!(name in env)) unset.push("-u", name);
    }
    const assignments: string[] = [];
    for (const [name, value] of Object.entries(env)) {
      if (!VARIABLE_NAME.test(name)) {
        throw new HarnessError("invalid_sandbox_options", `${JSON.stringify(name)} is not a variable name`);
      }
      assignments.push(`${name}=${value}`);
    }
    return ["/usr/bin/env", ...unset, "--", ...assignments, ...command];
  }

  /** Runs `command` under `srt` in `cwd`, with `env` as its whole environment. */
  private runUnderSrt(
    command: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string>>,
    options: ExecOptions,
  ) {
    return this.runner.run(
      {
        program: this.state.command.program,
        args: this.srtArguments(this.innerCommand(command, env)),
        cwd,
        env: this.launchEnvironment(),
        missingProgram: "reject",
        graceMs: GRACE_MS,
      },
      options,
    );
  }

  /** The real path of `path` against the workspace, or a denial when it is outside every one of `roots`. */
  private async contain(
    path: string,
    roots: readonly string[],
    kind: SandboxDenial["kind"],
    rule: string,
  ): Promise<string> {
    const { modules } = this.state;
    const real = await realPathOfMissing(modules, modules.path.resolve(this.state.root, path));
    if (roots.some((root) => inside(modules, root, real))) return real;
    throw new SandboxDeniedError({ kind, target: path, reason: rule });
  }

  /** Throws a denial when `real` is a path that stays read-only: a `denyWrite` folder or one `srt` protects. */
  private refuseProtected(real: string, path: string): void {
    const { modules, roots } = this.state;
    const inDenied = roots.denyWrite.some((folder) => inside(modules, folder, real));
    const owner = roots.write.find((root) => inside(modules, root, real));
    const relative = owner === undefined ? "" : modules.path.relative(owner, real);
    if (inDenied || PROTECTED_PATHS.test(relative.split(modules.path.sep).join("/"))) {
      throw new SandboxDeniedError({
        kind: "filesystem_write",
        target: path,
        reason: "the path is one the sandbox keeps read-only",
      });
    }
  }

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    this.live();
    checkCommand(command);
    checkOptions(options);
    options.signal.throwIfAborted();
    const { modules, root } = this.state;
    const wanted = modules.path.resolve(root, options.cwd ?? ".");
    const cwd = await realPathOfMissing(modules, wanted);
    if (!inside(modules, root, cwd)) {
      return {
        denied: {
          kind: "filesystem_read",
          target: wanted,
          reason: "the working directory is outside the workspace",
        },
      };
    }
    const stats = await modules.fs.stat(cwd).catch(() => undefined);
    if (!stats?.isDirectory()) {
      throw new HarnessError("invalid_sandbox_options", `the working directory ${cwd} is not an existing folder`);
    }
    // The sandbox or the signal may have changed while the folder was checked.
    this.live();
    options.signal.throwIfAborted();
    // `env` would read a first word with `=` as an assignment, so it is answered as `none` answers a program it can't find.
    if (command[0]?.includes("=")) {
      return { exitCode: 127, stdout: "", stderr: `command not found: ${command[0]}\n` };
    }
    const { stdoutBytes: _bytes, ...result } = await this.runUnderSrt(command, cwd, options.env, options);
    return result;
  }

  /** Throws a denial unless the file that `handle` opened is inside one of `roots`, by its real path in `/proc`. */
  private async checkOpened(
    handle: import("node:fs/promises").FileHandle,
    roots: readonly string[],
    kind: SandboxDenial["kind"],
    path: string,
  ): Promise<string> {
    const { modules } = this.state;
    const opened = await modules.fs.realpath(`/proc/self/fd/${handle.fd}`).catch(() => undefined);
    if (opened === undefined || !roots.some((root) => inside(modules, root, opened))) {
      throw new SandboxDeniedError({ kind, target: path, reason: "the file opened is outside the roots" });
    }
    return opened;
  }

  /** The error for a file call that the OS failed: a denial when it refused, a missing file, or an I/O error. */
  private fileFailure(error: unknown, kind: SandboxDenial["kind"], path: string): unknown {
    if (isHarnessError(error)) return error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return new HarnessError("sandbox_not_found", `no such file: ${path}`, { cause: error });
    if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ELOOP") {
      return new SandboxDeniedError({ kind, target: path, reason: "the OS refused it" });
    }
    return new HarnessError("sandbox_io_failed", `the file call on ${path} failed: ${code ?? String(error)}`, {
      cause: error,
    });
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.live();
    const { modules, roots } = this.state;
    const readable = [...roots.read, ...roots.write];
    const target = await this.contain(path, readable, "filesystem_read", "the path is outside the read roots");
    const { O_RDONLY, O_NOFOLLOW } = modules.fs.constants;
    try {
      const handle = await modules.fs.open(target, O_RDONLY | O_NOFOLLOW);
      try {
        await this.checkOpened(handle, readable, "filesystem_read", path);
        const size = (await handle.stat()).size;
        if (size > MAX_FILE_BYTES) {
          throw new HarnessError("sandbox_io_failed", `the file ${target} is larger than ${MAX_FILE_BYTES} bytes`);
        }
        return new Uint8Array(await handle.readFile());
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw this.fileFailure(error, "filesystem_read", path);
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.live();
    if (data.length > MAX_FILE_BYTES) {
      throw new HarnessError("sandbox_io_failed", `a file larger than ${MAX_FILE_BYTES} bytes can't be written`);
    }
    const { modules, roots } = this.state;
    const rule = "the path is outside the write roots";
    const target = await this.contain(path, roots.write, "filesystem_write", rule);
    this.refuseProtected(target, path);
    const { O_WRONLY, O_CREAT, O_NOFOLLOW } = modules.fs.constants;
    try {
      await modules.fs.mkdir(modules.path.dirname(target), { recursive: true });
      // Opened without O_TRUNC, so a file that turns out to be outside the roots is not emptied before the check.
      const handle = await modules.fs.open(target, O_WRONLY | O_CREAT | O_NOFOLLOW, 0o666);
      try {
        this.refuseProtected(await this.checkOpened(handle, roots.write, "filesystem_write", path), path);
        await handle.truncate(0);
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw this.fileFailure(error, "filesystem_write", path);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.runner.stopAll();
    await this.state.modules.fs.rm(this.state.folder, { recursive: true, force: true });
  }
}

/** The first line of what `srt` printed, for the message of a failed start. */
function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "no output";
}

/** The workspace manifest's root as a real path, or an error when it isn't an existing absolute folder. */
async function workspaceRoot(modules: NodeModules, manifest: WorkspaceManifest): Promise<string> {
  if (!modules.path.isAbsolute(manifest.root)) {
    throw new HarnessError("invalid_sandbox_options", "a workspace manifest's root must be an absolute path");
  }
  const stats = await modules.fs.stat(manifest.root).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new HarnessError("invalid_sandbox_options", "a workspace manifest's root must be an existing folder");
  }
  return modules.fs.realpath(manifest.root);
}

/** The settings and the real roots for one sandbox, with every path's symlinks resolved. */
async function planSandbox(
  modules: NodeModules,
  policy: SandboxPolicy,
  options: SrtSandboxOptions,
  command: SrtCommand,
  runFolder: string,
) {
  const real = (paths: readonly string[]) => Promise.all(paths.map((path) => realOrSelf(modules, path)));
  const [readRoots, writeRoots, extra, denyWrite, helpers] = await Promise.all([
    real(policy.readRoots),
    real(policy.writeRoots),
    real(options.extraReadRoots ?? []),
    real(options.denyWrite ?? []),
    real(command.readRoots),
  ]);
  const input: SrtSettingsInput = {
    policy: { ...policy, readRoots, writeRoots },
    systemReadRoots: await existing(modules, await real(SRT_SYSTEM_READ_ROOTS)),
    // Only the run folder: the settings file beside it holds a proxy address that a command must not read.
    helperReadRoots: [runFolder, ...helpers, ...extra],
    denyWrite,
    ...(options.parentProxy === undefined ? {} : { parentProxy: options.parentProxy }),
  };
  return { settings: srtSettings(input), roots: { read: readRoots, write: writeRoots, denyWrite } };
}

/**
 * Builds the `srt` backend. `provision()` checks the platform, the programs `srt` needs and `srt` itself, by running a
 * command that does nothing, so a host that can't confine a process throws `SandboxUnavailableError` and runs nothing.
 * The policy's roots, `extraReadRoots` and `denyWrite` must be absolute folders other than `/`. Each command runs under
 * its own `srt`, so a command sees the proxy variables `srt` adds to its environment, besides those it was given.
 */
export function srtSandbox(options: SrtSandboxOptions = {}): SandboxClient {
  return {
    tier: "os",
    stops: ["mistakes", "exfiltration"],
    async provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox> {
      const modules = nodeModules("srt");
      const hostPath = process.env.PATH ?? DEFAULT_PATH;
      await checkHost(modules, hostPath);
      const root = await workspaceRoot(modules, manifest);
      checkPaths(modules, [...policy.readRoots, ...policy.writeRoots], "a sandbox root");
      checkPaths(modules, options.extraReadRoots ?? [], "an extra read root");
      checkPaths(modules, options.denyWrite ?? [], "a denyWrite folder");
      const command = await srtCommand(modules, options.binary);
      const folder = await modules.fs.mkdtemp(modules.path.join(modules.os.tmpdir(), "harness-srt-"));
      try {
        await modules.fs.chmod(folder, 0o700);
        const runFolder = modules.path.join(folder, "run");
        await modules.fs.mkdir(runFolder, { mode: 0o700 });
        const plan = await planSandbox(modules, policy, options, command, runFolder);
        const settingsFile = modules.path.join(folder, "settings.json");
        await modules.fs.writeFile(settingsFile, JSON.stringify(plan.settings), { mode: 0o600 });
        const sandbox = new SrtSandbox({
          modules,
          command,
          root,
          roots: plan.roots,
          folder,
          runFolder,
          settingsFile,
          hostPath,
        });
        await probe(modules, sandbox, root);
        const encoder = new TextEncoder();
        for (const [path, data] of Object.entries(manifest.files ?? {})) {
          await sandbox.writeFile(path, typeof data === "string" ? encoder.encode(data) : data);
        }
        return sandbox;
      } catch (error) {
        await modules.fs.rm(folder, { recursive: true, force: true });
        throw error;
      }
    },
  };
}

/** Starts `srt` once with a command that does nothing, and throws `SandboxUnavailableError` when it can't. */
async function probe(modules: NodeModules, sandbox: SrtSandbox, root: string): Promise<void> {
  const runner = new ProcessRunner(modules);
  const result = await runner
    .run(
      {
        program: sandbox.program,
        args: sandbox.srtArguments(["/usr/bin/true"]),
        cwd: root,
        env: sandbox.launchEnvironment(),
        missingProgram: "reject",
        graceMs: GRACE_MS,
      },
      { env: {}, signal: new AbortController().signal, timeoutMs: PROBE_TIMEOUT_MS },
    )
    .catch((error: unknown) => {
      throw new SandboxUnavailableError("srt", "it could not be started", { cause: error });
    });
  if (result.exitCode !== 0) {
    throw new SandboxUnavailableError("srt", `it did not start a command: ${firstLine(result.stderr)}`);
  }
}
