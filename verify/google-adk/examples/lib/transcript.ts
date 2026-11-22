// Google ADK's side of the transcript recorder (scripts/transcripts/). When the runner preloads the recorder,
// recordedLlm() wraps ScriptedLlm's generateContentAsync, so each request and answer of every scripted model joins the
// example's transcript, and wraps Runner.runAsync, so those events carry the example line that started the run;
// otherwise it does nothing. The wrappers only read what goes in and comes out, so the model answers as it would.
import { type LlmRequest, type LlmResponse, Runner } from "@google/adk";
import type { Content, Part as GeminiPart } from "@google/genai";
import {
  answerFacts,
  atCaller,
  type Message,
  modelNames,
  type Part,
  record,
  recording,
  reportedUsage,
  toolCallIds,
  type Usage,
} from "../../../../scripts/transcripts/events.ts";

function partOf(part: GeminiPart): Part {
  if (part.text !== undefined) return { type: part.thought ? "reasoning" : "text", text: part.text };
  if (part.functionCall) {
    const { id = "", name = "", args = {} } = part.functionCall;
    return { type: "tool-call", id, name, input: args };
  }
  if (part.functionResponse) {
    const { id = "", name = "", response } = part.functionResponse;
    return { type: "tool-result", id, name, output: response };
  }
  const [kind = "part"] = Object.keys(part);
  return { type: "other", kind, value: part[kind as keyof GeminiPart] };
}

const messageOf = (content: Content): Message => ({
  role: content.role === "model" ? "assistant" : "user",
  parts: (content.parts ?? []).map(partOf),
});

/** The system instruction, which ADK sends as text or as content. */
function systemOf(request: LlmRequest): Message[] {
  const instruction = request.config?.systemInstruction;
  if (instruction === undefined) return [];
  const text =
    typeof instruction === "string"
      ? instruction
      : ((instruction as Content).parts ?? []).map((part) => (part as GeminiPart).text ?? "").join("");
  return text === "" ? [] : [{ role: "system", parts: [{ type: "text", text }] }];
}

const toolsOf = (request: LlmRequest): string[] =>
  (request.config?.tools ?? [])
    .flatMap((tool) => ("functionDeclarations" in tool ? (tool.functionDeclarations ?? []) : []))
    .map((declaration) => declaration.name ?? "");

/**
 * A scripted answer's usage in the transcript's classes. Gemini's prompt count includes the cached tokens, and it
 * reports no cache writes. It counts thinking apart from the answer, so the output class adds the two, as the
 * transcript's output includes its reasoning.
 */
function usageOf(response: LlmResponse): Usage | undefined {
  const metadata = response.usageMetadata;
  if (metadata === undefined) return undefined;
  const { promptTokenCount: prompt, cachedContentTokenCount: cached, candidatesTokenCount: answer } = metadata;
  const thoughts = metadata.thoughtsTokenCount;
  return reportedUsage({
    uncachedInput: prompt === undefined ? undefined : prompt - (cached ?? 0),
    cacheRead: cached,
    output: answer === undefined ? undefined : answer + (thoughts ?? 0),
    reasoning: thoughts,
  });
}

const nameOf = modelNames();

type Generate = (request: LlmRequest, stream?: boolean) => AsyncGenerator<LlmResponse, void>;

/** Wraps a scripted model class so each request and answer is recorded; it does nothing without the recorder. */
export function recordedLlm(llm: { prototype: { generateContentAsync: Generate } }): void {
  if (!recording) return;
  const generate = llm.prototype.generateContentAsync;
  if (typeof generate !== "function") throw new Error("transcript recorder: the model has no generateContentAsync");
  llm.prototype.generateContentAsync = async function* (this: object, request: LlmRequest, stream?: boolean) {
    const model = nameOf(this);
    const messages = [...systemOf(request), ...request.contents.map(messageOf)];
    record({ kind: "request", model, messages, tools: toolsOf(request) });
    for await (const response of generate.call(this, request, stream)) {
      const message = response.content ? messageOf(response.content) : { role: "assistant" as const, parts: [] };
      const finish = message.parts.some((part) => part.type === "tool-call") ? "tool-calls" : "stop";
      // The scripted model answers with exactly what its script returns, function-call ids, usage and model version
      // included; the model name ScriptedLlm passes to BaseLlm is the helper's own, so it is not recorded.
      const answer: Message = { ...message, role: "assistant" };
      record({
        kind: "response",
        model,
        message: answer,
        finish,
        ...answerFacts(usageOf(response), response.modelVersion),
        scripted: toolCallIds(answer),
      });
      yield response;
    }
  };
  attachRunner();
}

/**
 * ADK runs the model inside Runner.runAsync's generator, away from the example's stack. Each step of the generator
 * runs under the line of the code that asked for it, so the events of a run carry the line of the example's call.
 */
function attachRunner(): void {
  const proto = Runner.prototype as unknown as { runAsync: (...args: unknown[]) => AsyncGenerator<unknown> };
  const runAsync = proto.runAsync;
  if (typeof runAsync !== "function") throw new Error("transcript recorder: Runner has no runAsync");
  proto.runAsync = function (this: unknown, ...args: unknown[]) {
    const events = atCaller(() => runAsync.apply(this, args));
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: (value?: unknown) => atCaller(() => events.next(value)),
      return: (value?: unknown) => events.return(value),
      throw: (error?: unknown) => events.throw(error),
    } as unknown as AsyncGenerator<unknown>;
  };
}
