/**
 * `createHarness()`: the settings every turn of a harness shares. A turn can override the model, the system prompt and
 * the tools; what it can't override, such as the registry and the permission pipeline, is fixed here. `H` is the type of
 * the per-turn host context, which reaches a tool's `execute` as `ctx.app` and is in no request, event or saved entry.
 */
import type { Model } from "@buildanagent/gateway";
import type { ApprovalPolicy, PermissionMode, SandboxTier } from "@buildanagent/protocol";
import type { ApprovalSigner, Interceptors, Observer } from "@buildanagent/sdk";
import type { PermissionPipeline } from "./permissions/types.js";
import type { ToolRegistry, ToolWrapper } from "./tools/types.js";

/** What the session's `env_stamp` records about where the turns run. */
export interface HarnessEnv {
  readonly cwd: string;
  readonly permissionMode: PermissionMode;
  readonly approvalPolicy: ApprovalPolicy;
  readonly sandbox: SandboxTier;
}

/** The options of `createHarness()`. */
export interface HarnessOptions<H = unknown> {
  readonly registry: ToolRegistry;
  /** The model a turn uses unless it names another. */
  readonly model: Model;
  /** The system prompt a turn uses unless it names another. */
  readonly system: string;
  /** What `env_stamp` records. A field left out takes `/`, `default`, `on-request` or `none`. */
  readonly env?: Partial<HarnessEnv>;
  /** The harness's version, stamped into each session header. */
  readonly harnessVersion?: string;
  /** A hash of the ablation switches, stamped into each session header. Default `none`. */
  readonly ablationHash?: string;
  /** When set, its gate decides every tool call, and each decision is written to the log. */
  readonly pipeline?: PermissionPipeline;
  /** Hooks that run with the pipeline's gate, before it for a gate, as `composeInterceptors()` orders them. */
  readonly interceptors?: Interceptors;
  /** Observers that see every event of every turn, after the runner's own. */
  readonly observers?: readonly Observer[];
  /** Binds a tool to the turn's host context, such as a write cap. A tool can also read it as `ctx.app`. */
  readonly wrap?: ToolWrapper<H>;
  /** Signs the pauses a turn ends in. */
  readonly signer?: ApprovalSigner;
}

/** A harness: its options with the defaults filled in. */
export interface Harness<H = unknown> extends HarnessOptions<H> {
  readonly env: HarnessEnv;
  readonly harnessVersion: string;
  readonly ablationHash: string;
}

/** Creates a harness. `H` types the host context of each turn, so `runTurn()` checks it. */
export function createHarness<H = unknown>(options: HarnessOptions<H>): Harness<H> {
  return {
    ...options,
    env: {
      cwd: options.env?.cwd ?? "/",
      permissionMode: options.env?.permissionMode ?? "default",
      approvalPolicy: options.env?.approvalPolicy ?? "on-request",
      sandbox: options.env?.sandbox ?? "none",
    },
    harnessVersion: options.harnessVersion ?? "0.0.0",
    ablationHash: options.ablationHash ?? "none",
  };
}
