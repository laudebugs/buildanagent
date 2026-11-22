// A stub of Anthropic's Messages API for the book's examples on retries, caching and the wire format. It is the
// transport under the gateway's real Anthropic adapter: it answers each HTTP request with a status the example
// queued, or with a stream in Messages format whose usage follows the request. A prefix marked with `cache_control`
// is written to the stub's cache on its first request and read from it on the next, the way a provider reports it.
// The stub models only the system prompt's breakpoint; the gateway's adapter marks up to three.
import type { ModelAdapter, Sleep } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { markMockTransport, serverSentEvents } from "@buildanagent/gateway/testing";
import { wireEvents } from "./check.js";
import { recordedAdapter } from "./transcript.js";

/** The stub answers every call with this text. */
export const ANSWER = "Refunds take five days.";
export const ANSWER_TOKENS = 20;

/** The stub counts four characters to the token. */
export const tokensIn = (text: string) => Math.ceil(text.length / 4);

/** The parts of a Messages request the stub reads. */
interface WireRequest {
  system?: { text: string; cache_control?: unknown }[];
  messages: { content: { type: string; text?: string }[] }[];
}

export interface AnthropicStub {
  readonly transport: (request: Request) => Promise<Response>;
  /** HTTP statuses to answer before the next success, in order. A status of 400 or more gets an error body. */
  readonly failures: number[];
  /** Every request body the stub received, in order, failed attempts included. */
  readonly requests: WireRequest[];
}

const ERROR_TYPES: Record<number, string> = {
  401: "authentication_error",
  429: "rate_limit_error",
  529: "overloaded_error",
};

export function anthropicStub(): AnthropicStub {
  const failures: number[] = [];
  const requests: WireRequest[] = [];
  const cached = new Set<string>();
  const transport = markMockTransport(async (request: Request) => {
    const body = (await request.json()) as WireRequest;
    requests.push(body);
    const status = failures.shift();
    if (status !== undefined) {
      const error = { type: "error", error: { type: ERROR_TYPES[status] ?? "api_error", message: "scripted failure" } };
      return Response.json(error, { status });
    }
    const prefix = (body.system ?? []).map((block) => block.text).join("");
    const marked = (body.system ?? []).some((block) => block.cache_control !== undefined);
    const hit = marked && cached.has(prefix);
    if (marked) cached.add(prefix);
    const rest = tokensIn(body.messages.map((m) => m.content.map((c) => c.text ?? "").join("")).join(""));
    const usage = {
      uncachedInput: marked ? rest : rest + tokensIn(prefix),
      cacheRead: hit ? tokensIn(prefix) : 0,
      cacheWrite: marked && !hit ? tokensIn(prefix) : 0,
      output: ANSWER_TOKENS,
    };
    const events = wireEvents(ANSWER, usage, "claude-sonnet-5-5");
    return new Response(serverSentEvents(events), { headers: { "content-type": "text/event-stream" } });
  });
  return { transport, failures, requests };
}

/** A sleep that returns at once, so the gateway's 2 and 4 second backoffs cost the example nothing. */
export const instantly: Sleep = async () => {};

/** The classes the stub's Messages stream reports. */
const REPORTED = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

/**
 * The gateway's own `anthropic({ apiKey, transport })` adapter on the stub's transport, with the book's transcript
 * recorder around it when the test preloads one. The recorder lists the four usage classes only for an answer the
 * stub streamed, because a failed attempt reports none, and the gateway's zero for it would read as a measurement.
 */
export function anthropicOver(stub: AnthropicStub): ModelAdapter {
  const adapter = anthropic({ apiKey: "not-a-real-key", transport: stub.transport });
  return recordedAdapter(adapter, (event) => (event.type === "done" ? REPORTED : undefined));
}
