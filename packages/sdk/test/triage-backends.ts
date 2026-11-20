// The three model backends the triage capstone runs on: the scripted model and the Anthropic and Chat Completions
// mock transports. Each plays the same neutral script, a list of turns, so one set of cases covers every backend and
// each backend records the tool names of every request it received.
import { createModel, type Model } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";
import {
  chatCompletionEvents,
  mockTransport,
  serverSentEvents,
  type WireApi,
  type WireResponse,
} from "@buildanagent/gateway/testing";
import { ScriptedModel } from "@buildanagent/sdk/testing";

/** One tool call the scripted model makes. */
export interface ScriptedCall {
  readonly name: string;
  readonly input: unknown;
}

/** One model response: some text, tool calls, or both, and the input tokens it reports (default `DEFAULT_INPUT`). */
export interface Turn {
  readonly text?: string;
  readonly calls?: readonly ScriptedCall[];
  readonly inputTokens?: number;
}

/** A model over a script, with what it was asked. */
export interface Fixture {
  readonly model: Model;
  /** The tool names of each request the model received, in order. */
  toolNames(): string[][];
  /** Throws if a turn went unplayed or the run asked for more turns than the script has. */
  assertComplete(): void;
}

/** A way to build a `Fixture`. `idBase` keeps tool-call ids unique across two fixtures that share a conversation. */
export interface Backend {
  readonly name: string;
  fixture(turns: readonly Turn[], idBase: string): Fixture;
}

const KEY = "sk-test-not-a-real-key";
const DEFAULT_INPUT = 200;
const OUTPUT_TOKENS = 50;
const CHUNK_SIZE = 13;

function callId(idBase: string, turn: number, index: number): string {
  return `call_${idBase}${turn}_${index}`;
}

/** The scripted model, priced as Claude Opus 5.5 so a budget has a rate to project with. */
export const scriptedBackend: Backend = {
  name: "ScriptedModel",
  fixture(turns, idBase) {
    const steps = turns.map((turn, t) => ({
      content: [
        ...(turn.text === undefined ? [] : [{ type: "text" as const, text: turn.text }]),
        ...(turn.calls ?? []).map((call, i) => ({ type: "tool_call" as const, callId: callId(idBase, t, i), ...call })),
      ],
      usage: { uncachedInput: turn.inputTokens ?? DEFAULT_INPUT, output: OUTPUT_TOKENS },
    }));
    const adapter = new ScriptedModel(steps, { ref: { provider: "anthropic" } });
    return {
      model: createModel({ adapter, id: "claude-opus-5-5", retries: 0 }),
      toolNames: () => adapter.calls.map((call) => call.context.tools.map((tool) => tool.name)),
      assertComplete: () => adapter.assertComplete(),
    };
  },
};

/** A server-sent event of the Messages API: its `type` and whatever else it carries. */
type WireEvent = { type: string } & Record<string, unknown>;

export function anthropicBody(turn: Turn, t: number, idBase: string): string {
  const blocks: WireEvent[] = [];
  if (turn.text !== undefined) {
    blocks.push(
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: turn.text } },
      { type: "content_block_stop", index: 0 },
    );
  }
  (turn.calls ?? []).forEach((call, i) => {
    const index = blocks.length;
    const json = JSON.stringify(call.input);
    const half = Math.ceil(json.length / 2);
    blocks.push(
      {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: callId(idBase, t, i), name: call.name, input: {} },
      },
      { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(0, half) } },
      { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(half) } },
      { type: "content_block_stop", index },
    );
  });
  const message = {
    id: `msg_${idBase}${t}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [],
    stop_reason: null,
    usage: { input_tokens: turn.inputTokens ?? DEFAULT_INPUT, output_tokens: 1 },
  };
  const stop = turn.calls?.length ? "tool_use" : "end_turn";
  const events: WireEvent[] = [
    { type: "message_start", message },
    ...blocks,
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: OUTPUT_TOKENS } },
    { type: "message_stop" },
  ];
  return serverSentEvents(events);
}

function chatBody(turn: Turn, t: number, idBase: string): string {
  const base = { id: `chatcmpl-${idBase}${t}`, object: "chat.completion.chunk", model: "gpt-5.4-mini" };
  const chunk = (delta: object, finish: string | null = null) => ({
    ...base,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const calls = (turn.calls ?? []).flatMap((call, index) => {
    const json = JSON.stringify(call.input);
    const half = Math.ceil(json.length / 2);
    const function_ = (args: string, name?: string) => ({ ...(name ? { name } : {}), arguments: args });
    return [
      chunk({
        tool_calls: [{ index, id: callId(idBase, t, index), type: "function", function: function_("", call.name) }],
      }),
      chunk({ tool_calls: [{ index, function: function_(json.slice(0, half)) }] }),
      chunk({ tool_calls: [{ index, function: function_(json.slice(half)) }] }),
    ];
  });
  const input = turn.inputTokens ?? DEFAULT_INPUT;
  const usage = { prompt_tokens: input, completion_tokens: OUTPUT_TOKENS, total_tokens: input + OUTPUT_TOKENS };
  return chatCompletionEvents([
    chunk({ role: "assistant", content: turn.text ?? null }),
    ...calls,
    chunk({}, turn.calls?.length ? "tool_calls" : "stop"),
    { ...base, choices: [], usage },
  ]);
}

function wireBackend(
  name: string,
  api: WireApi,
  body: (turn: Turn, t: number, idBase: string) => string,
  adapterAndId: (transport: ReturnType<typeof mockTransport>) => { model: Model },
  namesOf: (request: unknown) => string[],
): Backend {
  return {
    name,
    fixture(turns, idBase) {
      const script: WireResponse[] = turns.map((turn, t) => ({ body: body(turn, t, idBase), chunkSize: CHUNK_SIZE }));
      const transport = mockTransport(api, script);
      return {
        model: adapterAndId(transport).model,
        toolNames: () => transport.requests.map((request) => namesOf(request.body)),
        assertComplete() {
          if (transport.requests.length !== script.length) {
            throw new Error(`${name}: ${transport.requests.length} requests for a script of ${script.length} turns`);
          }
        },
      };
    },
  };
}

interface WireTools {
  tools?: { name?: string; function?: { name: string } }[];
}

const namesIn = (request: unknown): string[] =>
  ((request as WireTools).tools ?? []).map((tool) => tool.function?.name ?? tool.name ?? "");

/** The Anthropic adapter over its mock transport. */
export const anthropicBackend: Backend = wireBackend(
  "Anthropic mock transport",
  "anthropic-messages",
  anthropicBody,
  (transport) => ({
    model: createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: "claude-opus-5-5", retries: 0 }),
  }),
  namesIn,
);

/** The Chat Completions adapter over its mock transport. */
export const chatBackend: Backend = wireBackend(
  "Chat Completions mock transport",
  "openai-chat",
  chatBody,
  (transport) => ({
    model: createModel({ adapter: openaiChat({ apiKey: KEY, transport }), id: "gpt-5.4-mini", retries: 0 }),
  }),
  namesIn,
);
