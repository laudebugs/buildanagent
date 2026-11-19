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
  type Message,
  type Model,
  type ModelContext,
  projectCallCost,
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
import type { SteeringQueue } from "./steering.js";
import type { Clock } from "./testing/determinism.js";
import { toWireTool } from "./tools/define.js";
import { type AnyTool, runToolCalls, type ToolCallResult } from "./tools/pipeline.js";
import type { ToolCall } from "./tools/types.js";
import type { SignedPendingRequest } from "./vendor/agent-safety/pending.js";
import type { ApprovalSigner } from "./vendor/agent-safety/signer.js";

/** The `stoppedBy` of a run that a clarification tool stopped. */
const CLARIFICATION = "clarification";

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
  /** The most the run's model calls may cost, in USD, or `undefined` for no cap (D9). */
  readonly budgetUsd?: number;
  /** How deeply this run is nested inside other agents' tool calls, and the deepest nesting allowed (D11). */
  readonly depth: number;
  readonly maxDepth: number;
  readonly modelOptions: CallOptions;
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
  | { readonly stopReason: "awaiting_approval"; readonly pending: readonly SignedPendingRequest[] };

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
  /** The signed requests of the calls that gates paused, in model order. */
  readonly pending: SignedPendingRequest[] = [];

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
      onPause: (request) => this.pending.push(request),
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
    case "retry":
      state.send({ type: "retry", attempt: event.attempt, delayMs: event.delayMs, error: event.error });
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

/** Streams one request, re-emitting its events, and returns the model's final message. */
async function streamRequest(state: LoopState, request: Request): Promise<AssistantMessage> {
  const { model, context, options } = request;
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

/**
 * Makes one model call, streams its events and records the response. The call's usage and cost are the model's own
 * message's, so an `afterModelCall` replacement changes what the run goes on with, never what it is billed. When
 * `afterModelCall` fails and the run fails closed, a withheld stand-in is recorded before the run ends, so the
 * transcript and `model_call_end` still account for the billed call and none of its tool calls run.
 */
async function callModel(state: LoopState): Promise<AssistantMessage | { readonly blocked: Outcome }> {
  const request = await buildRequest(state);
  const blocked = budgetBlock(state, request);
  if (blocked !== undefined) return { blocked };
  state.active = request.active;
  const original = await streamRequest(state, request);
  state.steps += 1;
  state.usage = addUsage(state.usage, original.usage);
  state.lastUsage = original.usage;
  state.cost = state.cost === undefined ? original.cost : addCost(state.cost, original.cost);
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

/** The tool message the model reads for one call. */
function toolMessage(entry: ToolCallResult): Message {
  return {
    role: "tool",
    callId: entry.call.callId,
    content: [...entry.result.content],
    isError: entry.result.isError === true,
  };
}

/** Runs the response's tool calls as the pipeline schedules them, recording each result in model order. */
async function runTools(state: LoopState, message: AssistantMessage): Promise<readonly ToolCallResult[]> {
  const { runId, signal, clock, output } = state.setup;
  return runToolCalls(message, state.active, {
    runId,
    signal,
    clock,
    depth: state.setup.depth,
    maxDepth: state.setup.maxDepth,
    ...state.hooks.pipelineHooks(),
    onStart: (call: ToolCall) =>
      state.send({ type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input }),
    onUpdate: (callId, details) => state.send({ type: "tool_call_update", callId, details }),
    onResult: (entry) => {
      state.append(toolMessage(entry));
      if (output !== undefined && entry.call.name === output.name && entry.result.isError !== true) {
        state.output = entry.result.structured;
      }
      const ranWith = "input" in entry ? { input: entry.input } : {};
      state.send({ type: "tool_call_end", callId: entry.call.callId, result: entry.result, ...ranWith });
    },
  });
}

/** The failed call's error as the run reports it. A message without one counts as `fatal`. */
function runErrorOf(message: AssistantMessage): RunError {
  const error = message.error;
  if (error === undefined) return { kind: "fatal", message: "the model call failed without an error description" };
  return { kind: error.kind, message: error.message, ...(error.status === undefined ? {} : { status: error.status }) };
}

/**
 * The stop check after one step. A pause, a finished answer or a question for the user wins over an abort that came
 * too late to change it; otherwise an abort stops the run before the step cap does. A pause wins over a finished
 * answer too, because its call is still waiting. A text answer cut off at the output limit
 * also counts as finished: its message keeps `stopReason: "length"`.
 */
function stopCheck(
  state: LoopState,
  message: AssistantMessage,
  results: readonly ToolCallResult[],
): Outcome | undefined {
  if (message.stopReason === "error") return { stopReason: "error", error: runErrorOf(message) };
  if (message.stopReason === "aborted") return { stopReason: "aborted" };
  // A paused call is still waiting, so the run can't count as finished, and the pause is signed and stored with the
  // context, so it outlasts an abort that came while the step's other calls ran.
  if (state.pending.length > 0) return { stopReason: "awaiting_approval", pending: [...state.pending] };
  const finished = results.length === 0 || results.some(({ result }) => result.terminate === true && !result.isError);
  if (finished) return { stopReason: "done", output: state.output };
  // Until runs can pause for an answer, a clarification question stops the run, so the model never goes on as if the
  // user had been asked and answered.
  if (results.some(({ result }) => result.pause !== undefined && !result.isError)) {
    return { stopReason: "stopped", stoppedBy: CLARIFICATION };
  }
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
  const pending = outcome.stopReason === "awaiting_approval" ? { pending: [...outcome.pending] } : {};
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
