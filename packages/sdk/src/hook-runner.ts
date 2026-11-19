/**
 * Runs the interceptors for one run: builds each hook's frozen event, applies the failure policy, checks what the
 * hook returned and emits `hook_error` and `context_transformed`. The loop and the tool pipeline call it at each
 * moment and never look at the hooks themselves.
 *
 * Failure policy (D6): a hook that throws is reported as a `hook_error` event. Under `fail_closed`, the default, a
 * failed gate denies its call, a failed `afterToolCall` withholds the result, and any other failed hook throws a
 * `HookFailure`, which the loop turns into an `error` result. Under `continue` the failed hook is skipped.
 *
 * A gate's `ask` pauses its call (D5): the runner signs a pending request through the one signing path, over the
 * input the call would run with, and hands the request and that input to the pipeline, which reports the pause once
 * every call of the step has been gated. A pause that can't be signed never pauses unsigned: the call is blocked
 * instead, whatever `onFailure` says.
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
import { signPause } from "./pauses.js";
import type { Clock } from "./testing/determinism.js";
import { preparedSchemaOf } from "./tools/define.js";
import { type AnyTool, type GateOutcome, isContentList, type PipelineContext } from "./tools/pipeline.js";
import type { ToolCall, ToolResult } from "./tools/types.js";
import { isSafetyError, type SafetyErrorCode } from "./vendor/agent-safety/errors.js";
import type { SignedPendingRequest } from "./vendor/agent-safety/pending.js";
import type { ApprovalSigner } from "./vendor/agent-safety/signer.js";

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
  /** Signs the pending request a gate's `ask` writes. */
  readonly signer: ApprovalSigner;
  /** Makes each pending request's id. */
  readonly nextId: () => string;
}

/** The decision of a gate that asks for a person. */
type AskDecision = Extract<GateDecision, { decision: "ask" }>;

function blocked(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], isError: true, details };
}

/** The pipeline hooks that the interceptors fill, left out when no interceptor needs them. */
export type PipelineHooks = Pick<PipelineContext, "gate" | "after">;

function gateOutcome(tool: string, decision: Exclude<GateDecision, AskDecision>): GateOutcome | undefined {
  if (decision.decision === "allow")
    return decision.input === undefined ? undefined : { input: thawedCopy(decision.input) };
  return { blocked: blocked(`Tool call "${tool}" was denied: ${decision.reason}`, { decision: "deny" }) };
}

const SAFETY_CODES: readonly string[] = [
  "invalid_outcome",
  "invalid_input",
  "invalid_key_ring",
  "invalid_pending",
] satisfies readonly SafetyErrorCode[];

/**
 * Why a pause could not be signed, as reports may show it: one of the safety package's error codes, or a fixed word.
 * A custom signer's own text is never passed on, because nothing stops it from quoting key material, and that holds
 * for a `code` too: any object can carry the safety error's marker, so only a known code is trusted.
 */
function unsignedCause(error: unknown): string {
  return isSafetyError(error) && SAFETY_CODES.includes(error.code) ? error.code : "signer_failed";
}

/** Runs one run's interceptors. */
export class HookRunner {
  readonly #setup: HookRunnerSetup;
  readonly #hooks: Interceptors;
  readonly #continues: boolean;
  readonly #requestIds = new Set<string>();

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
    if (guarded.status === "closed") return guarded.value;
    const decision = checkDecision(guarded.value);
    return decision.decision === "ask"
      ? this.#pause(call, tool, input.input, decision)
      : gateOutcome(tool.name, decision);
  }

  /**
   * Signs the pending request for a call a gate asked about and returns it with the input it signs. That input is the
   * one the call would run with: the checked input the gate saw, or the `ask`'s own replacement, which must pass the
   * tool's schema like an `allow`'s. If signing fails, the call is blocked: a pause that no signature covers is never
   * written.
   */
  async #pause(call: ToolCall, tool: AnyTool, seen: unknown, decision: AskDecision): Promise<GateOutcome> {
    const { signer, clock } = this.#setup;
    const { reason, policyVersion } = decision;
    const input = thawedCopy(decision.input === undefined ? seen : await this.#replacement(tool, decision.input));
    let request: SignedPendingRequest;
    try {
      request = await signPause(
        {
          kind: "approval",
          callId: call.callId,
          tool: tool.name,
          input,
          ...(policyVersion === undefined ? {} : { policyVersion }),
          // Display text only, so a blank reason is left out rather than failing the signature.
          ...(reason === undefined || reason === "" ? {} : { reason }),
        },
        signer,
        { generateId: () => this.#requestId(), now: () => new Date(clock.now()) },
      );
    } catch (error) {
      return this.#unsigned(tool.name, unsignedCause(error));
    }
    // A resolution names its request by id, so two pending requests of one run must never share one.
    if (this.#requestIds.has(request.id)) return this.#unsigned(tool.name, "duplicate_request_id");
    this.#requestIds.add(request.id);
    return { paused: request, input };
  }

  /**
   * The next request id from the run's `idGenerator`. A generator that repeats an id, such as one that always returns
   * a session id, was enough for a run id alone, so a repeat of the run id or of an earlier request's id falls back to
   * a random UUID instead of blocking the call.
   */
  #requestId(): string {
    const id = this.#setup.nextId();
    return id === this.#setup.runId || this.#requestIds.has(id) ? globalThis.crypto.randomUUID() : id;
  }

  /**
   * An `ask`'s replacement input, checked against the tool's schema, because a call must never run with input its own
   * tool would reject.
   */
  async #replacement(tool: AnyTool, input: unknown): Promise<unknown> {
    const checked = await preparedSchemaOf(tool).validate(input);
    if (checked.ok) return checked.value;
    const issues = checked.issues.map((issue) => `${issue.path} ${issue.message}`.trim()).join("; ");
    throw new SdkError(
      "invalid_hook_result",
      `beforeToolCall asked about tool "${tool.name}" with an input its schema rejects: ${issues}`,
    );
  }

  /** Blocks a call whose pause could not be signed, and reports why without the signer's own message. */
  #unsigned(tool: string, cause: string): GateOutcome {
    this.#setup.send({
      type: "hook_error",
      hook: "signer",
      error: `the approval request could not be signed (${cause})`,
    });
    const text = `Tool call "${tool}" needs approval, but its approval request could not be signed, so it was not run.`;
    return { blocked: blocked(text, { decision: "ask", error: cause }) };
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
