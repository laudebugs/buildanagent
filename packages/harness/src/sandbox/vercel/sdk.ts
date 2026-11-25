/**
 * The part of `@vercel/sandbox` the backend uses, as a small interface, and `vercelSandboxSdk()`, which fills it with the
 * real package. Tests pass an in-process fake of the same interface, so nothing here reaches the network unless the real
 * one is used.
 */
import { type NetworkPolicy, Sandbox } from "@vercel/sandbox";

/** A command that has finished in a Vercel sandbox. */
export interface VercelFinishedCommand {
  /** The command's exit code. */
  readonly exitCode: number;
  /** Resolves with everything the command wrote to standard output. */
  stdout(): Promise<string>;
  /** Resolves with everything the command wrote to standard error. */
  stderr(): Promise<string>;
}

/** A command started in a Vercel sandbox with `detached: true`. */
export interface VercelCommand {
  /** Waits for the command to finish. An aborted `signal` stops the wait, not the command. */
  wait(params?: { signal?: AbortSignal }): Promise<VercelFinishedCommand>;
  /** Sends the command a signal. */
  kill(signal?: "SIGKILL"): Promise<void>;
}

/** What the backend asks `runCommand()` to start. */
export interface VercelRunParams {
  /** The program to run. */
  readonly cmd: string;
  /** Its arguments. */
  readonly args: string[];
  /** The absolute working directory. */
  readonly cwd: string;
  /** Always `true`: `runCommand()` resolves once the command starts. */
  readonly detached: true;
  /** Always `false`: no command runs as root. */
  readonly sudo: false;
  /** Cancels the start. */
  readonly signal?: AbortSignal;
  /** Milliseconds after which Vercel kills the command with `SIGKILL`. */
  readonly timeoutMs?: number;
}

/** A Vercel sandbox, as the backend uses it. `Sandbox` from `@vercel/sandbox` has this shape. */
export interface VercelSandboxInstance {
  /** The sandbox's name, which `get()` takes. */
  readonly name: string;
  /** The network policy Vercel reports for the sandbox, with every injected header's value replaced. */
  readonly networkPolicy: NetworkPolicy | undefined;
  /** Starts a command and resolves once it has started, without waiting for it to finish. */
  runCommand(params: VercelRunParams): Promise<VercelCommand>;
  /** Resolves with the file's bytes, or `null` when there is no file at `path`. */
  readFileToBuffer(file: { path: string }): Promise<Uint8Array | null>;
  /** Writes each file at its absolute path, as the sandbox's default user. */
  writeFiles(files: { path: string; content: Uint8Array }[]): Promise<void>;
  /** Applies a new configuration, such as a network policy, to the running sandbox. */
  update(params: { networkPolicy: NetworkPolicy }): Promise<void>;
  /** Saves the file system as a snapshot, and stops the sandbox. */
  snapshot(): Promise<{ readonly snapshotId: string }>;
  /** Stops the running session. A persistent sandbox keeps its files for the next one. */
  stop(): Promise<unknown>;
  /** Deletes the sandbox and its stored configuration. */
  delete(): Promise<void>;
}

/** What the backend passes to `create()`. It never sets `env`, so the sandbox starts with no variable of the host's. */
export interface VercelCreateParams {
  /** The new sandbox's name. */
  readonly name: string;
  /** The firewall policy, which holds the injected credentials, so it is never logged. */
  readonly networkPolicy: NetworkPolicy;
  /** Milliseconds before Vercel stops the sandbox on its own, whatever the host does. */
  readonly timeout: number;
  /** Whether a stopped sandbox keeps its files. */
  readonly persistent: boolean;
  /** A snapshot to start from, for a resume. */
  readonly source?: { readonly type: "snapshot"; readonly snapshotId: string };
  /** The image to start from. Leaving it out uses Vercel's default image. */
  readonly image?: string;
  /** The virtual CPUs. */
  readonly vcpus?: number;
  /** Cancels the create. */
  readonly signal?: AbortSignal;
}

/** The two calls of `@vercel/sandbox`'s `Sandbox` class the backend makes. */
export interface VercelSandboxSdk {
  /** Creates a sandbox and starts its first session. */
  create(params: VercelCreateParams): Promise<VercelSandboxInstance>;
  /** Finds a sandbox by name. With `resume`, it starts its session again if it is stopped. */
  get(params: { name: string; resume?: boolean; signal?: AbortSignal }): Promise<VercelSandboxInstance>;
}

/** An access token for the Vercel API, with the team and project the sandboxes belong to. */
export interface VercelCredentials {
  /** A Vercel access token. */
  readonly token: string;
  /** The team the sandboxes belong to. */
  readonly teamId: string;
  /** The project the sandboxes belong to. */
  readonly projectId: string;
}

/** The create parameters in the shape `Sandbox.create()` takes, which forbids an image beside a snapshot source. */
function createParams(params: VercelCreateParams) {
  const common = {
    name: params.name,
    networkPolicy: params.networkPolicy,
    timeout: params.timeout,
    persistent: params.persistent,
    ...(params.vcpus === undefined ? {} : { resources: { vcpus: params.vcpus } }),
    ...(params.signal === undefined ? {} : { signal: params.signal }),
  };
  if (params.source !== undefined) {
    return { ...common, source: { type: "snapshot" as const, snapshotId: params.source.snapshotId } };
  }
  return params.image === undefined ? common : { ...common, image: params.image };
}

/**
 * The real `@vercel/sandbox` client. With `credentials`, every call uses that token, team and project. Without them,
 * the package finds its own: the `VERCEL_OIDC_TOKEN` of a Vercel deployment, or the token that `vercel env pull` writes.
 * The credentials stay in the host process: the backend never passes them to a sandbox, a command or a handle.
 */
export function vercelSandboxSdk(credentials?: VercelCredentials): VercelSandboxSdk {
  const auth = credentials === undefined ? {} : { ...credentials };
  return {
    create: (params) => Sandbox.create({ ...createParams(params), ...auth }),
    get: (params) => Sandbox.get({ ...params, ...auth }),
  };
}
