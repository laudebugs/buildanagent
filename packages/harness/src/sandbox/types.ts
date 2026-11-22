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
 * A backend lists a stop only when its tier and its setup deliver it, and no tier here claims `hostile_process` yet.
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

/** What a command did: its exit status and output, or the denial that stopped it. A failing command is a result. */
export type ExecResult = { exitCode: number; stdout: string; stderr: string } | { denied: SandboxDenial };

/** The options of `Sandbox.exec()`. */
export interface ExecOptions {
  /** The working directory, relative to the workspace root. Defaults to the root. */
  readonly cwd?: string;
  /** The command's whole environment. Build it with `spawnEnv()`: nothing else is added. */
  readonly env: Readonly<Record<string, string>>;
  /** Aborts the command. An already aborted signal rejects before the command runs. */
  readonly signal: AbortSignal;
  /** Stops a command that runs longer than this, with exit code 124. */
  readonly timeoutMs?: number;
}

/** A provisioned sandbox. */
export interface Sandbox {
  /** Runs `command`, an executable and its arguments with no shell, and resolves with what it did. */
  exec(command: readonly string[], options: ExecOptions): Promise<ExecResult>;
  /** Reads a file by path relative to the workspace root, or absolute. */
  readFile(path: string): Promise<Uint8Array>;
  /** Writes a file by path relative to the workspace root, or absolute, making its folders. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Releases the sandbox. Calling it again does nothing, and any other call afterwards rejects. */
  dispose(): Promise<void>;
}

/** A sandbox backend. */
export interface SandboxClient {
  readonly tier: SandboxTier;
  readonly stops: readonly SandboxStop[];
  /** Provisions a sandbox, or throws `SandboxUnavailableError` when the backend can't start. It never falls back. */
  provision(manifest: WorkspaceManifest, policy: SandboxPolicy): Promise<Sandbox>;
}
