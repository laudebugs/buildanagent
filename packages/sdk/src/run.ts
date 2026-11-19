/**
 * `run()`, `continueRun()` and `runOrThrow()`, and the `Run` object they share (SDK plan §3.3; D10). A run streams
 * its events to anyone who iterates it and settles `result` with the same run's outcome, so the streaming and the
 * non-streaming caller drive one loop.
 */
import type { ContentBlock, Message, Model } from "@buildanagent/gateway";
import { checkBudgetOption } from "./budget.js";
import { RunStoppedError, SdkError } from "./errors.js";
import type { AgentEvent, AgentEventBody } from "./events.js";
import type { CallOptions, Interceptors, Observer } from "./hooks.js";
import { type LoopSetup, runLoop } from "./loop.js";
import { ObserverBus } from "./observers.js";
import { blockingHandlerOf, isSigner } from "./pauses.js";
import { type ProgressCheck, type ProgressPolicy, progressCheck, resolveProgress } from "./progress.js";
import type { Context, DoneResult, RunResult } from "./result.js";
import { resumeSetupOf } from "./resume.js";
import { type DeliveryReceipt, SteeringQueue } from "./steering.js";
import type { Clock } from "./testing/determinism.js";
import { preparedSchemaOf } from "./tools/define.js";
import type { AnyTool } from "./tools/pipeline.js";
import type { ToolContext, ToolDefinition } from "./tools/types.js";
import type { Recheck, Resolution } from "./vendor/agent-safety/pending.js";
import { type ApprovalSigner, ephemeralSigner } from "./vendor/agent-safety/signer.js";
import { SDK_VERSION } from "./version.js";

/** The step cap's default, counted in model calls. */
const DEFAULT_MAX_STEPS = 20;

/** The depth cap's default (D11): a top-level run, its subagents and their subagents may run, and no deeper. */
const DEFAULT_MAX_DEPTH = 2;

/** How long the run waits, by default, for an observer to catch up before it drops it. */
const DEFAULT_OBSERVER_TIMEOUT_MS = 10_000;
/** The longest delay `setTimeout` accepts; a larger one fires at once on Node and workerd alike. */
const MAX_TIMER_MS = 2_147_483_647;

const systemClock: Clock = { now: () => new Date().toISOString() };
const randomIds = (): string => globalThis.crypto.randomUUID();

/** The options `run()` and `continueRun()` share. */
export interface RunOptions<S = unknown> {
  /** The model, from `createModel()`. */
  readonly model: Model;
  /**
   * The tools the model may call. Tools whose `exposure` is `deferred` or `hidden` are not sent unless a
   * `beforeModelCall` interceptor names them in `activeTools`.
   */
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
  /**
   * The most the run's model calls may cost, in USD. Before each call the run projects its cost with
   * `projectCallCost()` and, if the spend so far plus that projection would pass the cap, ends with
   * `stopReason: "budget"` without making the call. The cap counts the calls this run makes, not the cost of the
   * history a `continueRun()` starts from. A budgeted run on a model whose price is unknown ends `error` with
   * `error.kind: "unknown_price"` before its first call, because it could not tell what it spent. Without it, a run
   * has no cap.
   */
  readonly budgetUsd?: number;
  /**
   * The default progress policy: the run ends `no_progress` after 3 identical failing tool calls in a row, or after 5
   * calls to a tool with one `progressKey` and no success between them. It runs after your own `shouldStop`, whose
   * `{ continue }` can't keep a stuck run going. Pass numbers to change either threshold, or `false` to turn the
   * policy off.
   */
  readonly progress?: ProgressPolicy | false;
  /**
   * How deeply this run is nested inside other agents' tool calls. Default 0. A tool that starts a run of its own
   * passes `depth: ctx.depth + 1` and `maxDepth: ctx.maxDepth`; `run()` throws an `SdkError` with code
   * `max_depth_exceeded` when `depth` is above `maxDepth`, which the tool's caller reads as an error result.
   */
  readonly depth?: number;
  /** The deepest nesting allowed, which tools read as `ctx.maxDepth`. Default 2. */
  readonly maxDepth?: number;
  /** Aborts the run, like `run.abort()`. */
  readonly signal?: AbortSignal;
  /** Options for every model call, such as `maxOutputTokens`. The run passes its own abort signal. */
  readonly modelOptions?: CallOptions;
  /**
   * The interceptors: hooks that can change the run at six moments. A run takes one object; join several with
   * `composeInterceptors()`. See `Interceptors` for the order and for what a failing hook does.
   */
  readonly interceptors?: Interceptors;
  /**
   * Observers, which receive every event from `run_start` on and can't change the run. Each observer sees the events in
   * order and waits for its own promises, but observers don't wait for each other. An observer that throws becomes a
   * `hook_error` event. The run waits for every observer to handle the last event before it settles, for at most
   * `observerTimeoutMs` each time it waits; an observer that hasn't caught up by then is removed and reported as a
   * `hook_error`.
   */
  readonly observers?: readonly Observer[];
  /**
   * The longest the run waits for its observers each time it waits for them: before `agent_settled`, before
   * `run_end` and before it settles. A number from 1 to 2147483647; the default is 10000. It bounds an observer whose promise never settles.
   */
  readonly observerTimeoutMs?: number;
  /** Stamps each event's `timestamp`, and is passed to tools. Defaults to the system clock. */
  readonly clock?: Clock;
  /**
   * Makes the run's id, then the id of each pending request the run signs. A request id that repeats the run's id or
   * an earlier request's id is replaced by `crypto.randomUUID()`, so a generator that always returns one id still
   * pauses every call; return a fresh id on every call to keep request ids deterministic. Defaults to
   * `crypto.randomUUID()`.
   */
  readonly idGenerator?: () => string;
  /**
   * Signs the pending request a run writes when a `beforeToolCall` gate returns `ask`. The default,
   * `ephemeralSigner()`, holds a random key that lives only in this process, so only this process can verify its
   * pauses: on a serverless host, or anywhere a pause may resume in another process, pass `hmacSigner()` over a key
   * ring you keep. A pause that can't be signed is never written unsigned; its call is blocked instead.
   */
  readonly signer?: ApprovalSigner;
}

/** What `continueRun()` takes besides the shared options: the answers to a paused context's requests. */
export interface ContinueOptions<S = unknown> extends RunOptions<S> {
  /**
   * A person's answer to each pending request of the context: `{ requestId, decision: "allow" | "deny" }` for an
   * approval, `{ requestId, answer }` for a question. Each is checked against its request and the input
   * `context.pendingInputs` holds for it, with the run's `signer`, before anything runs. A request no resolution
   * names still waits, and the run ends paused again without a model call.
   */
  readonly resolutions?: readonly Resolution[];
  /**
   * Runs current policy for each verified approval just before its call runs. It gets copies of the request and
   * input. Resolve to `"allow"` to run the call, or to `{ deny: reason }` to give the model an error result with that
   * reason instead. A `recheck` that throws or returns anything else denies the call. Without it, a verified approval
   * runs, so check policy before you resolve.
   */
  readonly recheck?: Recheck;
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
   * get an error result instead. The run then ends with `stopReason: "aborted"`, unless a gate already paused a call
   * in the step, which ends it `awaiting_approval`, because that call's signed request still waits. Does nothing once
   * the run has its outcome and is ending, which is before `agent_settled`.
   */
  abort(reason?: string): void;
  /**
   * Adds an observer that receives the events from now on, in order, and returns the function that removes it. An
   * event that was queued for it but not yet handled is dropped when you remove it. Add it right after `run()` to
   * see every event but `run_start`, which `run()` emits before it returns; to see that one too, pass the observer
   * in the `observers` option.
   */
  on(observer: Observer): () => void;
  /**
   * Queues a user message that redirects the run. The run applies it at the next step boundary: after the model call
   * or tool batch in flight, never inside it, and before the next model call. The promise resolves with a
   * `DeliveryReceipt` once the message is in the transcript, and the run emits a `steer_applied` event for it. It
   * rejects with an `SdkError` whose code is `undelivered_message` when the run ends first, and with
   * `invalid_run_options` for a blank message or a block that isn't text or an image. Steers are applied in the
   * order they were sent.
   */
  steer(message: string | readonly ContentBlock[]): Promise<DeliveryReceipt>;
  /**
   * Queues a user message that waits until the run would otherwise end. When the model has answered and no tool call
   * is left, the run applies every waiting follow-up as user messages and makes one more model call, so a follow-up
   * sent before the run ends extends it by one step. A steer that is waiting goes first. The run still ends, and the
   * follow-up rejects with `undelivered_message`, when another stop reason ends it: a `shouldStop` hook or progress
   * policy that stops it, its output tool, an abort or `maxSteps`. The receipt works as for `steer()`.
   */
  followUp(message: string | readonly ContentBlock[]): Promise<DeliveryReceipt>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkObserver(observer: unknown): void {
  if (typeof observer !== "function") {
    throw new SdkError("invalid_run_options", `an observer must be a function, got ${typeof observer}`);
  }
}

const HOOK_NAMES = [
  "transformContext",
  "beforeModelCall",
  "afterModelCall",
  "beforeToolCall",
  "afterToolCall",
  "shouldStop",
] as const;

/** Checks the interceptors option once, so a misspelt or mistyped hook fails at `run()` and not mid-run. */
function checkInterceptors(interceptors: Interceptors): Interceptors {
  if (typeof interceptors !== "object" || interceptors === null) {
    throw new SdkError("invalid_run_options", "interceptors must be an object of hooks");
  }
  for (const name of HOOK_NAMES) {
    const hook: unknown = interceptors[name];
    if (hook !== undefined && typeof hook !== "function") {
      throw new SdkError("invalid_run_options", `interceptors.${name} must be a function, got ${typeof hook}`);
    }
  }
  blockingHandlerOf(interceptors);
  const { onFailure } = interceptors;
  if (onFailure !== undefined && onFailure !== "fail_closed" && onFailure !== "continue") {
    throw new SdkError("invalid_run_options", `interceptors.onFailure must be "fail_closed" or "continue"`);
  }
  return interceptors;
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
  readonly #bus: ObserverBus;
  #waiters: (() => void)[] = [];
  #ended = false;
  /** Set once the loop has its outcome and starts to end the run, so `abort()` no longer does anything. */
  #settled = false;
  /** Set by `run_end`: nothing may follow it, so a late observer report is dropped. */
  #closed = false;
  readonly #steering: SteeringQueue;
  #failure: { readonly error: unknown } | undefined;
  #stepIndex = 0;

  constructor(setup: Omit<LoopSetup, "signal" | "steering">, signal: AbortSignal | undefined, watch: ObserverSetup) {
    this.id = setup.runId;
    this.#clock = setup.clock;
    this.#steering = new SteeringQueue(setup.runId);
    this.#bus = new ObserverBus((hook, error) => {
      if (!this.#closed) this.#push({ type: "hook_error", hook, error: messageOf(error) }, this.#stepIndex);
    }, watch.timeoutMs);
    const { observers } = watch;
    for (const observer of observers) this.#bus.add(observer);
    const emit = (body: AgentEventBody, stepIndex: number) => this.#push(body, stepIndex);
    const { model } = setup;
    const versions = { sdkVersion: SDK_VERSION, specVersion: "v1" as const, defaultsHash: "", capabilities: [] };
    emit({ type: "run_start", ...versions, model: model.ref }, 0);
    const forwardAbort = () => this.abort(reasonOf(signal?.reason));
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    // The loop starts after this turn, so an observer added with `run.on()` straight after `run()` sees every event
    // after `run_start`, and a `run.abort()` straight after it stops the run before its first model call.
    // The loop drains the observers only once it has its outcome (`finish()`), so the first drain is also where an
    // abort stops mattering: it could no longer change the outcome, only add an `abort` event after it.
    const drain = () => {
      this.#settled = true;
      return this.#bus.flush();
    };
    const loop = Promise.resolve().then(() =>
      runLoop({ ...setup, signal: this.#controller.signal, steering: this.#steering }, emit, drain),
    );
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
    if (this.#settled || this.#ended || this.#controller.signal.aborted) return;
    this.#push(reason === undefined ? { type: "abort" } : { type: "abort", reason }, this.#stepIndex);
    this.#controller.abort(reason);
  }

  on(observer: Observer): () => void {
    checkObserver(observer);
    return this.#bus.add(observer);
  }

  steer(message: string | readonly ContentBlock[]): Promise<DeliveryReceipt> {
    return this.#steering.add("steer", message);
  }

  followUp(message: string | readonly ContentBlock[]): Promise<DeliveryReceipt> {
    return this.#steering.add("follow_up", message);
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
    if (body.type === "run_end") this.#closed = true;
    const base = { runId: this.id, seq: this.#events.length, stepIndex, timestamp: this.#clock.now() };
    const event = { ...base, ...body } as AgentEvent;
    this.#events.push(event);
    this.#bus.deliver(event);
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

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The `depth` and `maxDepth` options for a run that a tool starts: one level deeper than the tool's own run, under
 * the same cap. Spread it into the nested `run()`; the nested run throws `max_depth_exceeded` when the tool was
 * already at `maxDepth`.
 */
export function nestedRunDepth(ctx: Pick<ToolContext, "depth" | "maxDepth">): { depth: number; maxDepth: number } {
  return { depth: ctx.depth + 1, maxDepth: ctx.maxDepth };
}

/** Checks `depth` and `maxDepth`, and refuses a run nested deeper than the cap allows (D11). */
function depthsOf(options: RunOptions<unknown>): { depth: number; maxDepth: number } {
  const { depth = 0, maxDepth = DEFAULT_MAX_DEPTH } = options;
  if (!isCount(depth) || !isCount(maxDepth)) {
    throw new SdkError(
      "invalid_run_options",
      `depth and maxDepth must be whole numbers, 0 or more, got ${String(depth)} and ${String(maxDepth)}`,
    );
  }
  if (depth > maxDepth) {
    throw new SdkError("max_depth_exceeded", `a run at depth ${depth} is deeper than maxDepth ${maxDepth} allows`);
  }
  return { depth, maxDepth };
}

/**
 * The default progress policy for this run, or `undefined` when `progress: false` turns it off. `skip` is the number
 * of messages before the run's own.
 */
function progressOf(options: RunOptions<unknown>, tools: readonly AnyTool[], skip: number): ProgressCheck | undefined {
  const policy = resolveProgress(options.progress);
  return policy === undefined ? undefined : progressCheck(tools, policy, skip);
}

function setupOf(
  options: RunOptions<unknown>,
  context: Context,
  input: readonly Message[],
): Omit<LoopSetup, "signal" | "steering"> {
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
  const signer = options.signer ?? ephemeralSigner();
  if (!isSigner(signer)) {
    throw new SdkError(
      "invalid_run_options",
      "signer must be an ApprovalSigner, such as hmacSigner() or ephemeralSigner()",
    );
  }
  const budgetUsd = checkBudgetOption(options.budgetUsd);
  const tools = toolsOf(options);
  const { depth, maxDepth } = depthsOf(options);
  const progress = progressOf(options, tools, context.messages.length + input.length);
  if (options.output !== undefined && (options.output.exposure ?? "direct") !== "direct") {
    throw new SdkError(
      "invalid_run_options",
      `the output tool "${options.output.name}" must be sent to the model, so its exposure must be "direct"`,
    );
  }
  const nextId = options.idGenerator ?? randomIds;
  return {
    runId: nextId(),
    nextId,
    signer,
    model: options.model,
    system: context.system,
    history: context.messages,
    input,
    tools,
    output: options.output as AnyTool | undefined,
    maxSteps,
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    depth,
    maxDepth,
    modelOptions: options.modelOptions ?? {},
    interceptors: checkInterceptors(options.interceptors ?? {}),
    ...(progress === undefined ? {} : { progress }),
    clock: options.clock ?? systemClock,
  };
}

/** The observers a run starts with, and how long it waits for them. */
interface ObserverSetup {
  readonly observers: readonly Observer[];
  readonly timeoutMs: number;
}

function observersOf(options: RunOptions<unknown>): ObserverSetup {
  const observers = options.observers ?? [];
  for (const observer of observers) checkObserver(observer);
  const timeoutMs = options.observerTimeoutMs ?? DEFAULT_OBSERVER_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_MS) {
    throw new SdkError(
      "invalid_run_options",
      `observerTimeoutMs must be a number from 1 to ${MAX_TIMER_MS}, got ${timeoutMs}`,
    );
  }
  return { observers, timeoutMs };
}

/**
 * Starts a run: the model answers `input`, runs the tools it asks for, and goes on until it answers without a tool
 * call, an output tool accepts its answer, or a stop reason ends the run early. Throws an `SdkError` at once for an
 * unusable option: a model that isn't from `createModel()`, a `maxSteps` that isn't a positive integer, an output tool
 * that isn't sent to the model, or two tools with one name.
 */
export function run<S = unknown>(options: RunOptions<S> & RunInput): Run<S> {
  const content = typeof options.input === "string" ? [{ type: "text" as const, text: options.input }] : options.input;
  const input: Message = { role: "user", content: [...content] };
  const setup = setupOf(options, { system: options.system, messages: options.history ?? [] }, [input]);
  return new RunHandle<S>(setup, options.signal, observersOf(options));
}

/**
 * Goes on with a conversation from a result's `context`, or one you rebuilt from your own store. It runs like
 * `run()`, from the last message in the context, and `result.messages` holds only the messages it adds. The context
 * is sent as it stands, so add a user message to one that ends with the model's answer, such as a `done` result's.
 * A context whose last response ended in an error asks the model again.
 *
 * A paused context resumes with `resolutions`. Before the first model call, each waiting call's stored request is
 * verified with the run's `signer` against its call and its input in `context.pendingInputs`, then:
 *
 * - a verified `allow` runs the call once, with the input its request signs and without `beforeToolCall`, after
 *   `recheck` allows it;
 * - a verified `deny` gives the model an error result with the reason, and a verified `answer` reaches the model as
 *   the call's result;
 * - a request no resolution names still waits;
 * - a request or resolution that fails its check runs nothing, emits `resolution_rejected`, and the call asks again
 *   with a new approval request: the gate is asked as for a new call, and the call pauses even when the gate allows
 *   it. A call to a tool the model isn't sent by default gets the unknown-tool error result instead.
 *
 * Settling the requests is not a step. When a call still waits, the run ends paused again without a model call, and
 * when none does and an approved call's result sets `terminate`, the run ends `done` without one.
 * Each request answers once per context, but the SDK can't see other processes: mark a request used in your store
 * before you resume it, so a second resume of the same stored context is refused there.
 *
 * Throws an `SdkError` with code `invalid_run_options` for a context it can't read, for a context whose last
 * assistant message has a call with no result and no pending request, for a pending request whose call doesn't wait
 * in the context, and for malformed `resolutions` or `recheck`, besides the options `run()` refuses.
 */
export function continueRun<S = unknown>(context: Context, options: ContinueOptions<S>): Run<S> {
  const resume = resumeSetupOf(context, options?.resolutions, options?.recheck);
  const setup = setupOf(options, context, []);
  return new RunHandle<S>(resume === undefined ? setup : { ...setup, resume }, options.signal, observersOf(options));
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
