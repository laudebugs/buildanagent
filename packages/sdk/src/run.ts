/**
 * `run()`, `continueRun()` and `runOrThrow()`, and the `Run` object they share (SDK plan §3.3; D10). A run streams
 * its events to anyone who iterates it and settles `result` with the same run's outcome, so the streaming and the
 * non-streaming caller drive one loop.
 */
import type { ContentBlock, Message, Model, ModelCallOptions } from "@buildanagent/gateway";
import { RunStoppedError, SdkError } from "./errors.js";
import type { AgentEvent, AgentEventBody } from "./events.js";
import { type LoopSetup, runLoop } from "./loop.js";
import type { Context, DoneResult, RunResult } from "./result.js";
import type { Clock } from "./testing/determinism.js";
import { preparedSchemaOf } from "./tools/define.js";
import type { AnyTool } from "./tools/pipeline.js";
import type { ToolDefinition } from "./tools/types.js";
import { SDK_VERSION } from "./version.js";

/** The step cap's default, counted in model calls. */
const DEFAULT_MAX_STEPS = 20;

const systemClock: Clock = { now: () => new Date().toISOString() };
const randomIds = (): string => globalThis.crypto.randomUUID();

/** The options `run()` and `continueRun()` share. */
export interface RunOptions<S = unknown> {
  /** The model, from `createModel()`. */
  readonly model: Model;
  /** The tools the model may call. Tools whose `exposure` is `deferred` or `hidden` are not sent. */
  readonly tools?: readonly ToolDefinition<unknown, unknown>[];
  /**
   * A tool from `outputTool()` whose input is the final answer. It is sent with the other tools; once the model calls
   * it with input that passes its schema, the run ends `done`, and `result.output` holds the validated answer.
   */
  readonly output?: ToolDefinition<S, S>;
  /**
   * The most model calls the run may make. Default 20. A run that reaches it while the model still wants to go on
   * ends with `stopReason: "max_steps"` and emits a `warning` event with `code: "max_steps"`.
   */
  readonly maxSteps?: number;
  /** Aborts the run, like `run.abort()`. */
  readonly signal?: AbortSignal;
  /** Options for every model call, such as `maxOutputTokens`. The run passes its own abort signal. */
  readonly modelOptions?: Omit<ModelCallOptions, "signal">;
  /** Stamps each event's `timestamp`, and is passed to tools. Defaults to the system clock. */
  readonly clock?: Clock;
  /** Makes the run's id. Defaults to `crypto.randomUUID()`. */
  readonly idGenerator?: () => string;
}

/** What `run()` takes besides the shared options. */
export interface RunInput {
  /** The system prompt. */
  readonly system: string;
  /** The user's message that starts the run. */
  readonly input: string | readonly ContentBlock[];
  /** Earlier messages to send before `input`, such as a previous conversation. */
  readonly history?: readonly Message[];
}

/**
 * A run in progress. Iterate it to stream its events: each iteration starts from the run's first event, so you can
 * start iterating at any time. Await `result` for the outcome; it rejects only for a programmer error, such as a
 * tool that returns a malformed result, and iteration then throws the same error after the last event.
 */
export interface Run<S = unknown> extends AsyncIterable<AgentEvent> {
  /** The run's id, which every event carries. */
  readonly id: string;
  /** The outcome, once the run has stopped. */
  readonly result: Promise<RunResult<S>>;
  /**
   * Stops the run. A model call in flight ends, a running tool sees its `signal` fire, and calls that haven't started
   * get an error result instead. The run then ends with `stopReason: "aborted"`. Does nothing once the run has ended.
   */
  abort(reason?: string): void;
}

function reasonOf(reason: unknown): string | undefined {
  if (typeof reason === "string") return reason;
  return reason instanceof Error ? reason.message : undefined;
}

class RunHandle<S> implements Run<S> {
  readonly id: string;
  readonly result: Promise<RunResult<S>>;
  readonly #events: AgentEvent[] = [];
  readonly #controller = new AbortController();
  readonly #clock: Clock;
  #waiters: (() => void)[] = [];
  #ended = false;
  #failure: { readonly error: unknown } | undefined;
  #stepIndex = 0;

  constructor(setup: Omit<LoopSetup, "signal">, signal: AbortSignal | undefined) {
    this.id = setup.runId;
    this.#clock = setup.clock;
    const emit = (body: AgentEventBody, stepIndex: number) => this.#push(body, stepIndex);
    const { model } = setup;
    const versions = { sdkVersion: SDK_VERSION, specVersion: "v1" as const, defaultsHash: "", capabilities: [] };
    emit({ type: "run_start", ...versions, model: model.ref }, 0);
    const forwardAbort = () => this.abort(reasonOf(signal?.reason));
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    const loop = runLoop({ ...setup, signal: this.#controller.signal }, emit);
    // The loop's result type is `RunResult<unknown>`; only the output tool, whose type is `S`, fills `output`.
    this.result = loop as Promise<RunResult<S>>;
    // Handling the rejection here also keeps a caller who only iterates from an unhandled rejection: iteration
    // throws the same error.
    loop.then(
      () => this.#end(signal, forwardAbort, undefined),
      (error: unknown) => this.#end(signal, forwardAbort, { error }),
    );
  }

  abort(reason?: string): void {
    if (this.#ended || this.#controller.signal.aborted) return;
    this.#push(reason === undefined ? { type: "abort" } : { type: "abort", reason }, this.#stepIndex);
    this.#controller.abort(reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    let cursor = 0;
    return {
      next: async () => {
        while (cursor >= this.#events.length && !this.#ended) {
          await new Promise<void>((resolve) => this.#waiters.push(resolve));
        }
        const event = this.#events[cursor];
        if (event !== undefined) {
          cursor += 1;
          return { value: event, done: false };
        }
        if (this.#failure !== undefined) throw this.#failure.error;
        return { value: undefined, done: true };
      },
    };
  }

  #push(body: AgentEventBody, stepIndex: number): void {
    this.#stepIndex = stepIndex;
    const base = { runId: this.id, seq: this.#events.length, stepIndex, timestamp: this.#clock.now() };
    this.#events.push({ ...base, ...body });
    this.#wake();
  }

  #end(signal: AbortSignal | undefined, forwardAbort: () => void, failure: { readonly error: unknown } | undefined) {
    signal?.removeEventListener("abort", forwardAbort);
    this.#failure = failure;
    this.#ended = true;
    this.#wake();
  }

  #wake(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const wake of waiters) wake();
  }
}

function isModel(model: unknown): model is Model {
  const candidate = model as Partial<Model> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.stream === "function" &&
    typeof candidate.price === "function" &&
    typeof candidate.ref === "object"
  );
}

/** Every tool the run may send, the output tool last unless `tools` already holds it, after checking each one. */
function toolsOf(options: RunOptions<unknown>): AnyTool[] {
  const tools = [...(options.tools ?? [])] as AnyTool[];
  const output = options.output as AnyTool | undefined;
  if (output !== undefined && !tools.includes(output)) tools.push(output);
  const names = new Set<string>();
  for (const tool of tools) {
    preparedSchemaOf(tool);
    if (names.has(tool.name)) {
      throw new SdkError("invalid_tool_definition", `two tools are named "${tool.name}"; tool names must be unique`);
    }
    names.add(tool.name);
  }
  return tools;
}

function setupOf(options: RunOptions<unknown>, context: Context, input: readonly Message[]): Omit<LoopSetup, "signal"> {
  if (!isModel(options.model)) {
    throw new SdkError(
      "invalid_run_options",
      "the model must come from createModel(), such as createModel({ adapter, id })",
    );
  }
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new SdkError("invalid_run_options", `maxSteps must be a positive integer, got ${maxSteps}`);
  }
  const tools = toolsOf(options);
  return {
    runId: (options.idGenerator ?? randomIds)(),
    model: options.model,
    system: context.system,
    history: context.messages,
    input,
    tools: tools.filter((tool) => (tool.exposure ?? "direct") === "direct"),
    output: options.output as AnyTool | undefined,
    maxSteps,
    modelOptions: options.modelOptions ?? {},
    clock: options.clock ?? systemClock,
  };
}

/**
 * Starts a run: the model answers `input`, runs the tools it asks for, and goes on until it answers without a tool
 * call, an output tool accepts its answer, or a stop reason ends the run early. Throws an `SdkError` at once for an
 * unusable option: a model that isn't from `createModel()`, a `maxSteps` that isn't a positive integer, or two tools
 * with one name.
 */
export function run<S = unknown>(options: RunOptions<S> & RunInput): Run<S> {
  const content = typeof options.input === "string" ? [{ type: "text" as const, text: options.input }] : options.input;
  const input: Message = { role: "user", content: [...content] };
  const setup = setupOf(options, { system: options.system, messages: options.history ?? [] }, [input]);
  return new RunHandle<S>(setup, options.signal);
}

/**
 * Goes on with a conversation from a result's `context`, or one you rebuilt from your own store. It runs like
 * `run()`, from the last message in the context, and `result.messages` holds only the messages it adds.
 */
export function continueRun<S = unknown>(context: Context, options: RunOptions<S>): Run<S> {
  return new RunHandle<S>(setupOf(options, context, []), options.signal);
}

/**
 * Awaits a run and returns its result if it ended `done`. Any other stop reason throws a `RunStoppedError` that
 * carries the result and the context to continue from.
 */
export async function runOrThrow<S>(started: Run<S>): Promise<DoneResult<S>> {
  const result = await started.result;
  if (result.stopReason === "done") return result;
  throw new RunStoppedError(result);
}
