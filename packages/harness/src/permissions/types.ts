/** The types of `@buildanagent/harness/permissions`. */
import type { PermissionDecisionEntry, PermissionMode, SessionEntry, ShadowCallEntry } from "@buildanagent/protocol";
import type { Interceptors, ToolCallEvent, ToolDefinition } from "@buildanagent/sdk";
import type { RegisteredTool } from "../tools/types.js";

export type { PermissionMode };

/** The entries the permission code writes. The session's store fills in the id, parent, sequence, time and origin. */
export type RecordedEntry = PermissionDecisionEntry | ShadowCallEntry;

/** The part of a session the permission code needs: somewhere to append the entries it writes. */
export interface PolicySession {
  /** Appends one entry to the session's log. A rejection fails the call that wrote it, so nothing runs unrecorded. */
  append(entry: RecordedEntry): Promise<unknown>;
}

/**
 * A rule that matches tool calls. `tool` is a name or alias (a `*` in a string matches any run of characters) or a
 * `RegExp` tested against the name and the alias. `paths` are globs (`*`, `**`, `?`) matched against the path
 * fields of the input, and `commandPrefix` is the leading words of a shell command. A rule with neither covers every
 * call to the tool.
 */
export interface Rule {
  readonly tool: string | RegExp;
  readonly paths?: readonly string[];
  readonly commandPrefix?: readonly string[];
  /** What the model and the approver read when this rule decides. */
  readonly reason?: string;
}

/** One tool call to decide. `initiator` is `code` for a call the host's own code chose to make. */
export interface ToolCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: unknown;
  readonly initiator: "model" | "code";
}

/** What a decision may read: the session, the turn's host context and the session's entries. */
export interface PolicyInput {
  readonly session: PolicySession;
  readonly hostContext: unknown;
  readonly entries: readonly SessionEntry[];
}

/** What a hook or the host callback receives: `PolicyInput` plus the pipeline's own mode and policy version. */
export interface PolicyContext extends PolicyInput {
  readonly mode: PermissionMode;
  readonly policyVersion: string;
}

/** What a hook may return: a refusal or a question, never an allow. */
export interface HookDecision {
  readonly decision: "deny" | "ask";
  readonly reason: string;
  readonly rule?: string;
}

/** A hook that can deny or ask about a call and cannot allow it, by type and at run time. */
export type PermissionHook = (call: ToolCall, ctx: PolicyContext) => Promise<HookDecision | undefined>;

/** The pipeline's decision on one call. */
export interface Decision {
  readonly decision: "allow" | "deny" | "ask";
  readonly reason: string;
  /** The rule that decided, such as `deny[0]`, `mode:bypass` or `no_match`, or the one a hook named. */
  readonly rule?: string;
  /** Who decided, when it was not a rule: `hook`, `mode`, or what the host callback gave. */
  readonly by?: string;
}

/** The pipeline's settings. */
export interface PermissionConfig {
  /** `default` adds nothing. `accept_edits` allows `editTools`. `read_only` allows `readOnlyTools` and denies the rest. `bypass` allows what no deny or ask rule stopped. `shadow` allows it too, for a wrapper that runs nothing. */
  readonly mode: PermissionMode;
  /** Run first, in order. A hook may deny or ask, never allow. A hook that throws denies the call. */
  readonly hooks?: readonly PermissionHook[];
  readonly deny?: readonly Rule[];
  readonly ask?: readonly Rule[];
  readonly allow?: readonly Rule[];
  /** Decides what no rule settled, last. With none, a call no rule settled asks when `interactive` and is denied otherwise. */
  readonly hostCallback?: (call: ToolCall, ctx: PolicyContext) => Promise<Decision>;
  /** Whether a person can answer: a call that no rule settles asks when true and is denied when false. */
  readonly interactive: boolean;
  /** Signed into every ask, so a later change of policy is visible when the approval is used. */
  readonly policyVersion: string;
  /** The tools `accept_edits` allows, by name or alias. Default `write`, `edit`, `multi_edit` and `apply_patch`. */
  readonly editTools?: readonly string[];
  /** The tools `read_only` allows, by name or alias. Default `read`, `grep` and `glob`. */
  readonly readOnlyTools?: readonly string[];
}

/** The pipeline `createPermissionPipeline()` returns. */
export interface PermissionPipeline {
  /**
   * Decides one call and writes one `permission_decision` entry for it, allows included. It fails closed: a hook or
   * host callback that throws, or returns something unusable, denies the call. An entry that can't be written rejects.
   */
  decide(call: ToolCall, input: PolicyInput): Promise<Decision>;
  /**
   * The SDK's `beforeToolCall` gate. `context` supplies the session, host context and entries for each call, and the
   * gate denies a call when `context` or `decide()` throws. An `ask` carries the config's `policyVersion`.
   */
  gate(context: (event: ToolCallEvent) => PolicyInput | Promise<PolicyInput>): Pick<Interceptors, "beforeToolCall">;
  /**
   * A `ToolWrapper` for `registry.definitions()`. In `shadow` mode it replaces each tool's `execute` with one that
   * writes a `shadow_call` entry to `session` and returns a fixed result, so the tool never runs. In every other mode
   * it returns the tool as registered. A pipeline in `shadow` mode refuses every call until this has been called, so a
   * host can't shadow by mode alone and run the tools for real.
   */
  shadowWrapper(session: PolicySession): (tool: RegisteredTool) => ToolDefinition<unknown, unknown, unknown>;
}
