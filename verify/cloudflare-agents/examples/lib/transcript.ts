// Cloudflare Agents' side of the transcript recorder (scripts/transcripts/). The examples run inside workerd, where
// the runner cannot preload record.mjs, so the runner builds each of our examples with a marker that is new for every
// run, and this file, finding it, attaches the recorder to ai/test's MockLanguageModelV4 itself. It prints each
// request and answer, and each check() that passes, on a console line of its own that starts with TRANSCRIPT_LINE and
// the marker; scripts/run-examples.mjs reads those lines from workerd's output and writes the transcript. Example
// output cannot forge such a line, because the marker is unknown until the run starts. The wrappers only read the
// request and the answer, so the model returns what it would without them. The model-mapping code is the AI SDK
// harness's (verify/vercel-ai-sdk/examples/lib/transcript.ts).
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import {
  type Message,
  modelNames,
  type Part,
  parsed,
  type TranscriptEvent,
  toolCallIds,
} from "../../../../scripts/transcripts/events.ts";

/** The start of a console line that carries one transcript event as JSON, followed by the run's marker and a colon. */
export const TRANSCRIPT_LINE = "__TRANSCRIPT__";

// The runner's per-run marker, which esbuild writes in as a constant; absent when the example is built without it.
declare const __TRANSCRIPT_NONCE__: string | undefined;
const nonce = typeof __TRANSCRIPT_NONCE__ === "string" ? __TRANSCRIPT_NONCE__ : undefined;

/** A check event, the console line a passing check() prints, or the error a failing one throws. */
type CheckEvent = { kind: "check"; message: string; pass: boolean };

const print = console.log;

function record(event: TranscriptEvent | CheckEvent): void {
  print(`${TRANSCRIPT_LINE}${nonce}:${JSON.stringify(event)}`);
}

/**
 * Records each check() that passes from the "ok - " line it prints, as record.mjs does in Node.js: only a line that
 * check() itself prints counts, which the stack shows as the caller of console.log.
 */
function recordChecks(): void {
  console.log = (...args: unknown[]) => {
    const [text] = args;
    if (args.length === 1 && typeof text === "string" && text.startsWith("ok - ")) {
      const caller = (new Error().stack ?? "").split("\n")[2]?.trim() ?? "";
      if (/^at check\d* /.test(caller)) record({ kind: "check", message: text.slice(5), pass: true });
    }
    print(...args);
  };
}

/** A tool result's value: the AI SDK wraps it as `{ type: "json" | "text" | …, value }`. */
const outputOf = (output: unknown): { output: unknown; error?: true } => {
  if (!output || typeof output !== "object" || !("type" in output)) return { output };
  const { type, value } = output as { type: string; value?: unknown };
  return type.startsWith("error") ? { output: value, error: true } : { output: value ?? output };
};

type PartLike = Record<string, unknown> & { type: string };

function part(content: PartLike): Part {
  switch (content.type) {
    case "text":
      return { type: "text", text: String(content.text) };
    case "reasoning":
      return { type: "reasoning", text: String(content.text) };
    case "tool-call":
      return {
        type: "tool-call",
        id: String(content.toolCallId),
        name: String(content.toolName),
        input: parsed(content.input),
      };
    case "tool-result":
      return {
        type: "tool-result",
        id: String(content.toolCallId),
        name: String(content.toolName),
        ...outputOf(content.output),
      };
    default: {
      const { type, providerOptions: _options, ...value } = content;
      return { type: "other", kind: type, value };
    }
  }
}

const contentPart = (content: LanguageModelV4Content): Part => part(content as unknown as PartLike);

/** The AI SDK's prompt as transcript messages. */
function messagesOf(prompt: LanguageModelV4Prompt): Message[] {
  return prompt.map((message) =>
    message.role === "system"
      ? { role: "system", parts: [{ type: "text", text: message.content }] }
      : { role: message.role, parts: message.content.map((content) => part(content as unknown as PartLike)) },
  );
}

const nameOf = modelNames();

type Generate = LanguageModelV4["doGenerate"];
type Stream = LanguageModelV4["doStream"];

function recordRequest(model: object, options: LanguageModelV4CallOptions): void {
  record({
    kind: "request",
    model: nameOf(model),
    messages: messagesOf(options.prompt),
    tools: (options.tools ?? []).map((tool) => tool.name),
  });
}

function recordResponse(model: object, content: LanguageModelV4Content[], finish: string): void {
  const message: Message = { role: "assistant", parts: content.map(contentPart) };
  // The scripted model answers with exactly what its script holds, ids included.
  record({ kind: "response", model: nameOf(model), message, finish, scripted: toolCallIds(message) });
}

/** Wraps a mock's generate function so it records each request and its answer. */
function recordedGenerate(model: object, generate: Generate): Generate {
  return async (options) => {
    recordRequest(model, options);
    const result = await generate(options);
    recordResponse(model, result.content, result.finishReason.unified);
    return result;
  };
}

/** Wraps a mock's stream function so it records each request, and the answer gathered as its parts pass through. */
function recordedStream(model: object, stream: Stream): Stream {
  return async (options) => {
    recordRequest(model, options);
    const result = await stream(options);
    const content: LanguageModelV4Content[] = [];
    let text = "";
    let finish = "unknown";
    const gather = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform(chunk, controller) {
        if (chunk.type === "text-delta") text += chunk.delta;
        else if (chunk.type === "tool-call") content.push(chunk);
        else if (chunk.type === "finish") finish = chunk.finishReason.unified;
        controller.enqueue(chunk);
      },
      flush() {
        recordResponse(model, text === "" ? content : [{ type: "text", text }, ...content], finish);
      },
    });
    return { ...result, stream: result.stream.pipeThrough(gather) };
  };
}

/**
 * MockLanguageModelV4's constructor assigns `doGenerate` and `doStream` to the instance. A setter of the same name on
 * the prototype receives each assignment and stores the wrapped function on the instance instead, so the class and
 * the code that builds a mock stay as ai/test ships them. If a new mock's methods are not the wrappers, attach() fails.
 */
function attach(): void {
  const proto = MockLanguageModelV4.prototype as unknown as Record<string, unknown>;
  const wrappers = new WeakSet<object>();
  const wraps: Record<string, (model: object, fn: Generate & Stream) => object> = {
    doGenerate: recordedGenerate,
    doStream: recordedStream,
  };
  for (const [name, wrap] of Object.entries(wraps)) {
    Object.defineProperty(proto, name, {
      configurable: true,
      set(this: object, value: Generate & Stream) {
        const wrapped = wrap(this, value);
        wrappers.add(wrapped);
        Object.defineProperty(this, name, { value: wrapped, writable: true, configurable: true });
      },
    });
  }
  // A new mock must hold the wrapped functions themselves, which only the setters above make.
  const probe = new MockLanguageModelV4();
  if (!wrappers.has(probe.doGenerate) || !wrappers.has(probe.doStream)) {
    throw new Error("transcript recorder: MockLanguageModelV4 no longer assigns doGenerate and doStream");
  }
}

if (nonce !== undefined) {
  attach();
  recordChecks();
}
