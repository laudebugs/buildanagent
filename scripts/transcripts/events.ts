// The transcript format's one home: the version, the SDK-neutral shapes of messages and events, and the call a
// harness's mock layer makes to report an event. Each harness's `examples/lib/transcript.ts` maps its SDK's messages to
// these shapes; `write.mjs` writes them to `verify/<sdk>/results/transcripts/<example>.json`; the book's replay reads
// them back through a schema in `apps/manual/src/book/transcripts.ts`. A change to a shape bumps the version.
//
// The file holds only syntax that Node.js can strip, so `write.mjs` imports it without a build step.

/** The version of the transcript format. */
export const TRANSCRIPT_FORMAT = 1;

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
