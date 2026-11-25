/**
 * The harness's types: the settings every turn of a harness shares, and the code calls it runs. A turn can override the
 * model, the system prompt and the tools; what it can't override, such as the registry and the permission pipeline, is
 * fixed here. `H` is the type of the per-turn host context, which reaches a tool's `execute` as `ctx.app` and is in no
 * request, event or saved entry. `createHarness()` lives in its own module, because it binds the code-call runner,
 * which imports these types.
 */
import type { Model } from "@buildanagent/gateway";
import type { ApprovalPolicy, PermissionMode, SandboxTier } from "@buildanagent/protocol";
import type { ApprovalSigner, Interceptors, Observer, SignedPendingRequest, ToolResult } from "@buildanagent/sdk";
import type { Clock } from "@buildanagent/sdk/testing";
import type { AblationConfig } from "./ablation.js";
import type { ContextPolicy } from "./context/types.js";
import type { Skill } from "./extensions/skills.js";
import type { ExtensionLoadedRecord } from "./extensions/types.js";
import type { PermissionPipeline } from "./permissions/types.js";
import type { Session } from "./session/session.js";
import type { ToolRegistry, ToolWrapper, TurnBoundary } from "./tools/types.js";

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
  /** A hash of the ablation switches, stamped into each session header. Default `none`, or `ablationHash(ablation)`. */
  readonly ablationHash?: string;
  /**
   * Switches for every removable component of this harness. When set, `createHarness()` validates the configuration,
   * stamps `ablationHash` and `env.sandbox` from it, filters disabled MCP/in-process extension tools, extension
   * records, `turnBoundaries`, `tool_search`, skills, telemetry observers, overflow retries and completion checks.
   * Pass `layers: ablation.context` to `createContextPolicy()` so the policy disables the matching context layers.
   */
  readonly ablation?: AblationConfig;
  /** When set, its gate decides every tool call, and each decision is written to the log. */
  readonly pipeline?: PermissionPipeline;
  /**
   * Hooks that run with the pipeline's gate in every turn, before it for a gate, as `composeInterceptors()` orders
   * them. A code call from `invokeTool()` runs no turn, so they don't see it.
   */
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
  /**
   * Components that change tools between turns, such as an MCP manager. Each turn calls their `beginTurn()` in order
   * before it builds its tools, and writes the notices they return in front of its input, so the model reads what
   * changed and the tools a request sends stay as they are. A resumed turn and a code call run no boundary.
   */
  readonly turnBoundaries?: readonly TurnBoundary[];
  /** Observers that see every event of every turn, after the runner's own. A code call emits no events. */
  readonly observers?: readonly Observer[];
  /** Binds a tool to the turn's host context, such as a write cap. A tool can also read it as `ctx.app`. */
  readonly wrap?: ToolWrapper<H>;
  /** Signs the pauses a turn ends in. */
  readonly signer?: ApprovalSigner;
}

/** A tool call that the host's own code makes with `Harness.invokeTool()`, with no model step. */
export interface CodeCall<H = unknown> {
  /** The tool's name or alias in the registry. */
  readonly tool: string;
  /** The input the tool runs with. It is recorded and hashed as given, so it must have a canonical JSON form. */
  readonly input: unknown;
  /**
   * The host context the tool runs with, as `ctx.app`. A call that asks for a person binds a MAC of it into the signed
   * request, so `Approvals.resolve()` runs the call only when it is given the same host context.
   */
  readonly hostContext?: H;
  /**
   * The call id of an earlier code call that this one undoes. The earlier call must have run, and this call must reach
   * an effect key of its own. The `code_call` entry records the link.
   */
  readonly compensates?: string;
  /** Aborts the call. An aborted signal before the call starts writes nothing; the tool receives it as `ctx.signal`. */
  readonly signal?: AbortSignal;
  /** The clock of the entries, the signed request and the tool's `ctx.clock`. Default the system clock. */
  readonly clock?: Clock;
  /** Makes the ids of the entries, the call and the signed request. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

/**
 * What a code call ended in.
 *
 * - `done`: the tool ran. `result` is the whole of what it returned, with a write outcome's sentence in front of its
 *   content, even when the call's `tool_result` entry holds it capped.
 * - `denied`: the permission pipeline or a person refused the call. The tool never ran.
 * - `awaiting_approval`: a person must answer `pending` through `Approvals.resolve()`. It has no `entryId`.
 *
 * `entryId` is the id of the call's `tool_result` entry. `effectKey` is the call's effect identity: from the tool's
 * business key when it declares one, and otherwise from the call id, which is the id of the call's `code_call` entry.
 */
export type CodeCallResult =
  | {
      readonly status: "done";
      readonly callId: string;
      readonly result: ToolResult<unknown>;
      readonly entryId: string;
      readonly effectKey: string;
    }
  | { readonly status: "denied"; readonly callId: string; readonly reason: string; readonly entryId: string }
  | {
      readonly status: "awaiting_approval";
      readonly callId: string;
      readonly pending: SignedPendingRequest;
      readonly effectKey: string;
    };

/** A harness: its options with the defaults filled in. */
export interface Harness<H = unknown> extends HarnessOptions<H> {
  readonly env: HarnessEnv;
  readonly tenant: string;
  readonly harnessVersion: string;
  readonly ablationHash: string;
  /**
   * Runs a tool call that the host's own code chose, through the same permission pipeline, signed pause and log as a
   * call the model makes, with no model call. The session must be open with its lock.
   *
   * The call's own entries start with a `code_call` entry, then the pipeline's `permission_decision`. Before them it
   * writes what the session lacks: a new session's header and environment stamp, and a result for each earlier code
   * call a crash left open.
   *
   * The call ends one of three ways:
   *
   * - An allow runs the tool through the harness's `wrap` with `call.hostContext`, writes its `tool_result` and returns
   *   `done`. The harness's `context` policy caps the stored result, and the store's entry bound cuts it to fit, with
   *   its outcome kept.
   * - A deny writes an error `tool_result` and returns `denied`.
   * - An ask that no sticky allowance covers writes an `approval_requested` entry, signed as `createPendingRequest()`
   *   signs it, and returns `awaiting_approval`. `Approvals.resolve()` answers it.
   *
   * A code call runs no turn, so the harness's `interceptors` and `observers` don't see it. Put a guard that must cover
   * code calls in the pipeline's hooks, which see `initiator: "code"`, or in `wrap`.
   *
   * It throws before it writes anything:
   *
   * - `invalid_code_call` for a tool the registry lacks or that runs on the client, an input or host context with no
   *   canonical JSON form, a business key that fails, a harness with no permission pipeline, or a compensation that
   *   names no code call that ran or would share that call's effect key.
   * - `approval_unavailable` for a harness with no signer.
   * - The signal's reason for a signal aborted before the call starts.
   */
  invokeTool(this: Harness<H>, session: Session, call: CodeCall<H>): Promise<CodeCallResult>;
}
