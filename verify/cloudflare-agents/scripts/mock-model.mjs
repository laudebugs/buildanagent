// A request-aware mock language model for the AI SDK, built on ai/test's MockLanguageModelV4. It is
// bundled into every doc-example Worker, so Think, AIChatAgent and plain streamText calls all run
// offline inside workerd. Copied from verify/vercel-ai-sdk/scripts/mock-model.mjs. Per call:
//   1. After a tool result -> answer (schema-shaped JSON when the call asks for JSON output).
//   2. Else, if a function tool is offered and none has been called -> call one with arguments
//      synthesised from its JSON Schema, preferring a tool the prompt names.
//   3. Else -> answer.
// Provider-defined tools are never called, and function tools whose names suggest host access
// (bash, shell, exec, write, edit, delete, …) are denied by name. Each call logs MOCK_MARKER, which
// the runner counts in workerd's output.
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const HOST_TOOL = /bash|shell|exec|command|terminal|write|edit|delete|remove|apply_patch|computer|sandbox/i;

export function synth(schema = {}, depth = 0) {
  if (depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.anyOf || schema.oneOf) return synth((schema.anyOf ?? schema.oneOf)[0], depth + 1);
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  switch (t) {
    case "string":
      return schema.format === "email" ? "user@example.com" : "example";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return false;
    case "array":
      return [synth(schema.items ?? {}, depth + 1)];
    default: {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = synth(v, depth + 1);
      return out;
    }
  }
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

let seq = 0;
export const MOCK_MARKER = "[verify-harness] mock model call";
export const stats = { calls: 0 };

/** Decide one response: a tool call or a text answer. */
export function decide(options) {
  stats.calls++;
  console.log(MOCK_MARKER);
  const prompt = options.prompt ?? [];
  const answer = () =>
    options.responseFormat?.type === "json"
      ? { text: JSON.stringify(synth(options.responseFormat.schema ?? {})) }
      : { text: "Mock model: hello from the offline model." };
  if (prompt.at(-1)?.role === "tool") return answer();
  const called = prompt.some((m) => m.role === "assistant" && m.content?.some?.((p) => p.type === "tool-call"));
  const tools = (options.tools ?? []).filter((t) => t.type === "function" && !HOST_TOOL.test(t.name));
  const said = JSON.stringify(prompt.filter((m) => m.role === "user"));
  const tool = tools.find((t) => said.includes(t.name)) ?? tools[0];
  if (tool && !called)
    return {
      toolCall: {
        toolCallId: `call_mock_${++seq}`,
        toolName: tool.name,
        input: JSON.stringify(synth(tool.inputSchema)),
      },
    };
  return answer();
}

export function mockModel(modelId = "mock-model") {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (options) => {
      const d = decide(options);
      return d.toolCall
        ? {
            content: [{ type: "tool-call", ...d.toolCall }],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: "text", text: d.text }],
            finishReason: { unified: "stop", raw: undefined },
            usage,
            warnings: [],
          };
    },
    doStream: async (options) => {
      const d = decide(options);
      const chunks = d.toolCall
        ? [{ type: "tool-call", ...d.toolCall }]
        : [
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: d.text },
            { type: "text-end", id: "t1" },
          ];
      chunks.push({
        type: "finish",
        finishReason: { unified: d.toolCall ? "tool-calls" : "stop", raw: undefined },
        usage,
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

const notMocked = (kind) => () => {
  throw new Error(`verify harness: ${kind} models are not mocked`);
};

/**
 * A provider whose language models are all mocks. `real` (optional) supplies any other members;
 * embedding, image, speech and transcription models throw.
 */
export function mockProvider(real, name) {
  const model = (id) => mockModel(`${name}:${id}`);
  const methods = new Set(["languageModel", "chat", "responses", "completion", "messages"]);
  const other = new Set(["embedding", "textEmbedding", "textEmbeddingModel", "embeddingModel", "image", "imageModel"]);
  const base = Object.assign((id) => model(id), real ?? {});
  return new Proxy(base, {
    apply: (_t, _this, args) => model(args[0]),
    get: (t, k) => (methods.has(k) ? (id) => model(id) : other.has(k) ? notMocked(String(k)) : t[k]),
  });
}
