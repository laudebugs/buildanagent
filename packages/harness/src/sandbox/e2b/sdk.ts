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
  rules?: Record<string, E2BNetworkRule[]>;
}

/** The network configuration E2B reports for a running sandbox. */
export interface E2BNetworkInfo {
  readonly allowOut?: readonly string[] | undefined;
  readonly denyOut?: readonly string[] | undefined;
  readonly dnsServers?: readonly string[] | undefined;
  readonly rules?: Readonly<Record<string, readonly E2BNetworkRule[]>> | undefined;
  readonly egressProxy?: unknown;
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
  wait(): Promise<E2BCommandResult>;
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
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

/** A sandbox instance. */
export interface E2BSandboxInstance {
  readonly sandboxId: string;
  readonly commands: {
    run(cmd: string, opts: E2BRunOptions): Promise<E2BCommandHandle>;
  };
  readonly files: {
    read(path: string, opts: { format: "bytes" }): Promise<Uint8Array>;
    write(path: string, data: Uint8Array): Promise<unknown>;
    makeDir(path: string): Promise<boolean>;
  };
  getInfo(): Promise<E2BSandboxInfo>;
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
  nextItems(): Promise<ReadonlyArray<{ readonly sandboxId: string }>>;
}

/** The `Sandbox` class's static methods the backend calls. */
export interface E2BSandboxApi {
  create(template: string, opts: E2BCreateOptions): Promise<E2BSandboxInstance>;
  connect(sandboxId: string, opts: E2BConnectionOptions & { timeoutMs?: number }): Promise<E2BSandboxInstance>;
  kill(sandboxId: string, opts?: E2BConnectionOptions): Promise<boolean>;
  list(opts: E2BConnectionOptions & { query: { metadata: Record<string, string> } }): E2BSandboxPaginator;
}

/** The `Secret` class's static methods the backend calls. Neither one reads or sends a secret's value. */
export interface E2BSecretApi {
  exists(secret: string, opts?: E2BConnectionOptions): Promise<boolean>;
  /** The placeholder E2B's egress proxy replaces with the secret's value, outside the sandbox. */
  fill(secret: string): string;
}

/** The SDK the backend runs on: `{ Sandbox, Secret }` from `e2b`, or a fake with the same shape. */
export interface E2BSdk {
  readonly Sandbox: E2BSandboxApi;
  readonly Secret: E2BSecretApi;
}
