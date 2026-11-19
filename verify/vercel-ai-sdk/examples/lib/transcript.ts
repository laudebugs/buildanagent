// The AI SDK's side of the transcript recorder (scripts/transcripts/). When the runner preloads the recorder, this file
// attaches it to ai/test's MockLanguageModelV4, so each request and answer of every mock model joins the example's
// transcript; otherwise it does nothing. The recorder only reads the request and the answer, so the model returns
// what it would without it.
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
  record,
  recording,
  toolCallIds,
} from "../../../../scripts/transcripts/events.ts";

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

if (recording) attach();
