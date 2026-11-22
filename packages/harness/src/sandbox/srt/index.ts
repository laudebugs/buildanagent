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
import { HarnessError } from "../../errors.js";
import { BackendSandbox } from "../base.js";
import { SandboxUnavailableError } from "../errors.js";
import {
  absolutePath,
  checkPaths,
  existing,
  findOnPath,
  HostFiles,
  isProtectedPath,
  realOrSelf,
  spellings,
  workspaceRoot,
} from "../host-files.js";
import { type NodeModules, nodeModules, ProcessRunner } from "../process.js";
import type { ExecOptions, ExecResult, Sandbox, SandboxClient, SandboxPolicy, WorkspaceManifest } from "../types.js";
import { type SrtPolicyNames, type SrtSettingsInput, srtPolicyFromSettings, srtSettings } from "./settings.js";

export type { SrtPathEntry, SrtPolicyNames, SrtSettings, SrtSettingsInput } from "./settings.js";
export { srtPolicyFromSettings, srtSettings } from "./settings.js";

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
const PROBE_TIMEOUT_MS = 20_000;
// How long `srt` has to clean up after a `SIGTERM` before the command's whole group is killed.
const GRACE_MS = 2000;

/** The program and leading arguments that start `srt`. */
interface SrtCommand {
  readonly program: string;
  readonly args: readonly string[];
  /** The folders `srt` reads inside the sandbox, as absolute paths. */
  readonly readRoots: readonly string[];
}

/** How to start `srt`, or a `SandboxUnavailableError` when there is nothing to start. */
async function srtCommand(modules: NodeModules, binary: string | undefined): Promise<SrtCommand> {
  if (binary !== undefined) {
    // Resolved once against this process's folder, because it is started from the workspace.
    const program = modules.path.resolve(binary);
    try {
      await modules.fs.access(program, modules.fs.constants.X_OK);
    } catch (error) {
      throw new SandboxUnavailableError("srt", `${binary} is not an executable file`, { cause: error });
    }
    return { program, args: [], readRoots: [] };
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

// A variable name that `env` can set, which is every name a process can be given.
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Everything a provisioned sandbox holds. */
interface SrtSandboxState {
  readonly modules: NodeModules;
  readonly command: SrtCommand;
  readonly root: string;
  readonly files: HostFiles;
  /** A private folder that holds the settings file and the run folder, and is removed on dispose. */
  readonly folder: string;
  /** The folder `srt` makes its proxy sockets in, and the only part of `folder` a command may read. */
  readonly runFolder: string;
  readonly settingsFile: string;
  /** The `PATH` that `srt` itself runs with, which finds `bwrap` and `socat`. */
  readonly hostPath: string;
  /** How the settings file's real paths map back to the request's spelling, for the read-back. */
  readonly names: SrtPolicyNames;
}

class SrtSandbox extends BackendSandbox {
  private readonly runner: ProcessRunner;
  private readonly state: SrtSandboxState;

  constructor(state: SrtSandboxState) {
    super(state);
    this.state = state;
    this.runner = new ProcessRunner(state.modules);
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

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    const prepared = await this.prepare(command, options);
    if (!("cwd" in prepared)) return prepared;
    const { stdoutBytes: _bytes, ...result } = await this.runUnderSrt(command, prepared.cwd, options.env, options);
    return result;
  }

  /** Reads the settings file `srt` is started with, as it is on disk now, and maps it back to a policy. */
  async readBack(): Promise<SandboxPolicy> {
    this.live();
    const text = await this.state.modules.fs.readFile(this.state.settingsFile, "utf8");
    return srtPolicyFromSettings(JSON.parse(text) as unknown, this.state.names);
  }

  protected async shutDown(): Promise<void> {
    await this.runner.stopAll();
    await this.state.modules.fs.rm(this.state.folder, { recursive: true, force: true });
  }
}

/** The first line of what `srt` printed, for the message of a failed start. */
function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "no output";
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
  const systemReadRoots = await existing(modules, await real(SRT_SYSTEM_READ_ROOTS));
  // Only the run folder: the settings file beside it holds a proxy address that a command must not read.
  const helperReadRoots = [runFolder, ...helpers, ...extra];
  const input: SrtSettingsInput = {
    policy: { ...policy, readRoots, writeRoots },
    systemReadRoots,
    helperReadRoots,
    denyWrite,
    ...(options.parentProxy === undefined ? {} : { parentProxy: options.parentProxy }),
  };
  const names: SrtPolicyNames = {
    read: spellings(readRoots, policy.readRoots),
    write: spellings(writeRoots, policy.writeRoots),
    implicitReads: [...systemReadRoots, ...helperReadRoots],
  };
  return { settings: srtSettings(input), roots: { read: readRoots, write: writeRoots, denyWrite }, names };
}

/**
 * Builds the `srt` backend. `provision()` checks the platform, the programs `srt` needs and `srt` itself, by running a
 * command that does nothing, so a host that can't confine a process throws `SandboxUnavailableError` and runs nothing.
 * The policy's roots, `extraReadRoots` and `denyWrite` must be absolute folders other than `/`. Each command runs under
 * its own `srt`, so a command sees the proxy variables `srt` adds to its environment, besides those it was given.
 */
export function srtSandbox(options: SrtSandboxOptions = {}): SandboxClient {
  const client: SandboxClient = {
    tier: "os",
    stops: ["mistakes", "exfiltration"],
    async provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox> {
      const modules = nodeModules("srt");
      const hostPath = absolutePath(modules, process.env.PATH);
      await checkHost(modules, hostPath);
      const root = await workspaceRoot(modules, manifest.root);
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
          files: new HostFiles(modules, root, plan.roots, isProtectedPath),
          folder,
          runFolder,
          settingsFile,
          hostPath,
          names: plan.names,
        });
        await probe(modules, sandbox, root);
        await sandbox.confirm(client, policy);
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
  return client;
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
