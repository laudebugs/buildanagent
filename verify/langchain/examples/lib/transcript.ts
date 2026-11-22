// LangChain's side of the transcript recorder (scripts/transcripts/). When the runner preloads the recorder, this
// file wraps the model that langchain's fakeModel() builds, so each request and answer of every fake model joins the
// example's transcript, and wraps an agent's invoke, stream and streamEvents, so those events carry the example line
// that started the run; otherwise it does nothing. The wrappers only read what goes in and comes out, so the model
// returns what it would without them.
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { createAgent, fakeModel } from "langchain";
import {
  answerFacts,
  type Message,
  modelNames,
  type Part,
  parsed,
  record,
  recordCallers,
  recording,
  reportedUsage,
  toolCallIds,
  type Usage,
} from "../../../../scripts/transcripts/events.ts";

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
      ...contentParts(message.content).map(withoutDerivedText),
      ...(calls ?? []).map(
        (call): Part => ({ type: "tool-call", id: call.id ?? "", name: call.name, input: call.args }),
      ),
    ],
  };
}

/** The usage metadata a LangChain AI message may carry; fakeModel() adds none, so only a scripted message has it. */
interface UsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number; cache_creation?: number };
  output_token_details?: { reasoning?: number };
}

/**
 * A scripted answer's usage in the transcript's classes. LangChain's `input_tokens` counts every input token, cached
 * or not, so the uncached part is what is left once both cache classes are known; with either missing it is left out.
 * Its `output_tokens` already includes the reasoning tokens.
 */
function usageOf(message: BaseMessage): Usage | undefined {
  const metadata = (message as BaseMessage & { usage_metadata?: UsageMetadata }).usage_metadata;
  if (metadata === undefined) return undefined;
  const cacheRead = metadata.input_token_details?.cache_read;
  const cacheWrite = metadata.input_token_details?.cache_creation;
  const uncachedInput =
    metadata.input_tokens !== undefined && cacheRead !== undefined && cacheWrite !== undefined
      ? metadata.input_tokens - cacheRead - cacheWrite
      : undefined;
  return reportedUsage({
    uncachedInput,
    cacheRead,
    cacheWrite,
    output: metadata.output_tokens,
    reasoning: metadata.output_token_details?.reasoning,
  });
}

/** The model id a scripted answer names in its response metadata; fakeModel() names none. */
function modelIdOf(message: BaseMessage): string | undefined {
  const metadata = (message.response_metadata ?? {}) as { model_name?: unknown; model?: unknown };
  const id = metadata.model_name ?? metadata.model;
  return typeof id === "string" ? id : undefined;
}

/** The private fields of fakeModel()'s class that the recorder reads; attach() checks they still exist. */
interface FakeModel {
  _state: object & { callIndex: number };
  _tools: { name?: string; function?: { name?: string } }[];
  queue: { kind: string }[];
  _generate(messages: BaseMessage[], options: unknown, runManager?: unknown): Promise<ChatResult>;
}

/** A model with tools bound shares its original's state, so the state names the model. */
const nameOf = modelNames();

/**
 * The text the fake model built for queued tool calls. It joins every message before the call, so it grows with each
 * step and says nothing; wherever it appears, in the answer or resent in a later request, the transcript keeps only
 * its length, as a `derived-text` part.
 */
const derivedTexts = new Set<string>();

function withoutDerivedText(part: Part): Part {
  return part.type === "text" && derivedTexts.has(part.text)
    ? { type: "other", kind: "derived-text", value: { characters: part.text.length } }
    : part;
}

function attach(): void {
  const proto = Object.getPrototypeOf(fakeModel()) as FakeModel;
  const sample = fakeModel() as unknown as FakeModel;
  const generate = proto._generate;
  if (
    typeof generate !== "function" ||
    !sample._state ||
    !Array.isArray(sample._tools) ||
    !Array.isArray(sample.queue)
  ) {
    throw new Error("transcript recorder: fakeModel()'s _generate, _state, _tools or queue has changed");
  }
  proto._generate = async function (this: FakeModel, messages, options, runManager) {
    const model = nameOf(this._state);
    const derived = this.queue[this._state.callIndex]?.kind === "toolCalls";
    record({
      kind: "request",
      model,
      messages: messages.map(messageOf),
      tools: this._tools.map((tool) => tool.name ?? tool.function?.name ?? ""),
    });
    const result = await generate.call(this, messages, options, runManager);
    const answer = result.generations[0]?.message;
    if (answer) {
      if (derived && typeof answer.content === "string") derivedTexts.add(answer.content);
      const message = messageOf(answer);
      const finish = message.parts.some((part) => part.type === "tool-call") ? "tool-calls" : "stop";
      // The answer is the queued one: its tool-call ids are the script's, or the fake model's own counter, and any usage
      // or model id it carries is the script's.
      record({
        kind: "response",
        model,
        message,
        finish,
        ...answerFacts(usageOf(answer), modelIdOf(answer)),
        scripted: toolCallIds(message),
      });
    }
    return result;
  };
  // LangGraph runs each model call away from the example's stack, so the call that starts a run lends it its line.
  recordCallers(Object.getPrototypeOf(createAgent({ model: fakeModel(), tools: [] })), [
    "invoke",
    "stream",
    "streamEvents",
  ]);
}

if (recording) attach();
