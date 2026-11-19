/**
 * `ScriptedModel`: the strict scripted test model every loop, tool, hook and pause test drives
 * (SDK plan §3.3, §5.1; SDK decision 14; agent-SDK guide §8).
 *
 * - **Strict.** A call past the last step throws `UnexpectedModelCallError`; `assertComplete()` throws if steps remain.
 * - **Frozen snapshots.** Each request is cloned and deeply frozen when the call is made, so later mutation of the
 *   caller's context never changes `calls`.
 * - **Realistic streams.** Text, reasoning and tool-input JSON arrive in chunks of `chunkSize` characters, and the
 *   abort signal is checked between chunks.
 * - **Deterministic.** Chunk sizes and generated ids come only from the options, never `Math.random()` or `Date.now()`.
 *
 * It implements the gateway's `ModelAdapter` and imports nothing from the loop, so gateway tests can use it too.
 */
import {
  type AssistantMessage,
  type ContentBlock,
  emptyUsage,
  type ModelAdapter,
  type ModelCaps,
  type ModelContext,
  type ModelEvent,
  type ModelRef,
  type StreamOptions,
  type Usage,
} from "@buildanagent/gateway";

/** One scripted model response. */
export interface AssistantScript {
  content: ContentBlock[];
  /** Defaults to `"tool_calls"` when `content` has a tool call, else `"stop"`. Ignored when `error` is set. */
  stopReason?: "stop" | "length" | "tool_calls";
  /** Ends the stream with an `error` terminal (`stopReason: "error"`) after streaming `content`. */
  error?: NonNullable<AssistantMessage["error"]>;
  usage?: Partial<Omit<Usage, "raw">>;
}

/** A frozen, detached snapshot of one call: the model, the context and the serialisable options. */
export interface RecordedRequest {
  readonly model: ModelRef;
  readonly context: ModelContext;
  readonly options: Readonly<
    Pick<StreamOptions, "maxOutputTokens" | "temperature" | "cacheRetention" | "providerOptions">
  >;
}

/** A fixed response, or a responder that builds one from the recorded request. */
export type ScriptStep = AssistantScript | ((request: RecordedRequest) => AssistantScript | Promise<AssistantScript>);

export interface ScriptedModelOptions {
  /** Characters per delta. Default 4. */
  chunkSize?: number;
  /** Overrides the adapter's `api` and `provider` (`"scripted"` by default). */
  ref?: Partial<ModelRef>;
  /** Fills in missing tool-call ids. Default `call-1`, `call-2`, … */
  idGenerator?: () => string;
  /** The caps `createModel()` gives this model. Default: 200,000-token window, 32,000 output tokens, images, reasoning. */
  caps?: ModelCaps;
}

const DEFAULT_CAPS: ModelCaps = { contextWindow: 200_000, maxOutputTokens: 32_000, images: true, reasoning: true };

export class UnexpectedModelCallError extends Error {
  override readonly name = "UnexpectedModelCallError";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

function chunks(text: string, size: number): string[] {
  if (text.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** What one stream has built so far. */
interface RunState {
  readonly model: ModelRef;
  readonly content: ContentBlock[];
  readonly usage: Usage;
}

/** The serialisable stream options, with omitted ones left out rather than set to `undefined`. */
function recordedOptions(options: StreamOptions): RecordedRequest["options"] {
  const recorded: { -readonly [K in keyof RecordedRequest["options"]]: RecordedRequest["options"][K] } = {};
  if (options.maxOutputTokens !== undefined) recorded.maxOutputTokens = options.maxOutputTokens;
  if (options.temperature !== undefined) recorded.temperature = options.temperature;
  if (options.cacheRetention !== undefined) recorded.cacheRetention = options.cacheRetention;
  if (options.providerOptions !== undefined) recorded.providerOptions = options.providerOptions;
  return recorded;
}

function messageOf(
  run: RunState,
  stopReason: AssistantMessage["stopReason"],
  error?: NonNullable<AssistantMessage["error"]>,
): AssistantMessage {
  return {
    role: "assistant",
    content: [...run.content],
    model: run.model,
    stopReason,
    ...(error === undefined ? {} : { error }),
    usage: run.usage,
    cost: { total: null, basis: "unknown", currency: "USD" },
  };
}

/** The terminal event once every block has streamed: an error if the script set one, else done. */
function terminal(run: RunState, script: AssistantScript): ModelEvent {
  if (script.error) return { type: "error", message: messageOf(run, "error", script.error) };
  const stopReason = script.stopReason ?? (run.content.some((b) => b.type === "tool_call") ? "tool_calls" : "stop");
  return { type: "done", message: messageOf(run, stopReason) };
}

export class ScriptedModel implements ModelAdapter {
  readonly specificationVersion = "v1" as const;
  readonly api: string;
  readonly provider: string;
  readonly defaultCaps: ModelCaps;
  readonly #steps: ScriptStep[];
  readonly #calls: RecordedRequest[] = [];
  readonly #chunkSize: number;
  readonly #nextId: () => string;
  #used = 0;

  constructor(steps: ScriptStep[], options: ScriptedModelOptions = {}) {
    const chunkSize = options.chunkSize ?? 4;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError("chunkSize must be a positive integer");
    this.#steps = [...steps];
    this.#chunkSize = chunkSize;
    this.api = options.ref?.api ?? "scripted";
    this.provider = options.ref?.provider ?? "scripted";
    this.defaultCaps = { ...(options.caps ?? DEFAULT_CAPS) };
    let n = 0;
    this.#nextId = options.idGenerator ?? (() => `call-${++n}`);
  }

  /** Every call so far, as frozen, detached snapshots. */
  get calls(): readonly RecordedRequest[] {
    return this.#calls;
  }

  /** Throws if any scripted step was never used. Call it in test teardown. */
  assertComplete(): void {
    const remaining = this.#steps.length - this.#used;
    if (remaining > 0) {
      throw new Error(`ScriptedModel: ${remaining} of ${this.#steps.length} scripted steps were never called`);
    }
  }

  stream(model: ModelRef, context: ModelContext, options: StreamOptions): AsyncIterable<ModelEvent> {
    const callNumber = this.#used + 1;
    const step = this.#steps[this.#used];
    if (step === undefined) return this.#overRun(callNumber);
    const request: RecordedRequest = deepFreeze(structuredClone({ model, context, options: recordedOptions(options) }));
    this.#calls.push(request);
    this.#used += 1;
    return this.#run(step, request, options.signal);
  }

  // The error surfaces when the caller reads the stream, like any other stream failure, not when it calls stream().
  #overRun(callNumber: number): AsyncIterable<ModelEvent> {
    const error = new UnexpectedModelCallError(
      `ScriptedModel: call ${callNumber} has no scripted step (the script has ${this.#steps.length})`,
    );
    return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }) };
  }

  async *#run(step: ScriptStep, request: RecordedRequest, signal: AbortSignal | undefined): AsyncGenerator<ModelEvent> {
    const script = typeof step === "function" ? await step(request) : step;
    const run: RunState = { model: request.model, content: [], usage: { ...emptyUsage(), ...script.usage, raw: null } };
    yield { type: "start" };
    let index = 0;
    for (const scripted of script.content) {
      // Checked before the call id is drawn, so an abort leaves the id sequence and the image blocks untouched.
      if (signal?.aborted) {
        yield { type: "error", message: messageOf(run, "aborted") };
        return;
      }
      const block = this.#withCallId(scripted);
      if (block.type === "image") {
        run.content.push(block);
        continue;
      }
      const completed = yield* this.#streamBlock(block, index, run, signal);
      if (!completed) return;
      index += 1;
    }
    yield terminal(run, script);
  }

  #withCallId(scripted: ContentBlock): ContentBlock {
    if (scripted.type === "tool_call" && !scripted.callId) return { ...scripted, callId: this.#nextId() };
    return structuredClone(scripted);
  }

  /** Streams one text, reasoning or tool-call block in chunks; returns false after an abort ends the stream. */
  async *#streamBlock(
    block: Exclude<ContentBlock, { type: "image" }>,
    index: number,
    run: RunState,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<ModelEvent, boolean> {
    const kind = block.type === "tool_call" ? "tool_input" : block.type;
    const text = block.type === "tool_call" ? JSON.stringify(block.input ?? {}) : block.text;
    yield { type: `${kind}_start`, index };
    let partial = "";
    for (const delta of chunks(text, this.#chunkSize)) {
      if (signal?.aborted) {
        // An aborted stream keeps the text streamed so far, but never a partial tool call.
        if (block.type !== "tool_call" && partial) run.content.push({ ...block, text: partial });
        yield { type: "error", message: messageOf(run, "aborted") };
        return false;
      }
      partial += delta;
      yield { type: `${kind}_delta`, index, delta };
    }
    run.content.push(block);
    yield { type: `${kind}_end`, index, block };
    return true;
  }
}
