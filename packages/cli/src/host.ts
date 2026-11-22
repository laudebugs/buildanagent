/**
 * The harness a command runs on, and the in-process client it talks to it through. Sessions, locks, spilled tool
 * output and the approval key ring live under one state folder on this machine, and the only connections a host can
 * open are to the model a command names and to the `--otlp-endpoint` collector.
 */
import type { Model } from "@buildanagent/gateway";
import { createContextPolicy } from "@buildanagent/harness/context";
import { fileSpillStore } from "@buildanagent/harness/context/file";
import { createPermissionPipeline, defaultAskRules, type Rule } from "@buildanagent/harness/permissions";
import {
  createDispatcher,
  createHarness,
  type Dispatcher,
  type Harness,
  type InProcessClient,
  inProcessTransport,
} from "@buildanagent/harness/server";
import { fileIndex, fileKeyStore, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry, type ToolRegistration } from "@buildanagent/harness/tools";
import { hmacSigner, type Observer } from "@buildanagent/sdk";
import { otelObserver } from "@buildanagent/sdk/otel";
import { CliError } from "./errors.js";
import { type OtlpTracer, otlpTracer } from "./otlp.js";

/** The system prompt every turn starts from. */
export const SYSTEM_PROMPT = "You are a coding agent. Work in the user's project, and ask before you change anything.";

/** The user every session is stored under: the CLI serves the one person at the terminal. */
export const USER_ID = "local";

/** The policy version every approval the CLI asks for carries. */
const POLICY_VERSION = "buildanagent-cli-1";

/** Where a host keeps its files. */
export interface StatePaths {
  readonly root: string;
  readonly sessions: string;
  readonly locks: string;
  readonly spill: string;
  readonly keys: string;
}

/** The permission rules a host adds to the harness's default ask rules. */
export interface HostRules {
  readonly deny?: readonly Rule[];
  readonly ask?: readonly Rule[];
  readonly allow?: readonly Rule[];
}

/** What `openHost()` takes. */
export interface HostOptions {
  readonly paths: StatePaths;
  readonly cwd: string;
  /** The model turns use. Left out, a turn that calls a model fails, which suits the commands that only read. */
  readonly model?: Model;
  /** Whether a person answers approvals. Without one, a call no rule settles is denied instead of asked. */
  readonly interactive: boolean;
  /** Load the approval key ring, which a turn needs to sign its pauses. Read-only commands leave it unloaded. */
  readonly signing: boolean;
  readonly tools?: readonly ToolRegistration[];
  readonly rules?: HostRules;
  readonly budgetUsd?: number;
  readonly otlpEndpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** A harness, its dispatcher and one in-process client. */
export interface Host {
  readonly harness: Harness;
  readonly dispatcher: Dispatcher;
  readonly client: InProcessClient;
  readonly paths: StatePaths;
  /** Ends every turn, closes the client and sends any spans. */
  close(): Promise<void>;
}

/** The folders under `root`, which `--state-dir` names or the environment implies. */
export function statePaths(root: string): StatePaths {
  const base = root.replace(/\/+$/, "");
  return {
    root: base,
    sessions: `${base}/sessions`,
    locks: `${base}/locks`,
    spill: `${base}/spill`,
    keys: `${base}/keys.json`,
  };
}

/**
 * The state folder: `--state-dir`, else `$XDG_STATE_HOME/buildanagent`, else `~/.local/state/buildanagent`, which is
 * where the harness keeps its key ring by default too. Throws a `CliError`, code `no_state_dir`, when none is known.
 */
export function stateRoot(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): string {
  if (flag !== undefined && flag !== "") return flag;
  if (env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== "") return `${env.XDG_STATE_HOME}/buildanagent`;
  if (env.HOME !== undefined && env.HOME !== "") return `${env.HOME}/.local/state/buildanagent`;
  throw new CliError("no_state_dir", "set HOME or XDG_STATE_HOME, or pass --state-dir <folder>");
}

/** A model for the commands that only read: any call fails at once, so it can never reach a provider. */
const NO_MODEL: Model = {
  ref: { api: "none", provider: "none", id: "none" },
  caps: { contextWindow: 200_000, maxOutputTokens: 4_096, images: false, reasoning: false },
  stream() {
    throw new CliError("no_model", "this command calls a model: pass --model <provider>:<model id>");
  },
  complete() {
    return Promise.reject(new CliError("no_model", "this command calls a model: pass --model <provider>:<model id>"));
  },
  price: () => ({ total: null, basis: "unknown", currency: "USD" }),
};

function telemetry(options: HostOptions): { observers: Observer[]; tracer?: OtlpTracer } {
  if (options.otlpEndpoint === undefined) return { observers: [] };
  const tracer = otlpTracer({
    endpoint: options.otlpEndpoint,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    observers: [otelObserver({ tracer, agentName: "buildanagent", childContext: tracer.childContext })],
    tracer,
  };
}

/** Builds the harness for one command and connects a client to it. */
export async function openHost(options: HostOptions): Promise<Host> {
  const { paths } = options;
  const registry = createToolRegistry();
  for (const tool of options.tools ?? []) registry.register(tool);
  const rules = options.rules ?? {};
  const pipeline = createPermissionPipeline(
    {
      mode: "default",
      interactive: options.interactive,
      policyVersion: POLICY_VERSION,
      ask: [...defaultAskRules, ...(rules.ask ?? [])],
      ...(rules.deny === undefined ? {} : { deny: rules.deny }),
      ...(rules.allow === undefined ? {} : { allow: rules.allow }),
    },
    registry,
  );
  const { observers, tracer } = telemetry(options);
  const signer = options.signing ? hmacSigner(await fileKeyStore(paths.keys).load()) : undefined;
  const harness = createHarness({
    registry,
    model: options.model ?? NO_MODEL,
    system: SYSTEM_PROMPT,
    env: { cwd: options.cwd },
    pipeline,
    context: createContextPolicy({ spill: fileSpillStore({ dir: paths.spill }) }),
    observers,
    ...(signer === undefined ? {} : { signer }),
  });
  const dispatcher = createDispatcher({
    harness,
    store: jsonlStore({ dir: paths.sessions }),
    index: fileIndex({ dir: paths.sessions }),
    lock: fileLock({ dir: paths.locks }),
    userId: USER_ID,
    serverName: "buildanagent",
    ...(options.budgetUsd === undefined ? {} : { turn: { budgetUsd: options.budgetUsd } }),
  });
  const client = inProcessTransport(dispatcher);
  return {
    harness,
    dispatcher,
    client,
    paths,
    async close() {
      await dispatcher.close();
      client.close();
      await tracer?.flush();
    },
  };
}
