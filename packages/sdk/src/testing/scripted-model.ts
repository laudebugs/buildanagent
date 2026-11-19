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
}

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

export class ScriptedModel implements ModelAdapter {
  readonly specificationVersion = "v1" as const;
  readonly api: string;
  readonly provider: string;
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
    let request: RecordedRequest | undefined;
    if (step !== undefined) {
      const { maxOutputTokens, temperature, cacheRetention, providerOptions } = options;
      request = deepFreeze(
        structuredClone({ model, context, options: { maxOutputTokens, temperature, cacheRetention, providerOptions } }),
      );
      this.#calls.push(request);
      this.#used += 1;
    }
    return this.#run(callNumber, step, request, model, options.signal);
  }

  async *#run(
    callNumber: number,
    step: ScriptStep | undefined,
    request: RecordedRequest | undefined,
    model: ModelRef,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<ModelEvent> {
    if (step === undefined || request === undefined) {
      throw new UnexpectedModelCallError(
        `ScriptedModel: call ${callNumber} has no scripted step (the script has ${this.#steps.length})`,
      );
    }
    const script = typeof step === "function" ? await step(request) : step;
    const content: ContentBlock[] = [];
    const usage: Usage = { ...emptyUsage(), ...script.usage, raw: null };
    const message = (
      stopReason: AssistantMessage["stopReason"],
      extra: Partial<AssistantMessage> = {},
    ): AssistantMessage => ({
      role: "assistant",
      content: [...content],
      model,
      stopReason,
      usage,
      cost: { total: null, basis: "unknown", currency: "USD" },
      ...extra,
    });

    yield { type: "start" };
    let index = 0;
    for (const scripted of script.content) {
      if (signal?.aborted) {
        yield { type: "error", message: message("aborted") };
        return;
      }
      const block: ContentBlock =
        scripted.type === "tool_call" && !scripted.callId
          ? { ...scripted, callId: this.#nextId() }
          : structuredClone(scripted);
      if (block.type === "image") {
        content.push(block);
        continue;
      }
      const kind = block.type === "tool_call" ? "tool_input" : block.type;
      const text = block.type === "tool_call" ? JSON.stringify(block.input ?? {}) : block.text;
      yield { type: `${kind}_start`, index };
      let partial = "";
      for (const delta of chunks(text, this.#chunkSize)) {
        if (signal?.aborted) {
          if (block.type !== "tool_call" && partial) content.push({ ...block, text: partial });
          yield { type: "error", message: message("aborted") };
          return;
        }
        partial += delta;
        yield { type: `${kind}_delta`, index, delta };
      }
      content.push(block);
      yield { type: `${kind}_end`, index, block };
      index += 1;
    }

    if (script.error) {
      yield { type: "error", message: message("error", { error: script.error }) };
      return;
    }
    const stopReason = script.stopReason ?? (content.some((b) => b.type === "tool_call") ? "tool_calls" : "stop");
    yield { type: "done", message: message(stopReason) };
  }
}
