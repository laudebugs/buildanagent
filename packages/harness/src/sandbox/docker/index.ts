/**
 * `@buildanagent/harness/sandbox/docker`: the container-tier backend. Each command runs in its own locked-down
 * container: all capabilities dropped, a read-only root file system, no network, no new privileges, and limits on
 * processes, CPUs and memory. Only the policy's write roots are writable, and only the policy's roots are mounted. It
 * claims `mistakes` and `exfiltration`, never a `hostile_process`: the kernel is shared with the host. Only Linux and a
 * rootful daemon are tested. A backend that can't start throws `SandboxUnavailableError` and runs nothing. It is
 * Node-only.
 *
 * The container has no network, so a command reaches a host only through a proxy socket the caller mounts. The file calls
 * run in the host on the mounted folders, checked by their real path.
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
  inside,
  isProtectedPath,
  PROTECTED_TOP_LEVEL,
  realOrSelf,
  spellings,
  workspaceRoot,
} from "../host-files.js";
import { type NodeModules, nodeModules, type ProcessResult, ProcessRunner } from "../process.js";
import type { ExecOptions, ExecResult, Sandbox, SandboxClient, SandboxPolicy, WorkspaceManifest } from "../types.js";

/** The options of `dockerSandbox()`. */
export interface DockerSandboxOptions {
  /** The image to run, which must already be on the Docker host: `provision()` never pulls. Pin it by digest. */
  readonly image: string;
  /** CPUs a command may use. Defaults to 1. */
  readonly cpus?: number;
  /** Megabytes of memory a command may use, with no swap. Defaults to 1024. */
  readonly memoryMb?: number;
  /** Processes a command may start. Defaults to 256. */
  readonly pidsLimit?: number;
  /** The `docker` executable. Without it the backend finds `docker` on the absolute folders of the host's `PATH`. */
  readonly binary?: string;
  /** The Docker daemon's address. Without it the backend passes the host's `DOCKER_HOST` when it is set. */
  readonly dockerHost?: string;
  /** The user and group a command runs as, as `uid:gid`. Defaults to this process's, so its files stay yours. */
  readonly user?: string;
  /** Folders to read besides the policy's roots, mounted read-only. */
  readonly extraReadRoots?: readonly string[];
  /** Folders that stay read-only inside a write root, such as the session's own log folder. */
  readonly denyWrite?: readonly string[];
  /**
   * A Unix socket on the host that a command may use to reach the hosts its policy allows, mounted at
   * `DOCKER_PROXY_SOCKET_PATH`. The proxy on it enforces the allowlist, so start `startEgressProxy()` there with the
   * policy's hosts, such as from `compileEgressPolicy()`; the read-back trusts it to.
   */
  readonly proxySocket?: string;
}

/** Where a command finds the proxy socket, when the caller mounts one. */
export const DOCKER_PROXY_SOCKET_PATH = "/run/harness/proxy.sock";

const DEFAULTS = { cpus: 1, memoryMb: 1024, pidsLimit: 256 } as const;
const DAEMON_TIMEOUT_MS = 20_000;
// The longest one call that kills or removes a container may take.
const CALL_TIMEOUT_MS = 5000;
// Creating a container copies the image on some storage drivers, which can take a while.
const CREATE_TIMEOUT_MS = 120_000;
// How long a stopped `docker run` client has to leave on its own, which lets it cancel a container that isn't started yet.
const GRACE_MS = 3000;
const KILL_ATTEMPTS = 5;
const KILL_RETRY_MS = 100;
const SWEEP_QUIET_PASSES = 2;
// The longest the sweep at the end waits for the last container to go.
const SWEEP_MAX_MS = 20_000;
const SWEEP_PAUSE_MS = 200;
// A variable name that `env` can set, which is every name a process can be given.
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A path in a `--mount` value can't hold a comma or a quote, which that syntax reads as separators.
const MOUNTABLE = /^[^,"\n\r]+$/;

/** One bind mount: the real host path, mounted at the same path inside, or at `to`. */
interface Mount {
  readonly from: string;
  readonly to: string;
  readonly readOnly: boolean;
}

/** Everything a provisioned sandbox holds. */
interface DockerState {
  readonly modules: NodeModules;
  readonly docker: string;
  readonly image: string;
  readonly root: string;
  readonly files: HostFiles;
  readonly mounts: readonly Mount[];
  readonly flags: readonly string[];
  /** The environment the `docker` client runs with: where to find its programs, and a private empty `HOME`. */
  readonly clientEnv: Readonly<Record<string, string>>;
  /** A private folder that holds the client's `HOME`, removed on dispose. */
  readonly folder: string;
  /** Marks this sandbox's containers, so `dispose()` can find any that a stopped client left behind. */
  readonly label: string;
  /** What the read-back needs to map the mounts back to the request's spelling. */
  readonly names: DockerPolicyNames;
}

/** How the mounts map back to the request, for the read-back. */
interface DockerPolicyNames {
  readonly requested: SandboxPolicy;
  /** The real path of each requested read root, in the request's order. */
  readonly readReal: readonly string[];
  /** For each real write root, the request's spellings that resolved to it. */
  readonly write: ReadonlyMap<string, readonly string[]>;
  /** Requested read roots that don't exist, which have nothing to mount and nothing to read. */
  readonly missing: ReadonlySet<string>;
  /** Read-only mounts the backend adds itself: the extra read roots, the denyWrite folders and the protected files. */
  readonly implicit: ReadonlySet<string>;
}

const mountFlags = (mount: Mount): string[] => [
  "--mount",
  `type=bind,src=${mount.from},dst=${mount.to}${mount.readOnly ? ",readonly" : ""}`,
];

class DockerSandbox extends BackendSandbox {
  private started = 0;
  // Whether a creation was left to finish in the background, which a sweep at the end has to catch.
  private abandoned = false;
  // The containers being created, which `dispose()` waits for before it sweeps.
  private readonly pending = new Set<Promise<unknown>>();
  private readonly runner: ProcessRunner;
  // Runs the calls that manage containers, which `dispose()` must not cut short: a `create` that is stopped half way
  // leaves a container behind.
  private readonly manager: ProcessRunner;
  private readonly state: DockerState;

  constructor(state: DockerState) {
    super(state);
    this.state = state;
    this.runner = new ProcessRunner(state.modules);
    this.manager = new ProcessRunner(state.modules);
  }

  /** Runs the `docker` client with `args` and waits for it, for the calls that manage containers. */
  async client(args: readonly string[], timeoutMs: number) {
    return this.manager.run(
      {
        program: this.state.docker,
        args,
        cwd: this.state.root,
        env: this.state.clientEnv,
        missingProgram: "reject",
      },
      { env: {}, signal: new AbortController().signal, timeoutMs },
    );
  }

  /** The `docker run` arguments for one command in a container called `name`. */
  private runArguments(name: string, cwd: string, command: readonly string[], env: Readonly<Record<string, string>>) {
    const assignments: string[] = [];
    for (const [variable, value] of Object.entries(env)) {
      if (!VARIABLE_NAME.test(variable)) {
        throw new HarnessError("invalid_sandbox_options", `${JSON.stringify(variable)} is not a variable name`);
      }
      assignments.push(`${variable}=${value}`);
    }
    const { state } = this;
    // `env -i` clears the image's own variables, so the command holds exactly the ones it was given.
    return [
      "create",
      "--rm",
      "--name",
      name,
      "--label",
      state.label,
      ...state.flags,
      ...state.mounts.flatMap(mountFlags),
      "--workdir",
      cwd,
      "--entrypoint",
      "env",
      state.image,
      "-i",
      // Ends `env`'s options, so a first word that starts with `-` is a program name.
      "--",
      ...assignments,
      ...command,
    ];
  }

  /** Removes the container if it exists, which is all a container that never started needs. */
  private async removeContainer(name: string): Promise<void> {
    await this.client(["rm", "--force", name], CALL_TIMEOUT_MS).catch(() => undefined);
  }

  /** Kills the container, trying again while the daemon is still creating it, and removes what is left. */
  private async killContainer(name: string): Promise<void> {
    for (let attempt = 0; attempt < KILL_ATTEMPTS; attempt += 1) {
      const result = await this.client(["kill", name], CALL_TIMEOUT_MS).catch(() => undefined);
      if (result?.exitCode === 0) break;
      await new Promise((resolve) => setTimeout(resolve, KILL_RETRY_MS));
    }
    await this.removeContainer(name);
  }

  async exec(command: readonly string[], options: ExecOptions): Promise<ExecResult> {
    const prepared = await this.prepare(command, options);
    if (!("cwd" in prepared)) return prepared;
    const located = prepared;
    const { root } = this.state;
    this.started += 1;
    const name = `${this.state.label.split("=")[1]}-${this.started}`;
    const started = Date.now();
    // The container is created first and started after, so a stop never leaves a client half way through creating one.
    const created = this.client(this.runArguments(name, located.cwd, command, options.env), CREATE_TIMEOUT_MS);
    this.track(created);
    const made = await this.untilStopped(name, created, options);
    if ("expired" in made) return made.expired;
    if (made.exitCode !== 0) {
      await this.removeContainer(name);
      return { exitCode: made.exitCode, stdout: "", stderr: made.stderr };
    }
    try {
      this.live();
      options.signal.throwIfAborted();
    } catch (error) {
      await this.killContainer(name);
      throw error;
    }
    const remaining =
      options.timeoutMs === undefined ? {} : { timeoutMs: Math.max(1, options.timeoutMs - (Date.now() - started)) };
    const { stdoutBytes: _bytes, ...result } = await this.runner.run(
      {
        program: this.state.docker,
        args: ["start", "--attach", name],
        cwd: root,
        env: this.state.clientEnv,
        missingProgram: "reject",
        onStop: () => this.killContainer(name),
        graceMs: GRACE_MS,
      },
      { ...options, ...remaining },
    );
    return result;
  }

  /** Keeps `work` in the set that `dispose()` waits for, until it settles. */
  private track(work: Promise<unknown>): void {
    const tracked = work.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(tracked);
    void tracked.then(() => this.pending.delete(tracked));
  }

  /**
   * Waits for a container to be created, but settles the call when the caller's signal aborts or its timeout passes. The
   * creation can't be cut short without leaving a container behind, so it carries on in the background, and the container
   * is removed when it ends.
   */
  private untilStopped(
    name: string,
    created: Promise<ProcessResult>,
    options: ExecOptions,
  ): Promise<ProcessResult | { readonly expired: ExecResult }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (settle: () => void, discard: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal.removeEventListener("abort", onAbort);
        if (discard) {
          this.abandoned = true;
          this.track(created.then(() => this.killContainer(name)));
        }
        settle();
      };
      const onAbort = () => finish(() => reject(options.signal.reason), true);
      options.signal.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        const note = `timed out after ${options.timeoutMs} ms\n`;
        timer = setTimeout(
          () => finish(() => resolve({ expired: { exitCode: 124, stdout: "", stderr: note, timedOut: true } }), true),
          options.timeoutMs,
        );
      }
      created.then(
        (result) => finish(() => resolve(result), false),
        (error: unknown) => finish(() => reject(error), false),
      );
    });
  }

  /**
   * Removes every container of this sandbox until none is left. A client stopped while the daemon was creating its
   * container can leave one behind, and a removal can take a while on a slow storage driver, so it waits for the last to go.
   * With no creation left in the background, an empty first pass ends it.
   */
  private async sweep(): Promise<void> {
    const deadline = Date.now() + SWEEP_MAX_MS;
    let quiet = 0;
    for (;;) {
      const left = await this.client(
        ["ps", "--all", "--quiet", "--filter", `label=${this.state.label}`],
        DAEMON_TIMEOUT_MS,
      )
        .then((result) => result.stdout.split("\n").filter((id) => id !== ""))
        .catch(() => []);
      quiet = left.length === 0 ? quiet + 1 : 0;
      if (left.length > 0) await this.client(["rm", "--force", ...left], DAEMON_TIMEOUT_MS).catch(() => undefined);
      if ((left.length === 0 && (!this.abandoned || quiet >= SWEEP_QUIET_PASSES)) || Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, SWEEP_PAUSE_MS));
    }
  }

  /**
   * The policy the mounts and flags apply, which are what every command's container is created with. The network is
   * closed unless the caller mounted a proxy socket, and then the proxy on it enforces the requested allowlist. A
   * read-only mount the request doesn't explain reads back as a read root it didn't ask for.
   *
   * One narrowing is not caught: a write root that the caller's `denyWrite` names exactly is mounted read-only but still
   * reads back as a write root, because the read-back takes the caller's own `denyWrite` as part of the request. So
   * `provision()` accepts it, and nothing in that root is writable inside the container.
   */
  async readBack(): Promise<SandboxPolicy> {
    this.live();
    const { mounts, names, flags } = this.state;
    const own = mounts.filter((mount) => mount.to !== DOCKER_PROXY_SOCKET_PATH);
    // A write root that the caller's own denyWrite made read-only is still the root the request asked for.
    const granted = (mount: Mount) =>
      !mount.readOnly || (names.implicit.has(mount.from) && names.write.has(mount.from));
    const writable = own.filter(granted).map((mount) => mount.from);
    const inWritable = (path: string) => writable.some((root) => inside(this.state.modules, root, path));
    const readable = (real: string) => names.missing.has(real) || inWritable(real) || own.some((m) => m.from === real);
    const unexplained = own
      .filter((mount) => mount.readOnly && !names.readReal.includes(mount.from))
      .map((mount) => mount.from)
      .filter((from) => !names.implicit.has(from) && !inWritable(from));
    const closed = flags.join(" ").includes("--network none");
    const proxied = mounts.length !== own.length;
    return {
      readRoots: [
        ...names.requested.readRoots.filter((_, index) => readable(names.readReal[index] ?? "")),
        ...unexplained,
      ],
      writeRoots: writable.flatMap((path) => names.write.get(path) ?? [path]),
      network: !closed
        ? { allow: ["*"], deny: [] }
        : proxied
          ? names.requested.network
          : { allow: [], deny: names.requested.network.deny },
    };
  }

  protected async shutDown(): Promise<void> {
    await this.runner.stopAll();
    await Promise.allSettled([...this.pending]);
    await this.sweep();
    await this.state.modules.fs.rm(this.state.folder, { recursive: true, force: true });
  }
}

/** Throws unless `image` is a name `docker run` takes as an image and not as an option. */
function checkOptionValues(options: DockerSandboxOptions): void {
  const { image, cpus, memoryMb, pidsLimit, user } = options;
  if (typeof image !== "string" || image === "" || /\s/.test(image) || image.startsWith("-")) {
    throw new HarnessError(
      "invalid_sandbox_options",
      "dockerSandbox needs an image name, such as one pinned by digest",
    );
  }
  const bad = (what: string) => new HarnessError("invalid_sandbox_options", `${what} is not usable`);
  if (cpus !== undefined && !(Number.isFinite(cpus) && cpus > 0)) throw bad("cpus");
  if (memoryMb !== undefined && !(Number.isInteger(memoryMb) && memoryMb >= 6)) throw bad("memoryMb");
  if (pidsLimit !== undefined && !(Number.isInteger(pidsLimit) && pidsLimit >= 1)) throw bad("pidsLimit");
  if (user !== undefined && !/^[0-9]+(:[0-9]+)?$/.test(user)) throw bad("user");
}

/** The sockets a Docker client may use: the default ones, and the one `dockerHost` names when it is a Unix socket. */
function daemonSockets(dockerHost: string | undefined): string[] {
  const named = dockerHost?.startsWith("unix://") ? [dockerHost.slice("unix://".length)] : [];
  return ["/var/run/docker.sock", "/run/docker.sock", ...named];
}

/** Throws unless every source is mountable, and none is `/` or holds a Docker daemon socket, which would hand over the host. */
async function checkSources(modules: NodeModules, sources: readonly string[], dockerHost: string | undefined) {
  for (const from of sources) {
    if (!MOUNTABLE.test(from)) {
      throw new HarnessError("invalid_sandbox_options", `a mounted folder can't have a comma or quote: ${from}`);
    }
    if (from === "/") throw new HarnessError("invalid_sandbox_options", "a mounted folder can't resolve to /");
  }
  for (const socket of daemonSockets(dockerHost)) {
    const real = await modules.fs.realpath(socket).catch(() => undefined);
    if (real !== undefined && sources.some((from) => inside(modules, from, real))) {
      throw new HarnessError("invalid_sandbox_options", `a mounted folder would hold the Docker socket ${socket}`);
    }
  }
}

/** One mount for each destination, read-only when any of the mounts for it is. */
function onePerDestination(mounts: readonly Mount[]): Mount[] {
  const byDestination = new Map<string, Mount>();
  for (const mount of mounts) {
    const earlier = byDestination.get(mount.to);
    byDestination.set(
      mount.to,
      earlier === undefined ? mount : { ...mount, readOnly: earlier.readOnly || mount.readOnly },
    );
  }
  return [...byDestination.values()];
}

/**
 * The real mounts for a policy: write roots writable, read roots and extras read-only, and read-only again on top the
 * `denyWrite` folders inside a write root (made after the checks, so a later write can't find them writable) and the
 * protected files that exist. A `denyWrite` path outside every write root is not mounted: nothing there is writable.
 */
async function planMounts(modules: NodeModules, policy: SandboxPolicy, options: DockerSandboxOptions) {
  const real = (paths: readonly string[]) => Promise.all(paths.map((path) => realOrSelf(modules, path)));
  const [readRoots, writeRoots, extra, denyWrite] = await Promise.all([
    real(policy.readRoots),
    real(policy.writeRoots),
    real(options.extraReadRoots ?? []),
    real(options.denyWrite ?? []),
  ]);
  for (const root of writeRoots) {
    if (!(await modules.fs.stat(root).catch(() => undefined))?.isDirectory()) {
      throw new HarnessError("invalid_sandbox_options", `a write root must be an existing folder: ${root}`);
    }
  }
  const underWrite = (path: string) => writeRoots.some((root) => inside(modules, root, path));
  const denied = denyWrite.filter(underWrite);
  const protectedPaths = writeRoots.flatMap((root) => PROTECTED_TOP_LEVEL.map((name) => modules.path.join(root, name)));
  const readOnlyRoots = [...readRoots, ...extra].filter((path) => !underWrite(path));
  // One look at which read roots exist feeds both the mounts and the names, so a folder made in between can't make them
  // disagree.
  const present = await existing(modules, readOnlyRoots);
  const base: Mount[] = [
    ...writeRoots.map((from) => ({ from, to: from, readOnly: false })),
    ...present.map((from) => ({ from, to: from, readOnly: true })),
  ];
  const protectedPresent = await existing(modules, protectedPaths);
  const guarded = [...denied, ...protectedPresent].map((from) => ({ from, to: from, readOnly: true }));
  const names: DockerPolicyNames = {
    requested: policy,
    readReal: readRoots,
    write: spellings(writeRoots, policy.writeRoots),
    missing: new Set(readOnlyRoots.filter((path) => !present.includes(path))),
    implicit: new Set([...extra, ...denied, ...protectedPresent]),
  };
  return {
    base: onePerDestination(base),
    mounts: onePerDestination([...base, ...guarded]),
    roots: { read: readRoots, write: writeRoots, denyWrite: denied },
    names,
  };
}

/** The `docker run` flags that lock a container down, and limit what it may use. */
function lockdownFlags(options: DockerSandboxOptions, user: string): string[] {
  const memory = `${options.memoryMb ?? DEFAULTS.memoryMb}m`;
  return [
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--ipc",
    "none",
    "--pids-limit",
    String(options.pidsLimit ?? DEFAULTS.pidsLimit),
    "--cpus",
    String(options.cpus ?? DEFAULTS.cpus),
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--user",
    user,
    // The only writable place that isn't a mounted write root: memory-backed, so it is gone with the container.
    "--tmpfs",
    "/tmp:rw,nosuid,size=64m",
  ];
}

/** The `docker` executable, or a `SandboxUnavailableError` when there is none. */
async function dockerProgram(modules: NodeModules, options: DockerSandboxOptions, hostPath: string): Promise<string> {
  if (options.binary !== undefined) {
    const program = modules.path.resolve(options.binary);
    await modules.fs.access(program, modules.fs.constants.X_OK).catch((error: unknown) => {
      throw new SandboxUnavailableError("docker", `${options.binary} is not an executable file`, { cause: error });
    });
    return program;
  }
  const found = await findOnPath(modules, hostPath, "docker");
  if (found === undefined) throw new SandboxUnavailableError("docker", "docker is not on the PATH");
  return found;
}

/** The first line of what a client printed, for the message of a failure. */
const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "no output";

/**
 * Builds the Docker backend. `provision()` checks the platform, the `docker` client, the daemon and that the image is on
 * the host, so a host that can't run the container throws `SandboxUnavailableError` and runs nothing. The `docker`
 * client runs with a clean environment: a `PATH`, a private empty `HOME` and `DOCKER_HOST` when one is set, and never
 * the parent's environment. The policy's roots, `extraReadRoots`, `denyWrite` and `proxySocket` must be absolute, and
 * the workspace must lie inside a root. A command whose first word contains `=` resolves with exit code 127, as under
 * `none`. Before it returns, `provision()` reads back the policy its mounts and flags apply and throws
 * `SandboxPolicyMismatchError` on a difference. Without `proxySocket` the container reaches no host, so a policy whose
 * `network.allow` names one is refused. The backend lists no capability: it can't resume, snapshot or pause.
 */
export function dockerSandbox(options: DockerSandboxOptions): SandboxClient {
  checkOptionValues(options);
  const client: SandboxClient = {
    tier: "container",
    stops: ["mistakes", "exfiltration"],
    async provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox> {
      const modules = nodeModules("docker");
      if (process.platform !== "linux") {
        throw new SandboxUnavailableError(
          "docker",
          `only Linux is supported, because it is the only platform this backend is tested on, and this is ${process.platform}`,
        );
      }
      const hostPath = absolutePath(modules, process.env.PATH);
      const docker = await dockerProgram(modules, options, hostPath);
      const root = await workspaceRoot(modules, manifest.root);
      checkPaths(modules, [...policy.readRoots, ...policy.writeRoots], "a sandbox root");
      checkPaths(modules, options.extraReadRoots ?? [], "an extra read root");
      checkPaths(modules, options.denyWrite ?? [], "a denyWrite folder");
      const folder = await modules.fs.mkdtemp(modules.path.join(modules.os.tmpdir(), "harness-docker-"));
      try {
        return await startSandbox({ modules, docker, hostPath, root, folder, manifest, policy, options, client });
      } catch (error) {
        await modules.fs.rm(folder, { recursive: true, force: true });
        throw error;
      }
    },
  };
  return client;
}

interface StartInput {
  readonly modules: NodeModules;
  readonly docker: string;
  readonly hostPath: string;
  readonly root: string;
  readonly folder: string;
  readonly manifest: WorkspaceManifest;
  readonly policy: SandboxPolicy;
  readonly options: DockerSandboxOptions;
  readonly client: SandboxClient;
}

async function startSandbox(input: StartInput): Promise<DockerSandbox> {
  const { modules, options } = input;
  await modules.fs.chmod(input.folder, 0o700);
  const home = modules.path.join(input.folder, "home");
  await modules.fs.mkdir(home, { mode: 0o700 });
  const dockerHost = options.dockerHost ?? process.env.DOCKER_HOST;
  const clientEnv = {
    PATH: input.hostPath,
    HOME: home,
    ...(dockerHost === undefined ? {} : { DOCKER_HOST: dockerHost }),
  };
  const plan = await planMounts(modules, input.policy, options);
  await checkSources(
    modules,
    plan.mounts.map((mount) => mount.from),
    dockerHost,
  );
  if (!plan.base.some((mount) => inside(modules, mount.from, input.root))) {
    throw new HarnessError("invalid_sandbox_options", "the workspace root must lie inside a read or write root");
  }
  const mounts = [...plan.mounts];
  if (options.proxySocket !== undefined) {
    checkPaths(modules, [options.proxySocket], "the proxy socket");
    const stats = await modules.fs.stat(options.proxySocket).catch(() => undefined);
    if (!stats?.isSocket()) throw new HarnessError("invalid_sandbox_options", "proxySocket must be a Unix socket");
    const from = await modules.fs.realpath(options.proxySocket);
    await checkSources(modules, [from], dockerHost);
    mounts.push({ from, to: DOCKER_PROXY_SOCKET_PATH, readOnly: false });
  }
  const user = options.user ?? `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  const sandbox = new DockerSandbox({
    modules,
    docker: input.docker,
    image: options.image,
    root: input.root,
    files: new HostFiles(modules, input.root, plan.roots, isProtectedPath),
    mounts,
    flags: lockdownFlags(options, user),
    clientEnv,
    folder: input.folder,
    label: `harness.sandbox=harness-${modules.path.basename(input.folder).slice("harness-docker-".length)}`,
    names: plan.names,
  });
  await probe(sandbox, options.image);
  await sandbox.confirm(input.client, input.policy);
  for (const folder of plan.roots.denyWrite) await modules.fs.mkdir(folder, { recursive: true });
  const encoder = new TextEncoder();
  for (const [path, data] of Object.entries(input.manifest.files ?? {})) {
    await sandbox.writeFile(path, typeof data === "string" ? encoder.encode(data) : data);
  }
  return sandbox;
}

/** Asks the daemon for its version and for the image, and throws `SandboxUnavailableError` when either fails. */
async function probe(sandbox: DockerSandbox, image: string): Promise<void> {
  const unavailable = (reason: string, cause?: unknown) => new SandboxUnavailableError("docker", reason, { cause });
  const version = await sandbox
    .client(["version", "--format", "{{.Server.Version}}"], DAEMON_TIMEOUT_MS)
    .catch((error: unknown) => {
      throw unavailable("the docker client could not be started", error);
    });
  if (version.exitCode !== 0) throw unavailable(`the daemon did not answer: ${firstLine(version.stderr)}`);
  const found = await sandbox
    .client(["image", "inspect", "--format", "{{.Id}}", image], DAEMON_TIMEOUT_MS)
    .catch((error: unknown) => {
      throw unavailable("the docker client could not be started", error);
    });
  if (found.exitCode !== 0) {
    throw unavailable(`the image ${image} is not on the Docker host, and provision never pulls: pull it first`);
  }
}
