// The mock layer's side of the transcript recorder (scripts/transcripts/record.mjs at the repository root). The
// scripted model reports each request and response here, and check() each assertion. When the runner preloaded the
// recorder, the event joins the example's transcript; otherwise, as when an example runs on its own, nothing happens.
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

/** One part of a message, in the transcript's SDK-neutral shape. */
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

export type TranscriptEvent =
  | { kind: "request"; model: string; messages: Message[]; tools: string[] }
  | { kind: "response"; model: string; message: Message; finish: string }
  | { kind: "check"; message: string; pass: boolean };

const recorder = (globalThis as { [key: symbol]: { record(event: TranscriptEvent): void } | undefined })[
  Symbol.for("buildanagent.transcript")
];

export function record(event: TranscriptEvent): void {
  recorder?.record(event);
}

/** A tool-call input as the model wrote it: the AI SDK carries a JSON string in responses and an object in prompts. */
const parsed = (input: unknown): unknown => {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

/** A tool result's value: the AI SDK wraps it as `{ type: "json" | "text" | …, value }`. */
const outputOf = (output: unknown): { output: unknown; error?: true } => {
  if (!output || typeof output !== "object" || !("type" in output)) return { output };
  const { type, value } = output as { type: string; value?: unknown };
  return type.startsWith("error") ? { output: value, error: true } : { output: value ?? output };
};

const contentPart = (content: LanguageModelV4Content): Part => part(content as unknown as PartLike);

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

/** The AI SDK's prompt as transcript messages. */
export function messagesOf(prompt: LanguageModelV4Prompt): Message[] {
  return prompt.map((message) =>
    message.role === "system"
      ? { role: "system", parts: [{ type: "text", text: message.content }] }
      : { role: message.role, parts: message.content.map((content) => part(content as unknown as PartLike)) },
  );
}

let models = 0;

/**
 * Attaches the recorder to a mock model: each call records the request, then the answer, which for a stream is
 * gathered from its parts as they pass through unchanged. The transcript names models in the order they were made.
 */
export function recordedModel(model: Pick<LanguageModelV4, "doGenerate" | "doStream">): void {
  const name = `model-${++models}`;
  const generate = model.doGenerate.bind(model);
  const stream = model.doStream.bind(model);
  const request = (options: LanguageModelV4CallOptions) =>
    record({
      kind: "request",
      model: name,
      messages: messagesOf(options.prompt),
      tools: (options.tools ?? []).map((tool) => tool.name),
    });
  const response = (content: LanguageModelV4Content[], finish: string) =>
    record({ kind: "response", model: name, message: { role: "assistant", parts: content.map(contentPart) }, finish });
  model.doGenerate = async (options) => {
    request(options);
    const result = await generate(options);
    response(result.content, result.finishReason.unified);
    return result;
  };
  model.doStream = async (options) => {
    request(options);
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
        response(text === "" ? content : [{ type: "text", text }, ...content], finish);
      },
    });
    return { ...result, stream: result.stream.pipeThrough(gather) };
  };
}
