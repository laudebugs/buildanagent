// The mock layer's side of the transcript recorder (scripts/transcripts/record.mjs at the repository root). Importing
// this file attaches the recorder to the model that langchain's fakeModel() builds, so each request and response of
// every fake model joins the example's transcript; check() reports each assertion. When the runner did not preload
// the recorder, as when an example runs on its own, nothing is recorded. Recording only reads the messages going in
// and coming out, so it changes nothing the model returns.
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { fakeModel } from "langchain";

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

type Block = Record<string, unknown> & { type?: string };

/** A message's content as transcript parts: a string, or a list of content blocks. */
function contentParts(content: BaseMessage["content"]): Part[] {
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
  return (content as Block[]).map((block) =>
    block.type === "text" && typeof block.text === "string"
      ? { type: "text", text: block.text }
      : { type: "other", kind: String(block.type), value: block },
  );
}

const ROLE: Record<string, Message["role"]> = { human: "user", ai: "assistant", system: "system", tool: "tool" };

/** One LangChain message as a transcript message. */
function messageOf(message: BaseMessage): Message {
  const type = message.getType();
  const role = ROLE[type] ?? "user";
  if (type === "tool") {
    const tool = message as BaseMessage & { tool_call_id: string; name?: string; status?: string };
    return {
      role,
      parts: [
        {
          type: "tool-result",
          id: tool.tool_call_id,
          name: tool.name ?? "",
          output: parsed(typeof tool.content === "string" ? tool.content : contentParts(tool.content)),
          ...(tool.status === "error" ? { error: true as const } : {}),
        },
      ],
    };
  }
  const calls = (message as BaseMessage & { tool_calls?: { id?: string; name: string; args: unknown }[] }).tool_calls;
  return {
    role,
    parts: [
      ...contentParts(message.content),
      ...(calls ?? []).map(
        (call): Part => ({ type: "tool-call", id: call.id ?? "", name: call.name, input: call.args }),
      ),
    ],
  };
}

interface FakeModel {
  _state: object;
  _tools: { name?: string; function?: { name?: string } }[];
  _generate(messages: BaseMessage[], options: unknown, runManager?: unknown): Promise<ChatResult>;
}

/** The transcript names each fake model in the order of its first request; a model with tools bound is the same one. */
const names = new WeakMap<object, string>();
let models = 0;
const nameOf = (state: object): string => {
  let name = names.get(state);
  if (name === undefined) {
    name = `model-${++models}`;
    names.set(state, name);
  }
  return name;
};

const proto = Object.getPrototypeOf(fakeModel()) as FakeModel;
const generate = proto._generate;
proto._generate = async function (this: FakeModel, messages, options, runManager) {
  const model = nameOf(this._state);
  record({
    kind: "request",
    model,
    messages: messages.map(messageOf),
    tools: this._tools.map((tool) => tool.name ?? tool.function?.name ?? ""),
  });
  const result = await generate.call(this, messages, options, runManager);
  const answer = result.generations[0]?.message;
  if (answer) {
    const message = messageOf(answer);
    const finish = message.parts.some((part) => part.type === "tool-call") ? "tool-calls" : "stop";
    record({ kind: "response", model, message, finish });
  }
  return result;
};
