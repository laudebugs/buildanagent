/**
 * The part of the `e2b` SDK that the E2B backend calls, as structural types. The backend never imports `e2b` by value
 * at load time, so the subpath loads without it and a test can pass an in-process fake. `{ Sandbox, Secret }` from
 * `e2b` 2.63.0 satisfies `E2BSdk`, which `test/sandbox/e2b-types.test.ts` checks against the pinned declarations.
 */

/** Connection options the backend passes to every SDK call. */
export interface E2BConnectionOptions {
  /** The E2B API key. Without it, the SDK reads `E2B_API_KEY` from the host's environment. */
  readonly apiKey?: string;
  /** The E2B domain, for a self-hosted or BYOC deployment. */
  readonly domain?: string;
  /** How long one control-plane request may take, in milliseconds. */
  readonly requestTimeoutMs?: number;
}

/** One header transform of a network rule, as the backend writes and reads it. */
export interface E2BNetworkRule {
  readonly transform?: { readonly headers?: Readonly<Record<string, string>> };
}

/** The network configuration the backend sends to `Sandbox.create()`. */
export interface E2BNetworkOptions {
  allowOut: string[];
  denyOut: string[];
  dnsServers: string[];
  /** `false` makes the sandbox's public URLs refuse a request without its traffic access token. */
  allowPublicTraffic: false;
  rules?: Record<string, E2BNetworkRule[]>;
}

/** The network configuration E2B reports for a running sandbox. */
export interface E2BNetworkInfo {
  readonly allowOut?: readonly string[] | undefined;
  readonly denyOut?: readonly string[] | undefined;
  readonly dnsServers?: readonly string[] | undefined;
  readonly rules?: Readonly<Record<string, readonly E2BNetworkRule[]>> | undefined;
  readonly egressProxy?: unknown;
  readonly allowPublicTraffic?: boolean | undefined;
}

/** What `getInfo()` reports about a sandbox, as far as the backend reads it. */
export interface E2BSandboxInfo {
  readonly sandboxId: string;
  readonly state: "running" | "paused";
  readonly metadata?: Readonly<Record<string, string>> | undefined;
  readonly allowInternetAccess?: boolean | undefined;
  readonly network?: E2BNetworkInfo | undefined;
}

/** A command's result. The SDK throws one with a non-zero `exitCode` as a `CommandExitError`. */
export interface E2BCommandResult {
  readonly exitCode: number;
  readonly error?: string | undefined;
}

/** A command started in the background. */
export interface E2BCommandHandle {
  readonly pid: number;
  /** Resolves when the command ends, and rejects with its result when it exits non-zero. */
  wait(): Promise<E2BCommandResult>;
  /** Sends the command `SIGKILL`, and resolves `false` when it had already ended. */
  kill(): Promise<boolean>;
}

/** The options of a background command, as the backend starts every command. */
export interface E2BRunOptions {
  background: true;
  retainOutput: false;
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  /** Receives each chunk of standard output. */
  onStdout?: (data: string) => void;
  /** Receives each chunk of standard error. */
  onStderr?: (data: string) => void;
}

/** A sandbox instance. */
export interface E2BSandboxInstance {
  readonly sandboxId: string;
  readonly commands: {
    /** Starts `cmd` under `bash -l -c` in the background. */
    run(cmd: string, opts: E2BRunOptions): Promise<E2BCommandHandle>;
  };
  readonly files: {
    /** Reads a file's bytes, or rejects with `FileNotFoundError`. */
    read(path: string, opts: { format: "bytes" }): Promise<Uint8Array>;
    /** Writes a file, making its folders. */
    write(path: string, data: Uint8Array): Promise<unknown>;
    /** Makes a folder and its parents. */
    makeDir(path: string): Promise<boolean>;
  };
  /** Reports the sandbox's state, metadata and applied network. */
  getInfo(): Promise<E2BSandboxInfo>;
  /** Pauses the sandbox, keeping its state until `Sandbox.connect()`. */
  pause(): Promise<boolean>;
}

/** The options of `Sandbox.create()` that the backend sets. */
export interface E2BCreateOptions extends E2BConnectionOptions {
  timeoutMs: number;
  metadata: Record<string, string>;
  network: E2BNetworkOptions;
  lifecycle: { onTimeout: "kill" };
}

/** A page of listed sandboxes. */
export interface E2BSandboxPaginator {
  readonly hasNext: boolean;
  /** Fetches the next page. */
  nextItems(): Promise<ReadonlyArray<{ readonly sandboxId: string }>>;
}

/** The `Sandbox` class's static methods the backend calls. */
export interface E2BSandboxApi {
  /** Creates a sandbox from a template. */
  create(template: string, opts: E2BCreateOptions): Promise<E2BSandboxInstance>;
  /** Reattaches to a sandbox by its id, resuming it when it is paused. */
  connect(sandboxId: string, opts: E2BConnectionOptions & { timeoutMs?: number }): Promise<E2BSandboxInstance>;
  /** Kills a running or paused sandbox, and resolves `false` when E2B no longer has it. */
  kill(sandboxId: string, opts?: E2BConnectionOptions): Promise<boolean>;
  /** Reports a sandbox's state, metadata and network by its id, without waking it. */
  getInfo(sandboxId: string, opts?: E2BConnectionOptions): Promise<E2BSandboxInfo>;
  /** Lists the sandboxes whose metadata matches. */
  list(opts: E2BConnectionOptions & { query: { metadata: Record<string, string> } }): E2BSandboxPaginator;
}

/** The `Secret` class's static methods the backend calls. Neither one reads or sends a secret's value. */
export interface E2BSecretApi {
  /** Whether a secret with this name or id exists in the project. */
  exists(secret: string, opts?: E2BConnectionOptions): Promise<boolean>;
  /** The placeholder E2B's egress proxy replaces with the secret's value, outside the sandbox. */
  fill(secret: string): string;
}

/** The SDK the backend runs on: `{ Sandbox, Secret }` from `e2b`, or a fake with the same shape. */
export interface E2BSdk {
  readonly Sandbox: E2BSandboxApi;
  readonly Secret: E2BSecretApi;
}
