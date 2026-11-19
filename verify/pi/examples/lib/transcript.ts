// The mock layer's side of the transcript recorder (scripts/transcripts/record.mjs at the repository root). faux.ts
// wraps each scripted step of the faux provider with recordedSteps(), so each request and response joins the example's
// transcript, and check() reports each assertion. When the runner did not preload the recorder, as when an example
// runs on its own, nothing is recorded. A wrapped step returns the same message the scripted step does.
import type { AssistantMessage, FauxResponseStep, Message as PiMessage } from "@earendil-works/pi-ai";

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

/** A tool-call input as the model wrote it: JSON text is parsed, anything else is kept. */
export const parsed = (input: unknown): unknown => {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };

function partOf(block: Block): Part {
  if (block.type === "text") return { type: "text", text: block.text ?? "" };
  if (block.type === "thinking") return { type: "reasoning", text: block.thinking ?? "" };
  if (block.type === "toolCall") {
    return { type: "tool-call", id: block.id ?? "", name: block.name ?? "", input: block.arguments };
  }
  const { type, ...value } = block;
  return { type: "other", kind: type, value };
}

const partsOf = (content: string | Block[]): Part[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : content.map(partOf);

/** One Pi message as a transcript message; a system message keeps its text and the names of its prompt sections. */
function messageOf(message: PiMessage): Message {
  switch (message.role) {
    case "system": {
      const sections = Object.keys(message.sections ?? {});
      return {
        role: "system",
        parts: [
          ...partsOf(message.content as string | Block[]),
          ...(sections.length > 0 ? [{ type: "other" as const, kind: "sections", value: sections }] : []),
        ],
      };
    }
    case "user":
      return { role: "user", parts: partsOf(message.content as string | Block[]) };
    case "assistant":
      return { role: "assistant", parts: partsOf(message.content as Block[]) };
    case "toolResult":
      return {
        role: "tool",
        parts: [
          {
            type: "tool-result",
            id: message.toolCallId,
            name: message.toolName,
            output: partsOf(message.content as Block[])
              .map((part) => ("text" in part ? part.text : ""))
              .join(""),
            ...(message.isError ? { error: true as const } : {}),
          },
        ],
      };
  }
}

/** The tools a request offers: those its system messages add, less those they remove, in order. */
function toolsOf(messages: readonly PiMessage[]): string[] {
  const tools: string[] = [];
  for (const message of messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsRemoved ?? []) {
      const at = tools.indexOf(tool.name);
      if (at !== -1) tools.splice(at, 1);
    }
    for (const tool of message.toolsAdded ?? []) if (!tools.includes(tool.name)) tools.push(tool.name);
  }
  return tools;
}

let models = 0;

/**
 * The scripted steps of one faux provider, each wrapped to record the request it answers and the message it returns.
 * The transcript names each faux provider in the order its steps were scripted.
 */
export function recordedSteps(steps: FauxResponseStep[]): FauxResponseStep[] {
  const model = `model-${++models}`;
  return steps.map((step) => async (context, options, state, fauxModel) => {
    record({ kind: "request", model, messages: context.messages.map(messageOf), tools: toolsOf(context.messages) });
    const answer: AssistantMessage = typeof step === "function" ? await step(context, options, state, fauxModel) : step;
    const message = messageOf(answer);
    record({ kind: "response", model, message, finish: answer.stopReason });
    return answer;
  });
}
