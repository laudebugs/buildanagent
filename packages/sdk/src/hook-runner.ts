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
 * every call of the step has been gated. Under `blockingApprovals()` the runner instead emits the request, waits for
 * the handler's answer, checks it against the request, and allows or denies the call. A tool's clarification question
 * is signed through the same path. A pause that can't be signed never pauses unsigned: the call is blocked instead,
 * whatever `onFailure` says.
 */
import type { AssistantMessage, Message, ModelContext, ModelRef, Usage } from "@buildanagent/gateway";
import { isHashable } from "./app-data.js";
import { fillTemplate, SDK_DEFAULTS } from "./defaults.js";
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
import { type ApprovalHandler, blockingHandlerOf, signPause } from "./pauses.js";
import type { Clock } from "./testing/determinism.js";
import { preparedSchemaOf } from "./tools/define.js";
import { type AnyTool, type GateOutcome, isContentList, type PipelineContext } from "./tools/pipeline.js";
import type { ToolCall, ToolResult } from "./tools/types.js";
import { isSafetyError, type SafetyErrorCode } from "./vendor/agent-safety/errors.js";
import {
  type PendingFields,
  type Resolution,
  type SignedPendingRequest,
  verifyResolution,
} from "./vendor/agent-safety/pending.js";
import type { ApprovalSigner } from "./vendor/agent-safety/signer.js";

const APPROVALS = SDK_DEFAULTS.approvals;

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
  /** The run's app data, which each pending request binds with a MAC; `undefined` without app data. */
  readonly app?: unknown;
  /** Makes each pending request's id. */
  readonly nextId: () => string;
}

/** The decision of a gate that asks for a person. */
type AskDecision = Extract<GateDecision, { decision: "ask" }>;

function blocked(text: string, details: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], isError: true, details };
}

/**
 * A resolution's optional `reason` or `by`, kept only when it is a string. A resolution comes unchecked from the
 * host's store or handler, so any other value is dropped rather than shown to the model as `null` or `[object Object]`.
 */
export function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The error result of a call a person denied, with their reason when they gave one. */
export function denied(
  tool: string,
  reason: string | undefined,
  requestId: string,
  by: string | undefined,
): ToolResult {
  const text =
    reason === undefined || reason === ""
      ? fillTemplate(APPROVALS.deniedByApprover, { tool })
      : fillTemplate(APPROVALS.denied, { tool, reason });
  return blocked(text, { decision: "deny", requestId, ...(by === undefined ? {} : { by }) });
}

/** The pipeline hooks that the interceptors fill, left out when no interceptor needs them. */
export type PipelineHooks = Pick<PipelineContext, "gate" | "after">;

function gateOutcome(tool: string, decision: Exclude<GateDecision, AskDecision>): GateOutcome | undefined {
  if (decision.decision === "allow")
    return decision.input === undefined ? undefined : { input: thawedCopy(decision.input) };
  return { blocked: blocked(fillTemplate(APPROVALS.denied, { tool, reason: decision.reason }), { decision: "deny" }) };
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

/** Resolves to `ABORTED` once `signal` fires, or to what `promise` resolves to if that comes first. */
const ABORTED = Symbol("aborted");
async function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  let stop: (() => void) | undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    stop = () => resolve(ABORTED);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (stop !== undefined) signal.removeEventListener("abort", stop);
  }
}

/** Runs one run's interceptors. */
export class HookRunner {
  readonly #setup: HookRunnerSetup;
  readonly #hooks: Interceptors;
  readonly #continues: boolean;
  readonly #requestIds = new Set<string>();
  readonly #blocking: ApprovalHandler | undefined;

  constructor(setup: HookRunnerSetup) {
    this.#setup = setup;
    this.#hooks = setup.interceptors;
    this.#continues = (setup.interceptors.onFailure ?? SDK_DEFAULTS.run.onFailure) === "continue";
    this.#blocking = blockingHandlerOf(setup.interceptors);
  }

  /**
   * Marks request ids that already wait in the context a `continueRun()` started from, so a request this run signs
   * never takes one of them.
   */
  reserveRequestIds(ids: Iterable<string>): void {
    for (const id of ids) this.#requestIds.add(id);
  }

  /**
   * The gate `continueRun()` puts in front of a call whose stored request failed its check: the run's own gate is
   * asked as for a new call, but the call never runs. A deny still blocks it and an `ask` pauses it as usual, and an
   * `allow`, or no gate at all, pauses it too, with a new request over the input the gate allowed.
   */
  reissueGate(): NonNullable<PipelineContext["gate"]> {
    return async (e) => {
      // A call asked again never blocks on a handler: its new request is returned with the context.
      const outcome = this.#hooks.beforeToolCall === undefined ? undefined : await this.#gate(e, false);
      if (outcome !== undefined && ("blocked" in outcome || "paused" in outcome)) return outcome;
      const input = outcome === undefined ? e.input : outcome.input;
      return this.#sign(
        e.tool.name,
        { kind: "approval", callId: e.call.callId, tool: e.tool.name, input, reason: APPROVALS.reissuedReason },
        input,
      );
    };
  }

  /**
   * Signs the clarification request of a call whose tool asked the user `question`, over the input the tool ran
   * with. A question that can't be signed blocks the call, as an approval does.
   */
  clarify(call: ToolCall, input: unknown, question: string): Promise<GateOutcome> {
    return this.#sign(
      call.name,
      { kind: "clarification", callId: call.callId, tool: call.name, input, question },
      input,
    );
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

  async #gate(
    input: { call: ToolCall; tool: AnyTool; input: unknown },
    block = true,
  ): Promise<GateOutcome | undefined> {
    const hook = this.#hooks.beforeToolCall;
    if (hook === undefined) return undefined;
    const { call, tool } = input;
    const event = this.#event({ callId: call.callId, tool: tool.name, input: input.input }, call.callId);
    const failed = (error: unknown): GateOutcome => ({
      blocked: blocked(fillTemplate(APPROVALS.gateFailed, { tool: tool.name }), {
        hook: "beforeToolCall",
        error: messageOf(error),
      }),
    });
    const guarded = await this.#guard("beforeToolCall", () => hook(event), failed);
    if (guarded.status === "skipped") return undefined;
    if (guarded.status === "closed") return guarded.value;
    const decision = checkDecision(guarded.value);
    return decision.decision === "ask"
      ? this.#pause(call, tool, input.input, decision, block)
      : gateOutcome(tool.name, decision);
  }

  /**
   * Signs the pending request for a call a gate asked about and returns it with the input it signs. That input is the
   * one the call would run with: the checked input the gate saw, or the `ask`'s own replacement, which must pass the
   * tool's schema like an `allow`'s. If signing fails, the call is blocked: a pause that no signature covers is never
   * written. Under `blockingApprovals()`, the request is emitted and answered here instead.
   */
  async #pause(
    call: ToolCall,
    tool: AnyTool,
    seen: unknown,
    decision: AskDecision,
    block: boolean,
  ): Promise<GateOutcome | undefined> {
    const { reason, policyVersion } = decision;
    const input = thawedCopy(decision.input === undefined ? seen : await this.#replacement(tool, decision.input));
    const fields: PendingFields = {
      kind: "approval",
      callId: call.callId,
      tool: tool.name,
      input,
      ...(policyVersion === undefined ? {} : { policyVersion }),
      // Display text only, so a blank reason is left out rather than failing the signature.
      ...(reason === undefined || reason === "" ? {} : { reason }),
    };
    const outcome = await this.#sign(tool.name, fields, input);
    if (!block || this.#blocking === undefined || !("paused" in outcome)) return outcome;
    return this.#waitFor(this.#blocking, call, tool.name, outcome.paused, input, decision.input === undefined);
  }

  /** Signs one pending request through the one signing path, or blocks the call when it can't be signed. */
  async #sign(tool: string, fields: PendingFields, input: unknown): Promise<GateOutcome> {
    const { signer, clock } = this.#setup;
    let request: SignedPendingRequest;
    const { app } = this.#setup;
    // An app with no canonical JSON form can't be bound. The error is not passed on, because it can quote the app.
    if (app !== undefined && !isHashable(app)) return this.#unsigned(tool, "app_unhashable");
    try {
      request = await signPause(app === undefined ? fields : { ...fields, app }, signer, {
        generateId: () => this.#requestId(),
        now: () => new Date(clock.now()),
      });
    } catch (error) {
      return this.#unsigned(tool, unsignedCause(error));
    }
    // A resolution names its request by id, so two pending requests of one run must never share one.
    if (this.#requestIds.has(request.id)) return this.#unsigned(tool, "duplicate_request_id");
    this.#requestIds.add(request.id);
    return { paused: request, input };
  }

  /**
   * The blocking form of a pause: emit the signed request, wait for the handler, and check its answer against the
   * request before the call may run. Every failure denies the call; nothing here lets it run unanswered.
   */
  async #waitFor(
    handler: ApprovalHandler,
    call: ToolCall,
    tool: string,
    request: SignedPendingRequest,
    input: unknown,
    unchanged: boolean,
  ): Promise<GateOutcome | undefined> {
    const { signal, signer } = this.#setup;
    this.#setup.send({ type: "approval_request", request, input });
    const refuse = (why: string, error: string): GateOutcome => {
      this.#setup.send({ type: "hook_error", hook: "blockingApprovals", error });
      return {
        blocked: blocked(fillTemplate(APPROVALS.refused, { tool, why }), {
          decision: "ask",
          requestId: request.id,
        }),
      };
    };
    let answer: unknown;
    try {
      answer = await unlessAborted(Promise.resolve(handler(request, Object.freeze({ input, signal }))), signal);
    } catch (error) {
      return refuse(APPROVALS.handlerFailed, messageOf(error));
    }
    if (answer === ABORTED) {
      const text = fillTemplate(APPROVALS.abortedWhileWaiting, { tool });
      return { blocked: blocked(text, { decision: "ask", requestId: request.id }) };
    }
    let check: Awaited<ReturnType<typeof verifyResolution>>;
    try {
      const { app } = this.#setup;
      check = await verifyResolution(request, answer as Resolution, {
        signer,
        call: { callId: call.callId, tool, input },
        ...(app === undefined ? {} : { app }),
      });
    } catch {
      // A custom signer whose verify() throws fails the check; its message may hold anything, so it isn't passed on.
      return refuse(APPROVALS.unverified, "the approval was refused (error)");
    }
    if (!check.ok) return refuse(APPROVALS.unverified, `the approval was refused (${check.cause})`);
    const resolution = check.resolution;
    // An unchanged input is the checked one the gate saw, which the pipeline runs as it is; a replacement is passed on.
    if ("decision" in resolution && resolution.decision === "allow") return unchanged ? undefined : { input };
    const reason = "reason" in resolution ? textOf(resolution.reason) : undefined;
    return { blocked: denied(tool, reason, request.id, textOf(resolution.by)) };
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
    const text = fillTemplate(APPROVALS.unsigned, { tool });
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
      ...blocked(fillTemplate(APPROVALS.resultWithheld, { tool: tool.name }), {
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
