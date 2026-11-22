/**
 * `createHarness()`: the settings every turn of a harness shares. A turn can override the model, the system prompt and
 * the tools; what it can't override, such as the registry and the permission pipeline, is fixed here. `H` is the type of
 * the per-turn host context, which reaches a tool's `execute` as `ctx.app` and is in no request, event or saved entry.
 */
import type { Model } from "@buildanagent/gateway";
import type { ApprovalPolicy, PermissionMode, SandboxTier } from "@buildanagent/protocol";
import type { ApprovalSigner, Interceptors, Observer } from "@buildanagent/sdk";
import type { ContextPolicy } from "./context/types.js";
import type { Skill } from "./extensions/skills.js";
import type { ExtensionLoadedRecord } from "./extensions/types.js";
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
  /**
   * The tenant a write acts for: one tenant is one user, so a business key never spans two users. Default `local`,
   * for a host that has one user. `effectScope()` puts it in the scope a guarded write takes.
   */
  readonly tenant?: string;
  /** The harness's version, stamped into each session header. */
  readonly harnessVersion?: string;
  /** A hash of the ablation switches, stamped into each session header. Default `none`. */
  readonly ablationHash?: string;
  /** When set, its gate decides every tool call, and each decision is written to the log. */
  readonly pipeline?: PermissionPipeline;
  /** Hooks that run with the pipeline's gate, before it for a gate, as `composeInterceptors()` orders them. */
  readonly interceptors?: Interceptors;
  /** The context layers every turn runs through, from `createContextPolicy()`. Without one a turn sends its whole transcript. */
  readonly context?: ContextPolicy;
  /**
   * The extensions this harness runs, as `recordsOf()` or `loadProjectExtensions()` gives them. A turn writes an
   * `extension_loaded` entry for each the session's log does not hold yet, so a session shows which code ran.
   */
  readonly extensionRecords?: readonly ExtensionLoadedRecord[];
  /**
   * The skills the system prompt lists, as `discoverSkills()` gives them. When a successful `read` call opens the whole
   * of one's `SKILL.md`, with no `offset` or `limit`, the turn writes a `skill_loaded` entry. Relative paths in the call
   * resolve against `env.cwd`.
   */
  readonly skills?: readonly Skill[];
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
  readonly tenant: string;
  readonly harnessVersion: string;
  readonly ablationHash: string;
}

/** Creates a harness. `H` types the host context of each turn, so `runTurn()` checks it. */
export function createHarness<H = unknown>(options: HarnessOptions<H>): Harness<H> {
  return {
    ...options,
    tenant: options.tenant ?? "local",
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
