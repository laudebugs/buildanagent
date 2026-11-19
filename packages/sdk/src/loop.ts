/**
 * The step loop: one model call, then the tool calls it asked for, then the stop check, until a stop reason holds
 * (agent-SDK guide §3). The non-streaming result is built from the same run, so there is one loop for both modes.
 *
 * Each step runs transform → before → stream → after → tools → stop. The transform, before and after moments are
 * where the interceptors plug in (D6); until they exist the request is the transcript as it stands and the response
 * is kept unchanged. Every outcome is a stop reason, never an exception: only a programmer error, such as a malformed
 * tool result, throws.
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
  type ModelCallOptions,
  type ModelContext,
  type Usage,
  type WireTool,
} from "@buildanagent/gateway";
import { SdkError } from "./errors.js";
import type { AgentEventBody } from "./events.js";
import type { RunError, RunResult } from "./result.js";
import type { Clock } from "./testing/determinism.js";
import { toWireTool } from "./tools/define.js";
import { type AnyTool, runToolCalls, type ToolCallResult } from "./tools/pipeline.js";
import type { ToolCall } from "./tools/types.js";

// The depth cap's defaults (D11). Nested runs pass their own depth once the depth cap is configurable.
const TOP_LEVEL_DEPTH = 0;
const DEFAULT_MAX_DEPTH = 2;

/** The cost of a run that made no model call. */
const NO_COST: Cost = { total: 0, basis: "catalog", currency: "USD" };

/** Everything one run needs, fixed when it starts. */
export interface LoopSetup {
  readonly runId: string;
  readonly model: Model;
  readonly system: string;
  /** The conversation before this run's own messages. */
  readonly history: readonly Message[];
  /** The messages the run starts by adding, such as the user's input. */
  readonly input: readonly Message[];
  /** The tools the model is sent, in definition order; only these can run. */
  readonly tools: readonly AnyTool[];
  readonly output: AnyTool | undefined;
  readonly maxSteps: number;
  readonly modelOptions: Omit<ModelCallOptions, "signal">;
  readonly signal: AbortSignal;
  readonly clock: Clock;
}

/** Sends one event; the run adds the `EventBase` fields. */
export type Emit = (body: AgentEventBody, stepIndex: number) => void;

/** How a run ended, before its usage, cost and messages are attached. */
type Outcome =
  | { readonly stopReason: "done"; readonly output: unknown }
  | { readonly stopReason: "max_steps" | "aborted" }
  | { readonly stopReason: "error"; readonly error: RunError };

/** What changes while a run goes on. */
class LoopState {
  readonly setup: LoopSetup;
  readonly emit: Emit;
  readonly messages: Message[];
  readonly added: Message[];
  readonly wireTools: WireTool[];
  steps = 0;
  stepIndex = 0;
  usage: Usage = emptyUsage();
  cost: Cost | undefined;
  output: unknown;

  constructor(setup: LoopSetup, emit: Emit) {
    this.setup = setup;
    this.emit = emit;
    this.messages = [...setup.history, ...setup.input];
    this.added = [...setup.input];
    this.wireTools = setup.tools.map(toWireTool);
  }

  send(body: AgentEventBody): void {
    this.emit(body, this.stepIndex);
  }

  append(message: Message): void {
    this.messages.push(message);
    this.added.push(message);
  }
}

/** The stream options a request event records: everything but the payload hook, which is a function. */
function dumpedOptions(options: Omit<ModelCallOptions, "signal">): DumpedOptions {
  const { onPayload: _onPayload, ...rest } = options;
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

/** Makes one model call, streams its events and records the response. */
async function callModel(state: LoopState): Promise<AssistantMessage> {
  const { model, system, modelOptions, signal } = state.setup;
  const context: ModelContext = { system, messages: [...state.messages], tools: state.wireTools };
  state.send({
    type: "model_call_start",
    request: { model: model.ref, context, options: dumpedOptions(modelOptions) },
  });
  let message: AssistantMessage | undefined;
  for await (const event of model.stream(context, { ...modelOptions, signal })) {
    message = forward(state, event) ?? message;
  }
  if (message === undefined) {
    throw new SdkError("invalid_model_stream", "the model's stream ended without a done or error event");
  }
  state.steps += 1;
  state.usage = addUsage(state.usage, message.usage);
  state.cost = state.cost === undefined ? message.cost : addCost(state.cost, message.cost);
  state.append(message);
  state.send({ type: "model_call_end", message });
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

/** Runs the response's tool calls one at a time, recording each result as soon as it arrives. */
async function runTools(state: LoopState, message: AssistantMessage): Promise<readonly ToolCallResult[]> {
  const { runId, signal, clock, tools, output } = state.setup;
  return runToolCalls(message, tools, {
    runId,
    signal,
    clock,
    depth: TOP_LEVEL_DEPTH,
    maxDepth: DEFAULT_MAX_DEPTH,
    onStart: (call: ToolCall) =>
      state.send({ type: "tool_call_start", callId: call.callId, tool: call.name, input: call.input }),
    onUpdate: (callId, details) => state.send({ type: "tool_call_update", callId, details }),
    onResult: (entry) => {
      state.append(toolMessage(entry));
      if (output !== undefined && entry.call.name === output.name && entry.result.isError !== true) {
        state.output = entry.result.structured;
      }
      state.send({ type: "tool_call_end", callId: entry.call.callId, result: entry.result });
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
 * The stop check after one step. A finished answer wins over an abort that came too late to change it; otherwise an
 * abort stops the run before the step cap does.
 */
function stopCheck(
  state: LoopState,
  message: AssistantMessage,
  results: readonly ToolCallResult[],
): Outcome | undefined {
  if (message.stopReason === "error") return { stopReason: "error", error: runErrorOf(message) };
  if (message.stopReason === "aborted") return { stopReason: "aborted" };
  const finished = results.length === 0 || results.some(({ result }) => result.terminate === true && !result.isError);
  if (finished) return { stopReason: "done", output: state.output };
  if (state.setup.signal.aborted) return { stopReason: "aborted" };
  if (state.steps >= state.setup.maxSteps) return { stopReason: "max_steps" };
  return undefined;
}

async function runStep(state: LoopState): Promise<Outcome | undefined> {
  state.stepIndex = state.steps;
  state.send({ type: "step_start" });
  const message = await callModel(state);
  const results = await runTools(state, message);
  const outcome = stopCheck(state, message, results);
  state.send({ type: "step_end", stopCheck: outcome === undefined ? "continue" : "stop" });
  return outcome;
}

/**
 * An aborted run's transcript ends with an assistant message whose `stopReason` is `"aborted"`. When the abort came
 * while tools ran, the loop appends an empty one after their results; the replay pass drops it before any request.
 */
function closeAborted(state: LoopState): void {
  const last = state.messages.at(-1);
  if (last?.role === "assistant" && last.stopReason === "aborted") return;
  const usage = emptyUsage();
  const { model } = state.setup;
  state.append({
    role: "assistant",
    content: [],
    model: model.ref,
    stopReason: "aborted",
    usage,
    cost: model.price(usage),
  });
}

function resultOf(state: LoopState, outcome: Outcome): RunResult {
  const base = {
    messages: state.added,
    context: { system: state.setup.system, messages: state.messages },
    usage: state.usage,
    cost: state.cost ?? { ...NO_COST },
    steps: state.steps,
  };
  return { ...base, ...outcome } as RunResult;
}

function finish(state: LoopState, outcome: Outcome): RunResult {
  if (outcome.stopReason === "aborted") closeAborted(state);
  if (outcome.stopReason === "max_steps") {
    state.send({ type: "warning", code: "max_steps", detail: `the run reached maxSteps (${state.setup.maxSteps})` });
  }
  if (outcome.stopReason === "error") state.send({ type: "error", error: outcome.error });
  state.send({ type: "agent_settled" });
  const result = resultOf(state, outcome);
  state.send({ type: "run_end", result });
  return result;
}

/**
 * Runs the loop to a stop reason and returns the result. It throws only for a programmer error, after the results
 * already received are in the transcript.
 */
export async function runLoop(setup: LoopSetup, emit: Emit): Promise<RunResult> {
  const state = new LoopState(setup, emit);
  let outcome: Outcome | undefined;
  while (outcome === undefined) {
    outcome = setup.signal.aborted ? { stopReason: "aborted" } : await runStep(state);
  }
  return finish(state, outcome);
}
