// The transcript format's one home: the version, the SDK-neutral shapes of messages and events, and the call a
// harness's mock layer makes to report an event. Each harness's `examples/lib/transcript.ts` maps its SDK's messages to
// these shapes; `write.mjs` writes them to `verify/<sdk>/results/transcripts/<example>.json`; the book's replay reads
// them back through a schema in `apps/manual/src/book/transcripts.ts`. A change to a shape bumps the version.
//
// The file holds only syntax that Node.js can strip, so `write.mjs` imports it without a build step.

/**
 * The version of the transcript format. Version 2 added a response's `usage` and `modelId`; a version 1 transcript has
 * neither, and the book's replay still reads it.
 */
export const TRANSCRIPT_FORMAT = 2;

/** One part of a message. `other` keeps a part the format has no shape for, under the SDK's own name. */
export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; name: string; output: unknown; error?: true }
  | { type: "other"; kind: string; value: unknown };

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  parts: Part[];
}

/**
 * The token counts a mock reported for one answer, in the four classes a provider bills (uncached input, cache reads,
 * cache writes and output), plus the part of the output spent on reasoning where the SDK reports it. `output`
 * includes `reasoning`. A class the mock did not report is left out, never written as a zero, because a zero would
 * read as a measurement.
 */
export interface Usage {
  uncachedInput?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
}

/**
 * What the mock layer reports. The recorder adds the example line that led to each event, and the writer shortens
 * each request to what is new since the same model's previous request and answer. Checks are recorded by the recorder
 * itself, from the `ok - ` line a check prints and the error a failed one throws.
 */
export type TranscriptEvent =
  | { kind: "request"; model: string; messages: Message[]; tools: string[] }
  | {
      kind: "response";
      model: string;
      message: Message;
      finish: string;
      /** The token counts of this answer, recorded only where the example's script set them (see `placeholder()`). */
      usage?: Usage;
      /**
       * The model id the mock reported for this answer, by the same rule. It is kept apart from `model`, which keys
       * the writer's shortening of requests and in most harnesses names the model in the order of its first request.
       */
      modelId?: string;
      /**
       * The tool-call ids in this answer that the example's script chose, which the writer keeps as written; any other
       * id, one the SDK generated, becomes a placeholder. The writer does not write this list.
       */
      scripted?: string[];
    };

/** The recorder that `record.mjs` installs when the runner preloads it. */
interface Recorder {
  record(event: TranscriptEvent): void;
  /** Runs `run` so that events it causes later, outside its call stack, carry the line of the call to `run`. */
  atCaller<T>(run: () => T): T;
  /**
   * Gives the events that work started from here causes later, outside its call stack, the example line on the stack
   * now, when there is one. It is for an SDK that starts its work inside a call the recorder cannot wrap.
   */
  enterCaller(): void;
}

const recorder = (globalThis as { [key: symbol]: Recorder | undefined })[Symbol.for("buildanagent.transcript")];

/** Whether the runner preloaded the recorder; a mock layer attaches itself only then. */
export const recording: boolean = recorder !== undefined;

export function record(event: TranscriptEvent): void {
  recorder?.record(event);
}

/** Runs `run` so that events it causes later, outside its call stack, carry the example line of this call. */
export function atCaller<T>(run: () => T): T {
  return recorder ? recorder.atCaller(run) : run();
}

/**
 * Gives the events that work started from the current call causes later, outside its call stack, the example line
 * that is on the stack now. A mock layer calls it from code the SDK runs synchronously inside the example's call,
 * when that call is a plain function the recorder cannot wrap, such as a module's exported `run()`. The line stays
 * until the example's next call that sets one.
 */
export function enterCaller(): void {
  recorder?.enterCaller();
}

/**
 * Wraps the named methods of `proto` so that the events each call causes carry the example line that made the call,
 * even when the SDK makes the model call later, outside the example's stack. A method that no longer exists fails
 * here, in the recorder, instead of silently recording no line.
 */
export function recordCallers(proto: object, methods: readonly string[]): void {
  const target = proto as Record<string, unknown>;
  for (const name of methods) {
    const method = target[name];
    if (typeof method !== "function") throw new Error(`transcript recorder: ${name} is not a method to wrap`);
    target[name] = function (this: unknown, ...args: unknown[]) {
      return atCaller(() => method.apply(this, args));
    };
  }
}

/*
 * Usage and the model id are recorded only where the example's script set them. A value that a mock or a harness's
 * helper fills in when the script sets none says nothing about a real call, and a replay would show it as if it were
 * measured. Such values include the AI SDK helper's default of 10 input and 5 output tokens, ai/test's generated id
 * `mock-model-id`, the usage pi-ai's faux provider estimates from an answer's length and its model id `faux-1`, the
 * zero usage of an OpenAI ScriptedModel answer scripted as a bare list of items, our own helper's `scripted-model`, and
 * the fixed 10 input and 5 output tokens that the Claude Agent SDK's and Copilot SDK's HTTP mocks send with every
 * answer. A mapper leaves such a value out. A helper marks a default object it hands the SDK with `placeholder()`, so
 * the mapper can tell it apart from one a script passed.
 */

const placeholders = new WeakSet<object>();

/** Marks an object a harness's helper fills in when the script sets none, such as a default usage, and returns it. */
export function placeholder<T extends object>(value: T): T {
  placeholders.add(value);
  return value;
}

/** Whether `value` is an object `placeholder()` marked. */
export function isPlaceholder(value: unknown): boolean {
  return typeof value === "object" && value !== null && placeholders.has(value);
}

/**
 * The usage to record from the classes a mapper read off the mock's answer: each class that is a count, or undefined
 * when none is, so a response without counts carries no `usage` at all.
 */
export function reportedUsage(counts: { [K in keyof Usage]: unknown }): Usage | undefined {
  const usage: Usage = {};
  for (const key of ["uncachedInput", "cacheRead", "cacheWrite", "output", "reasoning"] as const) {
    const count = counts[key];
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) usage[key] = count;
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

/** A response's `usage` and `modelId`, each only when there is one, to spread into the response event. */
export function answerFacts(
  usage: Usage | undefined,
  modelId: string | undefined,
): { usage?: Usage; modelId?: string } {
  return { ...(usage === undefined ? {} : { usage }), ...(modelId === undefined || modelId === "" ? {} : { modelId }) };
}

/** The ids of the tool calls in a scripted answer, for a response's `scripted` list. */
export function toolCallIds(message: Message): string[] {
  return message.parts.flatMap((part) => (part.type === "tool-call" ? [part.id] : []));
}

/** A tool-call input as the model wrote it: JSON text is parsed, anything else is kept. */
export function parsed(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/**
 * Names each model in the order of its first request, keyed by an object that stays the same for one model, such as
 * the model itself or the state its copies share.
 */
export function modelNames(): (key: object) => string {
  const names = new WeakMap<object, string>();
  let count = 0;
  return (key) => {
    let name = names.get(key);
    if (name === undefined) {
      count += 1;
      name = `model-${count}`;
      names.set(key, name);
    }
    return name;
  };
}
