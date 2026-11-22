// Shared helpers for the book's examples on our gateway: an assertion helper and a scripted model. The book lists
// these examples beside the third-party ones (apps/manual), and scripts/transcripts/book-examples.ts runs each one
// offline and records its transcript.
//
// The offline setup comes first, as in every test under packages/: a set provider key
// stops the example, and no request can leave this machine.
import "@buildanagent/gateway/testing/setup";
import { createModel, type Model } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { mockTransport, serverSentEvents } from "@buildanagent/gateway/testing";
// Attaches the transcript recorder when the test preloads it (scripts/transcripts/).
import { lendCallerLine, recordedAdapter, SCRIPTED_MODEL_ID, type ScriptedUsage } from "./transcript.js";

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

export interface Script {
  /** The model id behind `createModel()`. Defaults to an id the catalog lacks, so the answer's price is unknown. */
  modelId?: string;
  /** The usage the stream reports. Left out, the stream reports none and the gateway marks the usage unreported. */
  usage?: ScriptedUsage;
}

/** Splits text after each space, the way the AI SDK harness's mock model does, so both tabs stream the same deltas. */
export function pieces(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/** One event of an Anthropic Messages stream: its type, and the fields that type carries. */
export type WireEvent = { type: string; [field: string]: unknown };

/** The events of one Anthropic Messages stream that answers with `text`, one delta per piece. */
export function wireEvents(text: string, usage: ScriptedUsage | undefined, modelId: string): WireEvent[] {
  const start = usage && {
    input_tokens: usage.uncachedInput ?? 0,
    cache_read_input_tokens: usage.cacheRead ?? 0,
    cache_creation_input_tokens: usage.cacheWrite ?? 0,
    cache_creation: { ephemeral_5m_input_tokens: usage.cacheWrite ?? 0, ephemeral_1h_input_tokens: 0 },
    output_tokens: 1,
  };
  return [
    {
      type: "message_start",
      message: { id: "msg_scripted", type: "message", role: "assistant", model: modelId, content: [], usage: start },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...pieces(text).map((piece) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: piece },
    })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: usage && { ...start, output_tokens: usage.output ?? 0 },
    },
    { type: "message_stop" },
  ];
}

/**
 * A model that answers one call with `text`, streamed one delta per word. It is the gateway's real Anthropic adapter
 * reading a scripted Messages stream from `mockTransport()`, so the example runs the gateway's own parsing, usage
 * mapping and cost fold with no key and no network. `requests` holds what the adapter sent.
 */
export function scripted(text: string, script: Script = {}): { model: Model; requests: readonly { body: unknown }[] } {
  const modelId = script.modelId ?? SCRIPTED_MODEL_ID;
  const transport = mockTransport("anthropic-messages", [
    { body: serverSentEvents(wireEvents(text, script.usage, modelId)) },
  ]);
  const adapter = recordedAdapter(anthropic({ apiKey: "test-key", transport }), script.usage);
  return { model: lendCallerLine(createModel({ adapter, id: modelId })), requests: transport.requests };
}
