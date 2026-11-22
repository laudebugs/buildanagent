/**
 * The step loop: one model call, then the tool calls it asked for, then the stop check, until a stop reason holds
 * (agent-SDK guide §3). The non-streaming result is built from the same run, so there is one loop for both modes.
 *
 * Each step runs transform → before → stream → after → tools → stop. Those moments are where the interceptors
 * plug in (D6); a run without interceptors sends the transcript as it stands and keeps each response unchanged.
 * Every outcome is a stop reason, never an exception: only a programmer error, such as a malformed tool result,
 * throws.
 */
import {
  type AssistantMessage,
  addCost,
  addUsage,
  type Cost,
  type DumpedOptions,
  emptyUsage,
  type GatewayEvent,
  MAX_RETRY_DELAY_MS,
  type Message,
  type Model,
  type ModelContext,
  projectCallCost,
  retryDelay,
  retryHintMs,
  type Sleep,
  type StreamOptions,
  type Usage,
  type WireTool,
} from "@buildanagent/gateway";
import { checkBudget, unknownPriceError } from "./budget.js";
import { isSdkError, SdkError } from "./errors.js";
import type { AgentEventBody } from "./events.js";
import type { StopVerdict } from "./hook-checks.js";
import { HookFailure, HookRunner } from "./hook-runner.js";
import type { CallOptions, Interceptors, ModelCallPatch } from "./hooks.js";
import type { ProgressCheck } from "./progress.js";
import type { RunError, RunResult } from "./result.js";
import { judgeOpenCalls, type ResumeSetup, type Verdict } from "./resume.js";
import type { SteeringQueue } from "./steering.js";
import type { Clock } from "./testing/determinism.js";
import { toWireTool } from "./tools/define.js";
import { type AnyTool, type PipelineContext, runToolCalls, type ToolCallResult } from "./tools/pipeline.js";
import type { ToolCall, ToolResult } from "./tools/types.js";
import type { SignedPendingRequest } from "./vendor/agent-safety/pending.js";
import type { ApprovalSigner } from "./vendor/agent-safety/signer.js";

/**
 * The cost of no model call: an exact zero. Its basis is `provider` because `addCost()` keeps the other cost's basis
 * when it adds a provider cost, so the zero never turns a billed sum into an estimate.
 */
const NO_COST: Cost = { total: 0, basis: "provider", currency: "USD" };

/** Everything one run needs, fixed when it starts. */
export interface LoopSetup {
  readonly runId: string;
  readonly model: Model;
  readonly system: string;
  /** The conversation before this run's own messages. */
  readonly history: readonly Message[];
  /** The messages the run starts by adding, such as the user's input. */
  readonly input: readonly Message[];
  /**
   * Every tool the run knows, in definition order. A request sends the ones whose exposure is `direct`, or the ones
   * `activeTools` names, and only the tools a request sent can run.
   */
  readonly tools: readonly AnyTool[];
  readonly output: AnyTool | undefined;
  readonly maxSteps: number;
  /** How many times the loop re-issues a model call that ended with a `retryable` error; 0 turns turn retries off. */
  readonly turnRetries: number;
  /** The wait before the first turn retry, in milliseconds; each later retry in a streak waits twice as long. */
  readonly turnRetryDelayMs: number;
  /** Waits between turn retries. */
  readonly sleep: Sleep;
  /** The most the run's model calls may cost, in USD, or `undefined` for no cap (D9). */
  readonly budgetUsd?: number;
  /** How deeply this run is nested inside other agents' tool calls, and the deepest nesting allowed (D11). */
  readonly depth: number;
  readonly maxDepth: number;
  /** The run and tool call that started this run, when a tool did; `run_start` carries them. */
  readonly parentRun?: { readonly runId: string; readonly callId: string };
  /** The caller's app data for the tools. It goes to no request, event or saved context. */
  readonly app?: unknown;
  readonly modelOptions: CallOptions;
  /** Whether each model call asks for the provider's raw events, which the run emits as `raw` events. */
  readonly includeRaw: boolean;
  readonly interceptors: Interceptors;
  /** The default progress policy, run after the caller's `shouldStop`, or `undefined` when it is off (D11). */
  readonly progress?: ProgressCheck;
  /** The messages a caller queued with `steer()` and `followUp()`, applied only at step boundaries. */
  readonly steering: SteeringQueue;
  readonly signal: AbortSignal;
  readonly clock: Clock;
  /** Signs the pending request of each call a gate asks about (D5). */
  readonly signer: ApprovalSigner;
  /** Makes each pending request's id. */
  readonly nextId: () => string;
  /** The waiting calls of the context a `continueRun()` resumes, and their resolutions. */
  readonly resume?: ResumeSetup;
}

/** Sends one event; the run adds the `EventBase` fields. */
export type Emit = (body: AgentEventBody, stepIndex: number) => void;

/**
 * Resolves once every observer has handled the events sent so far. The loop calls it only once it has its outcome,
 * and the run treats the first call as the point after which an abort no longer counts.
 */
export type Drain = () => Promise<void>;

/** How a run ended, before its usage, cost and messages are attached. */
type Outcome =
  | { readonly stopReason: "done"; readonly output: unknown }
  | { readonly stopReason: "max_steps" | "aborted" }
  | {
      readonly stopReason: "budget";
      readonly reason: string;
      readonly budgetUsd: number;
      readonly spentUsd: number;
      readonly projectedUsd: number;
    }
  | { readonly stopReason: "error"; readonly error: RunError }
  | { readonly stopReason: "stopped"; readonly stoppedBy: string }
  | { readonly stopReason: "no_progress"; readonly reason: string }
  | {
      readonly stopReason: "awaiting_approval" | "clarification_requested";
      readonly pending: readonly SignedPendingRequest[];
      readonly pendingInputs: Readonly<Record<string, unknown>>;
    };

/** What changes while a run goes on. */
class LoopState {
  readonly setup: LoopSetup;
  readonly emit: Emit;
  readonly messages: Message[];
  readonly added: Message[];
  readonly drain: Drain;
  readonly hooks: HookRunner;
  readonly #wire: ReadonlyMap<AnyTool, WireTool>;
  /** The tools the latest request sent; the tool calls of its response may run only these. */
  active: readonly AnyTool[] = [];
  steps = 0;
  stepIndex = 0;
  usage: Usage = emptyUsage();
  lastUsage: Usage | undefined;
  cost: Cost | undefined;
  output: unknown;
  /** Set when the run was kept going to deliver a follow-up, so the next step boundary applies the follow-ups too. */
  releaseFollowUps = false;
  /** Set when a retryable failure could have been retried but `maxSteps` left no room, so the run ends `max_steps`. */
  retryBlockedByMaxSteps = false;
  /** The signed requests of the calls that gates paused, in model order. */
  readonly pending: SignedPendingRequest[] = [];
  /**
   * The input each pending request signs, by request id. It has no prototype, because an id comes from the host's
   * `idGenerator` and `"__proto__"` must be stored as a key like any other.
   */
  readonly pendingInputs: Record<string, unknown> = Object.create(null);

  constructor(setup: LoopSetup, emit: Emit, drain: Drain) {
    this.setup = setup;
    this.emit = emit;
    this.drain = drain;
    this.messages = [...setup.history, ...setup.input];
    this.added = [...setup.input];
    this.#wire = new Map(setup.tools.map((tool) => [tool, toWireTool(tool)]));
    this.hooks = new HookRunner({
      interceptors: setup.interceptors,
      runId: setup.runId,
      signal: setup.signal,
      clock: setup.clock,
      stepIndex: () => this.stepIndex,
      send: (body) => this.send(body),
      signer: setup.signer,
      nextId: setup.nextId,
    });
  }

  /** The wire form of each of `tools`, as a request sends them. */
  wireOf(tools: readonly AnyTool[]): WireTool[] {
    // Every tool of the run was lowered in the constructor, and a request names only the run's tools.
    return tools.map((tool) => this.#wire.get(tool) as WireTool);
  }

  send(body: AgentEventBody): void {
    this.emit(body, this.stepIndex);
  }

  append(message: Message): void {
    this.messages.push(message);
    this.added.push(message);
  }
}

/**
 * The stream options a request event records: everything but the payload hook, the abort signal and the caps, as the
 * gateway's own request dump leaves them out. An untyped caller may still pass a signal or caps in `modelOptions`.
 */
function dumpedOptions(options: CallOptions): DumpedOptions {
  const { onPayload: _onPayload, signal: _signal, caps: _caps, ...rest } = options as StreamOptions;
  return rest;
}

/** Re-emits one model event as a run event, and returns the final message once the terminal event arrives. */
function forward(state: LoopState, event: GatewayEvent): AssistantMessage | undefined {
  switch (event.type) {
    case "done":
    case "error":
      return event.message;
    case "start":
      return undefined;
    case "raw":
      if (state.setup.includeRaw) state.send({ type: "raw", event: event.event });
      return undefined;
    case "retry":
      state.send({
        type: "retry",
        layer: "gateway",
        attempt: event.attempt,
        delayMs: event.delayMs,
        error: event.error,
      });
      return undefined;
    case "warning":
      state.send({ type: "warning", code: "model_warning", detail: `${event.code}: ${event.message}` });
      return undefined;
    case "text_start":
    case "reasoning_start":
    case "tool_input_start":
      state.send({ type: event.type, index: event.index });
      return undefined;
    case "text_delta":
    case "reasoning_delta":
    case "tool_input_delta":
      state.send({ type: event.type, index: event.index, delta: event.delta });
      return undefined;
    default:
      state.send({ type: event.type, index: event.index, block: event.block });
      return undefined;
  }
}

/** One model call as it will be sent, after `transformContext` and `beforeModelCall`. */
interface Request {
  readonly model: Model;
  readonly context: ModelContext;
  readonly options: CallOptions;
  readonly active: readonly AnyTool[];
}

/** The tools a request sends unless `beforeModelCall` names others: the ones whose exposure is `direct`. */
function directTools(tools: readonly AnyTool[]): AnyTool[] {
  return tools.filter((tool) => (tool.exposure ?? "direct") === "direct");
}

/** The tools `names` picks, in definition order whatever order `names` is in. */
function toolsNamed(tools: readonly AnyTool[], names: readonly string[]): AnyTool[] {
  const unknown = names.filter((name) => !tools.some((tool) => tool.name === name));
  if (unknown.length > 0) {
    throw new SdkError("invalid_hook_result", `activeTools names unknown tools: ${unknown.join(", ")}`);
  }
  return tools.filter((tool) => names.includes(tool.name));
}

function patched(state: LoopState, request: Request, patch: ModelCallPatch): Request {
  const active = patch.activeTools === undefined ? request.active : toolsNamed(state.setup.tools, patch.activeTools);
  const { system, messages } = request.context;
  return {
    model: patch.model ?? request.model,
    options: patch.options ?? request.options,
    active,
    context: {
      system: patch.system ?? system,
      messages: patch.messages === undefined ? messages : [...patch.messages],
      tools: state.wireOf(active),
    },
  };
}

/**
 * Builds one call's request: the transcript, or the view `transformContext` returns for this call alone, then the
 * changes `beforeModelCall` asks for. The run's own transcript is never replaced by either.
 */
async function buildRequest(state: LoopState): Promise<Request> {
  const { model, system, modelOptions, tools } = state.setup;
  const view = await state.hooks.transformContext({
    system,
    messages: state.messages,
    model: model.ref,
    lastUsage: state.lastUsage,
  });
  const active = directTools(tools);
  const context = { system, messages: [...(view ?? state.messages)], tools: state.wireOf(active) };
  const request: Request = { model, context, options: modelOptions, active };
  const patch = await state.hooks.beforeModelCall({ context, options: modelOptions });
  return patch === undefined ? request : patched(state, request, patch);
}

/**
 * The options one call sends: the request's, with `includeRaw` set by the run alone. With it off, the key is left
 * out, so the call's options are what they were before raw events existed.
 */
function sentOptions(state: LoopState, options: CallOptions): CallOptions & Pick<StreamOptions, "includeRaw"> {
  const { includeRaw: _ignored, ...rest } = options as StreamOptions;
  return state.setup.includeRaw ? { ...rest, includeRaw: true } : rest;
}

/** Streams one request, re-emitting its events, and returns the model's final message. */
async function streamRequest(state: LoopState, request: Request): Promise<AssistantMessage> {
  const { model, context } = request;
  const options = sentOptions(state, request.options);
  state.send({ type: "model_call_start", request: { model: model.ref, context, options: dumpedOptions(options) } });
  let message: AssistantMessage | undefined;
  for await (const event of model.stream(context, { ...options, signal: state.setup.signal })) {
    message = forward(state, event) ?? message;
  }
  if (message === undefined) {
    throw new SdkError("invalid_model_stream", "the model's stream ended without a done or error event");
  }
  return message;
}

/** Adds a model call's response to the transcript and reports it. */
function record(state: LoopState, message: AssistantMessage): void {
  state.append(message);
  state.send({ type: "model_call_end", message });
}

/**
 * What the transcript holds for a response whose `afterModelCall` failed while the run fails closed: no content, so a
 * check that crashed can't let the response through, but the call's usage and cost, which were billed. Its error stop
 * reason makes the replay pass skip it if the run is continued.
 */
function withheld(original: AssistantMessage): AssistantMessage {
  const { model, usage, cost, lastAttemptUsage } = original;
  return {
    role: "assistant",
    content: [],
    model,
    stopReason: "error",
    error: { kind: "fatal", message: "the response was withheld, because its afterModelCall check failed" },
    usage,
    ...(lastAttemptUsage === undefined ? {} : { lastAttemptUsage }),
    cost,
  };
}

/**
 * The budget check before a call (D9): the outcome that ends the run when the spend so far plus the call's projected
 * cost would pass `budgetUsd`, or `undefined` when the call may go out. It checks the request as it will be sent,
 * after the interceptors have changed it, and projects with the model the request names.
 */
function budgetBlock(state: LoopState, request: Request): Outcome | undefined {
  const { budgetUsd } = state.setup;
  if (budgetUsd === undefined) return undefined;
  const projected = projectCallCost(request.model, request.context, request.options);
  const verdict = checkBudget(budgetUsd, state.cost, projected);
  switch (verdict.kind) {
    case "allow":
      return undefined;
    case "unknown":
      return { stopReason: "error", error: verdict.error };
    case "exceeded":
      return {
        stopReason: "budget",
        reason: verdict.reason,
        budgetUsd,
        spentUsd: verdict.spentUsd,
        projectedUsd: verdict.projectedUsd,
      };
  }
}

/** Adds a finished model call's usage and cost to the run's totals, whether or not the loop goes on with its message. */
function account(state: LoopState, message: AssistantMessage): void {
  state.steps += 1;
  state.usage = addUsage(state.usage, message.usage);
  state.lastUsage = message.usage;
  state.cost = state.cost === undefined ? message.cost : addCost(state.cost, message.cost);
}

/**
 * Runs `afterModelCall` on a response the run goes on with and records it. The call's usage and cost are the model's
 * own message's, so a replacement changes what the run goes on with, never what it is billed. When `afterModelCall`
 * fails and the run fails closed, a withheld stand-in is recorded before the run ends, so the transcript and
 * `model_call_end` still account for the billed call and none of its tool calls run.
 */
async function accept(state: LoopState, original: AssistantMessage): Promise<AssistantMessage> {
  let message: AssistantMessage;
  try {
    message = await state.hooks.afterModelCall(original);
  } catch (error) {
    if (error instanceof HookFailure || (isSdkError(error) && error.code === "invalid_hook_result")) {
      record(state, withheld(original));
    }
    throw error;
  }
  record(state, message);
  return message;
}

/**
 * The wait before a turn retry of `failure`, or `undefined` when the call is not retried: turn retries are off or
 * used up, the failure is not `retryable`, the provider asked for longer than the gateway's cap, or the run was
 * aborted. A streak that would go on but for `maxSteps` sets `retryBlockedByMaxSteps`, so the run ends `max_steps`
 * instead of `error`: every attempt counts as a step, which keeps `maxSteps` the bound on the worst case. A first
 * failure on the last step has no streak to stop yet, so it ends the run `error` as it would without turn retries.
 */
function turnRetryDelay(state: LoopState, failure: AssistantMessage, streak: number): number | undefined {
  const { turnRetries, turnRetryDelayMs, maxSteps, signal } = state.setup;
  if (streak > turnRetries || failure.stopReason !== "error" || failure.error?.kind !== "retryable") return undefined;
  const hintMs = retryHintMs(failure);
  if (hintMs > MAX_RETRY_DELAY_MS || signal.aborted) return undefined;
  if (state.steps >= maxSteps) {
    state.retryBlockedByMaxSteps = streak > 1;
    return undefined;
  }
  return retryDelay(turnRetryDelayMs, streak, hintMs);
}

/** Waits before a turn retry. A caller's `sleep` that rejects ends the wait early instead of failing the run. */
async function retryWait(state: LoopState, delayMs: number): Promise<void> {
  try {
    await state.setup.sleep(delayMs, state.setup.signal);
  } catch (error) {
    state.send({ type: "hook_error", hook: "sleep", error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Makes one model call, streams its events and records the response. A call that ends with a `retryable` error is
 * made again while turn retries last: its `model_call_end` carries the failed message, which is not recorded in the
 * transcript, and a `retry` event with `layer: "turn"` marks it superseded before the wait. Each attempt builds its
 * own request, so the interceptors and the budget check see every one, and each counts as a step with its own
 * `step_start` and `step_end`. The budget is checked before the `retry` event too, with the failed attempt's request,
 * so a run that can't afford a retry, or whose spend became unknown, ends without announcing one: the failure stays
 * in the transcript, and the run ends `budget`, or `error` with the failure's own error.
 */
async function callModel(state: LoopState): Promise<AssistantMessage | { readonly blocked: Outcome }> {
  for (let streak = 1; ; streak += 1) {
    const request = await buildRequest(state);
    const blocked = budgetBlock(state, request);
    if (blocked !== undefined) return { blocked };
    state.active = request.active;
    const original = await streamRequest(state, request);
    const usageBefore = state.lastUsage;
    account(state, original);
    const delayMs = turnRetryDelay(state, original, streak);
    if (delayMs === undefined) return accept(state, original);
    const unaffordable = budgetBlock(state, request);
    if (unaffordable !== undefined) {
      const message = await accept(state, original);
      return unaffordable.stopReason === "budget" ? { blocked: unaffordable } : message;
    }
    state.send({ type: "model_call_end", message: original });
    // The failed message never joins the transcript, so its usage must not stand for the context's size.
    state.lastUsage = usageBefore;
    state.send({
      type: "retry",
      layer: "turn",
      attempt: streak,
      delayMs,
      error: original.error?.message ?? "retryable error",
    });
    await retryWait(state, delayMs);
    if (state.setup.signal.aborted) return { blocked: { stopReason: "aborted" } };
    // Each model call is a step with its own index, so the retry's events don't share the failed call's.
    state.send({ type: "step_end", stopCheck: "continue" });
    state.stepIndex = state.steps;
    state.send({ type: "step_start" });
    applySteering(state);
  }
}

/** The tool message the model reads for one call. */
function toolMessage(entry: ToolCallResult): Message {
  return {
    role: "tool",
    callId: entry.call.callId,
    content: [...entry.result.content],
    isError: entry.result.isError === true,
  };
}

/** Records one call's result: the tool message the model reads, the output tool's answer and `tool_call_end`. */
function recordResult(state: LoopState, entry: ToolCallResult): void {
  const { output } = state.setup;
  state.append(toolMessage(entry));
  if (output !== undefined && entry.call.name === output.name && entry.result.isError !== true) {
    state.output = entry.result.structured;
  }
  const ranWith = "input" in entry ? { input: entry.input } : {};
  state.send({ type: "tool_call_end", callId: entry.call.callId, result: entry.result, ...ranWith });
}

/** Holds a signed request for a person: in the run's pending list, by id in its inputs, and as `approval_request`. */
function holdPause(state: LoopState, request: SignedPendingRequest, input: unknown): void {
  state.pending.push(request);
  state.pendingInputs[request.id] = input;
  state.send({ type: "approval_request", request, input });
}

/** True for a result that asks the user a question, which pauses its call instead of reaching the model. */
function asksUser(result: ToolResult): boolean {
  return result.pause !== undefined && result.isError !== true;
}

/** The pipeline callbacks every tool batch of the run shares. `onResult` holds back a question for `askUser()`. */
function pipelineOf(state: LoopState, asks: ToolCallResult[]): PipelineContext {
  const { runId, signal, clock, depth, maxDepth, app } = state.setup;
  return {
    runId,
    signal,
    clock,
    depth,
    maxDepth,
    app,
    onStart: (call: ToolCall) =>
      state.send({ type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input }),
    onUpdate: (callId, details) => state.send({ type: "tool_call_update", callId, details }),
    onPause: ({ request, input }) => holdPause(state, request, input),
    onResult: (entry) => {
      if (asksUser(entry.result)) asks.push(entry);
      else recordResult(state, entry);
    },
  };
}

/**
 * Signs a clarification request for each call whose tool asked the user a question, in model order. The call then
 * waits like a paused one, with no result; a question that can't be signed reaches the model as an error result.
 * Returns the batch's results with those error results in place.
 */
async function askUser(
  state: LoopState,
  results: readonly ToolCallResult[],
  asks: readonly ToolCallResult[],
): Promise<ToolCallResult[]> {
  const replaced = new Map<ToolCallResult, ToolCallResult>();
  for (const entry of asks) {
    const question = entry.result.pause?.question;
    const outcome = await state.hooks.clarify(entry.call, entry.ranWith, question as string);
    if ("paused" in outcome) {
      holdPause(state, outcome.paused, outcome.input);
    } else if ("blocked" in outcome) {
      const blocked = { call: entry.call, result: outcome.blocked };
      recordResult(state, blocked);
      replaced.set(entry, blocked);
    }
  }
  return results.map((entry) => replaced.get(entry) ?? entry);
}

/** Runs the response's tool calls as the pipeline schedules them, recording each result in model order. */
async function runTools(state: LoopState, message: AssistantMessage): Promise<readonly ToolCallResult[]> {
  const asks: ToolCallResult[] = [];
  const results = await runToolCalls(message, state.active, {
    ...pipelineOf(state, asks),
    ...state.hooks.pipelineHooks(),
  });
  return asks.length === 0 ? results : askUser(state, results, asks);
}

/**
 * The outcome of a run whose calls wait for a person. Its requests are put in the model's order of their calls, and
 * it ends `awaiting_approval` when any waits for an approval, or `clarification_requested` when all wait for answers.
 */
function pausedOutcome(state: LoopState, message: AssistantMessage): Outcome {
  const order = callOrderOf(message);
  const pending = [...state.pending].sort((a, b) => order.indexOf(a.callId) - order.indexOf(b.callId));
  const approval = pending.some((request) => request.kind === "approval");
  return {
    stopReason: approval ? "awaiting_approval" : "clarification_requested",
    pending,
    pendingInputs: { ...state.pendingInputs },
  };
}

/** The failed call's error as the run reports it. A message without one counts as `fatal`. */
function runErrorOf(message: AssistantMessage): RunError {
  const error = message.error;
  if (error === undefined) return { kind: "fatal", message: "the model call failed without an error description" };
  return {
    kind: error.kind,
    message: error.message,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
  };
}

/**
 * The stop check after one step. A pause, including a question for the user, or a finished answer wins over an abort
 * that came too late to change it; otherwise an abort stops the run before the step cap does. A pause wins over a
 * finished answer too, because its call is still waiting. A text answer cut off at the output limit also counts as
 * finished: its message keeps `stopReason: "length"`.
 */
function stopCheck(
  state: LoopState,
  message: AssistantMessage,
  results: readonly ToolCallResult[],
): Outcome | undefined {
  if (message.stopReason === "error") {
    return state.retryBlockedByMaxSteps
      ? { stopReason: "max_steps" }
      : { stopReason: "error", error: runErrorOf(message) };
  }
  if (message.stopReason === "aborted") return { stopReason: "aborted" };
  // A paused call is still waiting, so the run can't count as finished, and the pause is signed and stored with the
  // context, so it outlasts an abort that came while the step's other calls ran.
  if (state.pending.length > 0) return pausedOutcome(state, message);
  const finished = results.length === 0 || results.some(({ result }) => result.terminate === true && !result.isError);
  if (finished) return { stopReason: "done", output: state.output };
  if (state.setup.signal.aborted) return { stopReason: "aborted" };
  if (state.steps >= state.setup.maxSteps) return { stopReason: "max_steps" };
  return undefined;
}

/**
 * What `shouldStop` changes about the stop check. A finished answer or an error stands whatever the hook says; the
 * hook can end a run that would go on, and can keep going a run the model ended by answering in text, until the
 * step cap.
 */
function withVerdict(state: LoopState, natural: Outcome | undefined, verdict: StopVerdict): Outcome | undefined {
  if (natural !== undefined && verdict.kind !== "continue") return natural;
  switch (verdict.kind) {
    case "stop":
      return { stopReason: "stopped", stoppedBy: verdict.stoppedBy };
    case "no_progress":
      return { stopReason: "no_progress", reason: verdict.reason };
    case "continue":
      if (natural === undefined) return undefined;
      if (state.steps >= state.setup.maxSteps) return { stopReason: "max_steps" };
      state.append({ role: "user", content: verdict.content });
      return undefined;
    default:
      return natural;
  }
}

/**
 * Applies the queued messages before a model call: every steer, and the follow-ups too once the run was kept going to
 * deliver them. Each becomes a user message and a `steer_applied` event, in the order it was sent, and its receipt
 * resolves with the index of the step about to run.
 */
function applySteering(state: LoopState): void {
  const { steering } = state.setup;
  const withFollowUps = state.releaseFollowUps;
  state.releaseFollowUps = false;
  for (const delivery of steering.take(withFollowUps)) {
    // A copy, so a caller who changes a receipt's message cannot change the transcript.
    state.append({ role: "user", content: delivery.message.map((block) => ({ ...block })) });
    state.send({ type: "steer_applied", receipt: delivery.deliver(state.stepIndex) });
  }
}

/**
 * Keeps a run that its model ended by answering going, when a message is waiting and the step cap leaves room for
 * one more call: a steer comes first, and follow-ups wait for the next time the run would end. Any other outcome
 * stands, as does a `stop` or `no_progress` verdict that `withVerdict` folded into `done`, and an abort that came
 * after the answer, which `stopCheck` lets the answer win over. The messages still waiting are rejected when the run
 * ends.
 */
function withQueued(state: LoopState, outcome: Outcome | undefined, verdict: StopVerdict): Outcome | undefined {
  const { steering, maxSteps, signal } = state.setup;
  if (outcome?.stopReason !== "done" || !steering.hasPending() || state.steps >= maxSteps) return outcome;
  if (verdict.kind === "stop" || verdict.kind === "no_progress" || signal.aborted) return outcome;
  state.releaseFollowUps = !steering.hasSteers();
  return undefined;
}

/** The stop check after one step, then the `shouldStop` hook where it may change it. */
async function decide(
  state: LoopState,
  message: AssistantMessage,
  results: readonly ToolCallResult[],
): Promise<Outcome | undefined> {
  const natural = stopCheck(state, message, results);
  const endedByAnswer = natural?.stopReason === "done" && results.length === 0;
  if (natural !== undefined && !endedByAnswer) return natural;
  const verdict = await state.hooks.shouldStop({ messages: state.messages, lastMessage: message });
  const judged = await withProgress(state, verdict);
  const outcome = withVerdict(state, natural, judged);
  return endedByAnswer ? withQueued(state, outcome, judged) : outcome;
}

/**
 * The caller's verdict, unless the progress policy finds the run stuck. A caller's own stop stands, and a caller's
 * `{ continue }` or failed hook can't keep a stuck run going.
 */
async function withProgress(state: LoopState, verdict: StopVerdict): Promise<StopVerdict> {
  if (verdict.kind === "stop" || verdict.kind === "no_progress" || state.setup.progress === undefined) return verdict;
  const reason = await state.setup.progress(state.messages);
  return reason === undefined ? verdict : { kind: "no_progress", reason };
}

/** The outcome of a hook that failed while the run fails closed. A failure caused by an abort ends the run aborted. */
function failedOutcome(state: LoopState, error: unknown): Outcome {
  if (!(error instanceof HookFailure)) throw error;
  if (state.setup.signal.aborted) return { stopReason: "aborted" };
  return { stopReason: "error", error: { kind: "hook", message: error.message } };
}

async function runStep(state: LoopState): Promise<Outcome | undefined> {
  state.stepIndex = state.steps;
  state.send({ type: "step_start" });
  let outcome: Outcome | undefined;
  try {
    applySteering(state);
    const called = await callModel(state);
    if ("blocked" in called) {
      outcome = called.blocked;
    } else {
      const results = await runTools(state, called);
      outcome = await decide(state, called, results);
    }
  } catch (error) {
    outcome = failedOutcome(state, error);
  }
  state.send({ type: "step_end", stopCheck: outcome === undefined ? "continue" : "stop" });
  return outcome;
}

/**
 * An aborted run's transcript ends with an assistant message whose `stopReason` is `"aborted"`. When tool results end
 * the transcript, because the abort came while tools ran or cut off a response that held tool calls, the loop
 * appends an empty one after them; the replay pass drops it before any request.
 */
function closeAborted(state: LoopState): void {
  const last = state.messages.at(-1);
  if (last?.role === "assistant" && last.stopReason === "aborted") return;
  state.append({
    role: "assistant",
    content: [],
    model: state.setup.model.ref,
    stopReason: "aborted",
    usage: emptyUsage(),
    cost: { ...NO_COST },
  });
}

function resultOf(state: LoopState, outcome: Outcome): RunResult {
  const pending =
    outcome.stopReason === "awaiting_approval" || outcome.stopReason === "clarification_requested"
      ? { pending: [...outcome.pending], pendingInputs: { ...outcome.pendingInputs } }
      : {};
  const base = {
    messages: state.added,
    context: { system: state.setup.system, messages: state.messages, ...pending },
    usage: state.usage,
    cost: state.cost ?? { ...NO_COST },
    steps: state.steps,
  };
  return { ...base, ...outcome } as RunResult;
}

/**
 * Ends the run: the settle event comes once every observer has seen what came before it, and `run_end` after that.
 * An observer's failure while handling `agent_settled` is reported between the two; one while handling `run_end` is
 * dropped, so `run_end` stays the last event. The result is returned only once observers have seen it.
 */
async function finish(state: LoopState, outcome: Outcome): Promise<RunResult> {
  if (outcome.stopReason === "aborted") closeAborted(state);
  if (outcome.stopReason === "max_steps") {
    state.send({ type: "warning", code: "max_steps", detail: `the run reached maxSteps (${state.setup.maxSteps})` });
  }
  if (outcome.stopReason === "error") state.send({ type: "error", error: outcome.error });
  await state.drain();
  state.send({ type: "agent_settled" });
  await state.drain();
  const result = resultOf(state, outcome);
  state.send({ type: "run_end", result });
  await state.drain();
  return result;
}

/** The synthetic response that holds `calls`, so the pipeline runs them as one batch of the resumed message. */
function batchOf(message: AssistantMessage, calls: readonly ToolCall[]): AssistantMessage {
  return { ...message, content: [...calls], stopReason: "tool_calls" };
}

/** The call ids of `message`'s tool calls, in model order. */
function callOrderOf(message: AssistantMessage): string[] {
  return message.content.flatMap((block) => (block.type === "tool_call" ? [block.callId] : []));
}

/**
 * Puts the tool messages `list` gained from `from` on in the model's order of their calls, as a step records them.
 * A resume settles its calls by verdict, so without this a denial could come before an approval the model made first.
 */
function inModelOrder(list: Message[], from: number, order: readonly string[]): void {
  const rank = (entry: Message) => (entry.role === "tool" ? order.indexOf(entry.callId) : order.length);
  const tail = list.splice(from).sort((a, b) => rank(a) - rank(b));
  list.push(...tail);
}

/**
 * Acts on the verdicts for a resumed context's waiting calls, before the run's first model call, which none of this
 * counts as, and records their results in the model's order. Returns the paused outcome when any call still waits,
 * and `done` when none does and an approved call's result ends the run, as `terminate` does in a step.
 */
async function resume(state: LoopState, setup: ResumeSetup): Promise<Outcome | undefined> {
  const { message } = setup;
  const from = { messages: state.messages.length, added: state.added.length };
  try {
    return await settle(state, setup);
  } finally {
    if (message !== undefined) {
      const order = callOrderOf(message);
      inModelOrder(state.messages, from.messages, order);
      inModelOrder(state.added, from.added, order);
    }
  }
}

/**
 * Verified answers and denials reach the model as results; verified approvals run, without the gate, with the input
 * their requests sign; requests that still wait stay pending; and calls whose checks failed ask again, through the
 * gate but never running.
 */
async function settle(state: LoopState, setup: ResumeSetup): Promise<Outcome | undefined> {
  const { signer } = state.setup;
  state.hooks.reserveRequestIds(setup.open.map((entry) => entry.request.id));
  const verdicts = await judgeOpenCalls(setup, { signer, send: (body) => state.send(body) });
  const of = <K extends Verdict["kind"]>(kind: K) =>
    verdicts.filter((verdict): verdict is Extract<Verdict, { kind: K }> => verdict.kind === kind);
  for (const { call, result } of of("result")) {
    state.send({ type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input });
    recordResult(state, { call, result });
  }
  const asks: ToolCallResult[] = [];
  const { message } = setup;
  if (message === undefined) return undefined;
  const run = of("run").map((verdict) => verdict.call);
  let ran: readonly ToolCallResult[] = [];
  if (run.length > 0) {
    const { after } = state.hooks.pipelineHooks();
    const ctx = { ...pipelineOf(state, asks), approved: true, ...(after === undefined ? {} : { after }) };
    // A verified request names its tool, and the run signed it only for a call to a tool its request had sent.
    const results = await runToolCalls(batchOf(message, run), state.setup.tools, ctx);
    ran = asks.length > 0 ? await askUser(state, results, asks) : results;
  }
  for (const { request, input } of of("wait")) {
    state.pending.push(request);
    state.pendingInputs[request.id] = input;
  }
  const again = of("reissue").map((verdict) => verdict.call);
  if (again.length > 0) {
    const ctx = { ...pipelineOf(state, asks), gate: state.hooks.reissueGate() };
    // Nothing verified these calls, so only the tools a request sends by default may ask again: a stored context
    // can't get a new signed request for a tool the model is never sent.
    await runToolCalls(batchOf(message, again), directTools(state.setup.tools), ctx);
  }
  if (state.pending.length > 0) return pausedOutcome(state, message);
  const ends = ran.some(({ result }) => result.terminate === true && !result.isError);
  return ends ? { stopReason: "done", output: state.output } : undefined;
}

/** `resume()`, with a hook that failed while the run fails closed ending the run as a step's failure would. */
async function resumeOrFail(state: LoopState, setup: ResumeSetup): Promise<Outcome | undefined> {
  try {
    return await resume(state, setup);
  } catch (error) {
    return failedOutcome(state, error);
  }
}

/**
 * Runs the loop to a stop reason and returns the result. It throws only for a programmer error, after the results
 * already received are in the transcript.
 */
export async function runLoop(setup: LoopSetup, emit: Emit, drain: Drain): Promise<RunResult> {
  const state = new LoopState(setup, emit, drain);
  // A budget needs a price to check against, so a model without one is refused before it is called (D4).
  const refused = setup.budgetUsd === undefined ? undefined : unknownPriceError(setup.model);
  let outcome: Outcome | undefined = refused === undefined ? undefined : { stopReason: "error", error: refused };
  try {
    if (outcome === undefined && setup.resume !== undefined) outcome = await resumeOrFail(state, setup.resume);
    while (outcome === undefined) {
      outcome = setup.signal.aborted ? { stopReason: "aborted" } : await runStep(state);
    }
  } finally {
    // The run has its outcome, or threw for a programmer error, so a message still waiting can no longer reach a
    // model call, and its receipt must not hang.
    setup.steering.close();
  }
  return finish(state, outcome);
}
