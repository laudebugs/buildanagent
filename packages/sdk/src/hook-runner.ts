/**
 * Runs the interceptors for one run: builds each hook's frozen event, applies the failure policy, checks what the
 * hook returned and emits `hook_error` and `context_transformed`. The loop and the tool pipeline call it at each
 * moment and never look at the hooks themselves.
 *
 * Failure policy (D6): a hook that throws is reported as a `hook_error` event. Under `fail_closed`, the default, a
 * failed gate denies its call, a failed `afterToolCall` withholds the result, and any other failed hook throws a
 * `HookFailure`, which the loop turns into an `error` result. Under `continue` the failed hook is skipped.
 */
import type { AssistantMessage, Message, ModelContext, ModelRef, Usage } from "@buildanagent/gateway";
import { isSdkError, SdkError } from "./errors.js";
import type { AgentEventBody } from "./events.js";
import { frozenCopy, thawedCopy } from "./freeze.js";
import {
  checkDecision,
  checkMessages,
  checkModelPatch,
  checkReplacement,
  checkResultPatch,
  checkStopDecision,
  type StopVerdict,
} from "./hook-checks.js";
import type { CallOptions, GateDecision, HookEventBase, Interceptors, ModelCallPatch } from "./hooks.js";
import type { Clock } from "./testing/determinism.js";
import { type AnyTool, type GateOutcome, isContentList, type PipelineContext } from "./tools/pipeline.js";
import type { ToolCall, ToolResult } from "./tools/types.js";

/** Thrown inside a run when a hook failed while the run fails closed; the loop ends the run with an `error` result. */
export class HookFailure extends SdkError {
  override readonly name = "HookFailure";
  readonly hook: string;

  constructor(hook: string, cause: unknown) {
    super("hook_failed", `the ${hook} hook failed: ${messageOf(cause)}`, { cause });
    this.hook = hook;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How a guarded hook call ended: it returned, it failed and the run skips it, or it failed and a result stands in. */
type Guarded<T, R> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "skipped" }
  | { readonly status: "closed"; readonly value: R };

/** The result of a call after `afterToolCall` returned `patch`, checked to still be one the model can read. */
function mergeResult(tool: string, result: ToolResult, patch: Record<string, unknown> | undefined): ToolResult {
  if (patch === undefined) return result;
  const merged = { ...result, ...patch } as ToolResult;
  if (!isContentList(merged.content)) {
    throw new SdkError(
      "invalid_hook_result",
      `afterToolCall for "${tool}" returned content that is not a list of text and image blocks`,
    );
  }
  return merged;
}

/** What a run gives its hook runner. */
export interface HookRunnerSetup {
  readonly interceptors: Interceptors;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly clock: Clock;
  /** The index of the model call in progress. */
  stepIndex(): number;
  send(body: AgentEventBody): void;
}

function blocked(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], isError: true, details };
}

/** The pipeline hooks that the interceptors fill, left out when no interceptor needs them. */
export type PipelineHooks = Pick<PipelineContext, "gate" | "after">;

function gateOutcome(tool: string, decision: GateDecision): GateOutcome | undefined {
  if (decision.decision === "allow")
    return decision.input === undefined ? undefined : { input: thawedCopy(decision.input) };
  if (decision.decision === "deny") {
    return { blocked: blocked(`Tool call "${tool}" was denied: ${decision.reason}`, { decision: "deny" }) };
  }
  const why = decision.reason === undefined ? "" : ` (${decision.reason})`;
  const text = `Tool call "${tool}" needs approval${why}, and this run can't ask for it, so it was not run.`;
  return {
    blocked: blocked(text, { decision: "ask", ...(decision.reason === undefined ? {} : { reason: decision.reason }) }),
  };
}

/** Runs one run's interceptors. */
export class HookRunner {
  readonly #setup: HookRunnerSetup;
  readonly #hooks: Interceptors;
  readonly #continues: boolean;

  constructor(setup: HookRunnerSetup) {
    this.#setup = setup;
    this.#hooks = setup.interceptors;
    this.#continues = setup.interceptors.onFailure === "continue";
  }

  /** The gate and the after-hook, for the tool pipeline. */
  pipelineHooks(): PipelineHooks {
    return {
      ...(this.#hooks.beforeToolCall === undefined ? {} : { gate: (e) => this.#gate(e) }),
      ...(this.#hooks.afterToolCall === undefined ? {} : { after: (e) => this.#afterTool(e) }),
    };
  }

  /** The messages `transformContext` chose for this call, or undefined to send the transcript as it is. */
  async transformContext(input: {
    system: string;
    messages: readonly Message[];
    model: ModelRef;
    lastUsage: Usage | undefined;
  }): Promise<Message[] | undefined> {
    const hook = this.#hooks.transformContext;
    if (hook === undefined) return undefined;
    const { lastUsage, ...rest } = input;
    const event = this.#event({ ...rest, ...(lastUsage === undefined ? {} : { lastUsage }) });
    const guarded = await this.#guard("transformContext", () => hook(event));
    if (guarded.status !== "ok") return undefined;
    const messages = checkMessages("transformContext", guarded.value);
    this.#setup.send({ type: "context_transformed", before: input.messages.length, after: messages.length });
    return messages;
  }

  /** What `beforeModelCall` changed, if anything. */
  async beforeModelCall(input: { context: ModelContext; options: CallOptions }): Promise<ModelCallPatch | undefined> {
    const hook = this.#hooks.beforeModelCall;
    if (hook === undefined) return undefined;
    const event = this.#event(input);
    const guarded = await this.#guard("beforeModelCall", () => hook(event));
    return guarded.status === "ok" ? checkModelPatch(guarded.value) : undefined;
  }

  /** The response the run goes on with: `afterModelCall`'s replacement, or `message` itself. */
  async afterModelCall(message: AssistantMessage): Promise<AssistantMessage> {
    const hook = this.#hooks.afterModelCall;
    if (hook === undefined) return message;
    const event = this.#event({ message });
    const guarded = await this.#guard("afterModelCall", () => hook(event));
    return (guarded.status === "ok" ? checkReplacement(guarded.value) : undefined) ?? message;
  }

  /** What `shouldStop` decided. */
  async shouldStop(input: { messages: readonly Message[]; lastMessage: AssistantMessage }): Promise<StopVerdict> {
    const hook = this.#hooks.shouldStop;
    if (hook === undefined) return { kind: "none" };
    const event = this.#event(input);
    const guarded = await this.#guard("shouldStop", () => hook(event));
    return guarded.status === "ok" ? checkStopDecision(guarded.value) : { kind: "none" };
  }

  async #gate(input: { call: ToolCall; tool: AnyTool; input: unknown }): Promise<GateOutcome | undefined> {
    const hook = this.#hooks.beforeToolCall;
    if (hook === undefined) return undefined;
    const { call, tool } = input;
    const event = this.#event({ callId: call.callId, tool: tool.name, input: input.input }, call.callId);
    const failed = (error: unknown): GateOutcome => ({
      blocked: blocked(`Tool call "${tool.name}" was not run, because its permission check failed.`, {
        hook: "beforeToolCall",
        error: messageOf(error),
      }),
    });
    const guarded = await this.#guard("beforeToolCall", () => hook(event), failed);
    if (guarded.status === "skipped") return undefined;
    return guarded.status === "closed" ? guarded.value : gateOutcome(tool.name, checkDecision(guarded.value));
  }

  async #afterTool(input: { call: ToolCall; tool: AnyTool; input: unknown; result: ToolResult }): Promise<ToolResult> {
    const hook = this.#hooks.afterToolCall;
    const { call, tool, result } = input;
    if (hook === undefined) return result;
    const event = this.#event({ callId: call.callId, tool: tool.name, input: input.input, result }, call.callId);
    // The tool already ran, so the stand-in says so and keeps the write outcome: a model told only "withheld" would
    // retry a write that was applied.
    const withheld = (error: unknown): ToolResult => ({
      ...blocked(`Tool call "${tool.name}" ran, but its result was withheld, because its result check failed.`, {
        hook: "afterToolCall",
        error: messageOf(error),
      }),
      ...(result.outcome === undefined ? {} : { outcome: result.outcome }),
    });
    const guarded = await this.#guard("afterToolCall", () => hook(event), withheld);
    if (guarded.status === "skipped") return result;
    return guarded.status === "closed"
      ? guarded.value
      : mergeResult(tool.name, result, checkResultPatch(guarded.value));
  }

  #event<P extends object>(payload: P, callId?: string): Readonly<HookEventBase & P> {
    const { runId, signal, clock } = this.#setup;
    return Object.freeze({
      runId,
      stepIndex: this.#setup.stepIndex(),
      ...(callId === undefined ? {} : { callId }),
      signal,
      timestamp: clock.now(),
      ...frozenCopy(payload),
    }) as Readonly<HookEventBase & P>;
  }

  /** Calls a hook under the failure policy. Without `closed`, a failure under `fail_closed` throws a `HookFailure`. */
  async #guard<T, R = never>(
    hook: string,
    call: () => T | Promise<T>,
    closed?: (error: unknown) => R,
  ): Promise<Guarded<Awaited<T>, R>> {
    try {
      return { status: "ok", value: await call() };
    } catch (error) {
      // A wrong return shape is a programmer error whatever the policy, even when a joined hook found it inside
      // `composeInterceptors()`: skipping or closing on it would let a typo in a gate pass silently.
      if (isSdkError(error) && error.code === "invalid_hook_result") throw error;
      this.#setup.send({ type: "hook_error", hook, error: messageOf(error) });
      if (this.#continues) return { status: "skipped" };
      if (closed === undefined) throw new HookFailure(hook, error);
      return { status: "closed", value: closed(error) };
    }
  }
}
