import type { AssistantMessage, CatalogEntry, ContentBlock, ModelEvent, RateTier } from "@buildanagent/gateway";
import { emptyUsage } from "@buildanagent/gateway";
import { type MockTransport, markMockTransport } from "@buildanagent/gateway/testing";

export function message(
  stopReason: AssistantMessage["stopReason"],
  content: ContentBlock[] = [],
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    model: { api: "test", provider: "test", id: "test-model" },
    stopReason,
    usage: emptyUsage(),
    cost: { total: null, basis: "unknown", currency: "USD" },
    ...extra,
  };
}

export async function* streamOf<E = ModelEvent>(events: E[]): AsyncIterable<E> {
  for (const event of events) yield event;
}

/** A valid stream: one text block and one tool call, ending in `tool_calls`. */
export function validEvents(): ModelEvent[] {
  const text: ContentBlock = { type: "text", text: "Hi" };
  const call: ContentBlock = { type: "tool_call", callId: "c1", name: "read", input: { path: "a" } };
  return [
    { type: "start" },
    { type: "text_start", index: 0 },
    { type: "text_delta", index: 0, delta: "H" },
    { type: "text_delta", index: 0, delta: "i" },
    { type: "text_end", index: 0, block: text },
    { type: "tool_input_start", index: 1 },
    { type: "tool_input_delta", index: 1, delta: '{"path":"a"}' },
    { type: "tool_input_end", index: 1, block: call },
    { type: "done", message: message("tool_calls", [text, call]) },
  ];
}

/** One rate tier with clearly fake prices, in USD per million tokens. */
export const FAKE_RATES: RateTier = {
  upToInputTokens: null,
  uncachedInput: 2,
  cacheRead: 0.5,
  cacheWrite: { "5m": 4, "1h": 8 },
  output: 16,
};

/** A catalog entry with fake prices for a fake model; `overrides` replaces any field. */
export function fakeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    provider: "test",
    id: "priced",
    rates: [FAKE_RATES],
    contextWindow: 1000,
    maxOutputTokens: 100,
    asOf: "2026-11-01",
    sources: {
      rates: "https://provider.test/pricing",
      contextWindow: "https://provider.test/models",
      maxOutputTokens: "https://provider.test/models",
    },
    ...overrides,
  };
}

/**
 * A transport that passes every request to `inner` and keeps the headers exactly as the adapter sent them. A mock
 * transport records them redacted, so a test of which key goes out, and where, reads them here instead.
 */
export function withSentHeaders(inner: MockTransport): MockTransport & { readonly sent: Record<string, string>[] } {
  const sent: Record<string, string>[] = [];
  const transport = (request: Request): Promise<Response> => {
    sent.push(Object.fromEntries(request.headers.entries()));
    return inner(request);
  };
  // `requests` is one array for the transport's whole life, so the wrapper can share it.
  return markMockTransport(Object.assign(transport, { requests: inner.requests, sent }));
}
