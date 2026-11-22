/**
 * The sandbox interface: a pluggable client with honest tiers. The host owns the policy and the approval, never the
 * model, and a backend that can't start throws instead of running unconfined (harness guide section 6, ADR 0020).
 */

/** What a sandbox may touch. Roots are absolute directories; a backend that enforces them denies the rest. */
export interface SandboxPolicy {
  /** Directories the sandbox may read. The write roots are readable too. */
  readonly readRoots: readonly string[];
  /** Directories the sandbox may write. */
  readonly writeRoots: readonly string[];
  /** The hosts the sandbox may reach: `allow` names them, and `deny` names the ones that stay closed inside `allow`. */
  readonly network: { readonly allow: readonly string[]; readonly deny: readonly string[] };
}

/** When a denied action may be asked for again, which is the host's decision and never the sandbox's. */
export type ApprovalPolicy = "on-request" | "granular" | "never";

/**
 * How strongly a backend confines a process. `none`: not at all. `os`: an operating-system sandbox that shares the
 * host's kernel. `container`: a container. `gvisor`: a user-space kernel. `microvm`: a virtual machine.
 */
export type SandboxTier = "none" | "os" | "container" | "gvisor" | "microvm";

/**
 * What a backend claims to stop. `mistakes`: the agent's own errors, such as a write outside the workspace.
 * `exfiltration`: sending data to a host that is not allowed. `hostile_process`: a process that is trying to escape.
 * A backend lists a stop only when its tier and its applied policy deliver it, which `stopsFor()` computes: only a
 * `microvm` stops a `hostile_process`, and none of the backends in this package is one.
 */
export type SandboxStop = "mistakes" | "exfiltration" | "hostile_process";

/** The workspace a sandbox is provisioned for: its root directory and the files to put there first. */
export interface WorkspaceManifest {
  /** The workspace's absolute root. Relative paths and working directories resolve against it. */
  readonly root: string;
  /** Files to write under the root before the first command, by path relative to it. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
}

/** What the policy refused. `target` names the path or host, and `reason` says which rule. */
export interface SandboxDenial {
  readonly kind: "filesystem_read" | "filesystem_write" | "network";
  readonly target: string;
  readonly reason: string;
}

/**
 * What a command did: its exit status and output, or the denial that stopped it. A failing command is a result.
 * `exitCode` is 124 for a timeout, 127 for a program that can't be found, and 128 plus the signal's number for a
 * command that a signal killed, with `signal` naming it. `timedOut` is `true` only when the sandbox stopped the command
 * at its timeout, so a command that exits with 124 itself can be told apart. `truncated` is `true` when the output
 * passed the cap and the rest was dropped.
 */
export type ExecResult =
  | { exitCode: number; stdout: string; stderr: string; signal?: string; timedOut?: boolean; truncated?: boolean }
  | { denied: SandboxDenial };

/** The options of `Sandbox.exec()`. */
export interface ExecOptions {
  /** The working directory, relative to the workspace root. Defaults to the root. */
  readonly cwd?: string;
  /** The command's whole environment. Build it with `spawnEnv()`: nothing else is added. */
  readonly env: Readonly<Record<string, string>>;
  /** Aborts the command and every process it started. An already aborted signal rejects before the command runs. */
  readonly signal: AbortSignal;
  /** Stops a command, and every process it started, that runs longer than this, with exit code 124. */
  readonly timeoutMs?: number;
  /** The most bytes of each of standard output and standard error to keep. Defaults to 8 MiB; the rest is dropped. */
  readonly maxOutputBytes?: number;
}

/**
 * What a backend can do besides provisioning. `resume`: reattach to a sandbox by its id, such as after `pause` or a lost
 * connection, or start one from a snapshot's id. `snapshot`: save a sandbox's state under an id that `resume` takes.
 * `pause`: suspend a sandbox, keeping its state, until `resume`. A local backend has none of them.
 */
export type SandboxCapability = "resume" | "snapshot" | "pause";

/** A provisioned sandbox. */
export interface Sandbox {
  /** Runs `command`, an executable and its arguments with no shell, and resolves with what it did. */
  exec(command: readonly string[], options: ExecOptions): Promise<ExecResult>;
  /** Reads a file by path relative to the workspace root, or absolute. A missing file rejects with `sandbox_not_found`. */
  readFile(path: string): Promise<Uint8Array>;
  /** Writes a file by path relative to the workspace root, or absolute, making its folders. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Stops what is still running, and releases the sandbox. Calling it again does nothing, and any other call afterwards rejects. */
  dispose(): Promise<void>;
  /** The id `SandboxClient.resume()` takes. Only a sandbox from a backend with the `resume` capability has one. */
  readonly id?: string;
  /**
   * The stops the applied policy delivers, as `stopsFor()` computes them from the read-back. A backend that reads its
   * policy back sets it when it provisions, and one that enforces nothing leaves it out.
   */
  readonly stops?: readonly SandboxStop[];
  /**
   * Reads back the policy the backend applied, from the backend's own record of it, such as the settings file it wrote
   * or the policy a hosted provider reports. A backend that claims any stop has it, and `provision()` compares its
   * answer with the request and throws `SandboxPolicyMismatchError` when they differ.
   */
  readBack?(): Promise<SandboxPolicy>;
  /** Saves the sandbox's state and resolves with an id that `resume()` starts a sandbox from. Needs `snapshot`. */
  snapshot?(): Promise<string>;
  /** Suspends the sandbox until `resume()` with its `id`. Needs `pause`. */
  pause?(): Promise<void>;
}

/** A sandbox backend. */
export interface SandboxClient {
  readonly tier: SandboxTier;
  /** The stops the backend claims for every policy it accepts. `provision()` checks them against the applied policy. */
  readonly stops: readonly SandboxStop[];
  /** What the backend can do besides provisioning. Leaving it out means none; call each one through its helper. */
  readonly capabilities?: readonly SandboxCapability[];
  /**
   * Provisions a sandbox, or throws `SandboxUnavailableError` when the backend can't start. It never falls back. A
   * backend that claims a stop reads its policy back first, and throws `SandboxPolicyMismatchError` on a difference.
   */
  provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox>;
  /**
   * Reattaches to the sandbox with this id, or starts one from the snapshot with this id. `policy` is the policy it must
   * still apply. Needs `resume`; call it through `resumeSandbox()`, which checks the read-back.
   */
  resume?(id: string, policy: SandboxPolicy): Promise<Sandbox>;
}
