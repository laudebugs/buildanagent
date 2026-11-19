/**
 * Adapter doubles for the gateway runtime tests. The SDK's `ScriptedModel` cannot be imported here, because the SDK
 * depends on the gateway; `packages/sdk/test` runs it through `createModel()` instead.
 */
import {
  type AssistantMessage,
  assertModelRequestAllowed,
  type ContentBlock,
  classifyError,
  type ErrorKind,
  emptyUsage,
  type ModelAdapter,
  type ModelCaps,
  type ModelContext,
  type ModelEvent,
  type ModelRef,
  type ProviderConfig,
  resolveProviderConfig,
  type StreamOptions,
} from "@buildanagent/gateway";
import { markMockTransport } from "@buildanagent/gateway/testing";

export const TEST_CAPS: ModelCaps = { contextWindow: 1000, maxOutputTokens: 100, images: false, reasoning: false };

export const context: ModelContext = {
  system: "be brief",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
};

/** One scripted attempt: a reply, or a failure before or after the first text delta. */
export type Attempt = { reply: string } | { fail: ErrorKind; afterOutput?: boolean; message?: string };

function terminal(model: ModelRef, content: ContentBlock[], attempt: Attempt): ModelEvent {
  const base = { role: "assistant", content, model, usage: emptyUsage(), cost: { total: null, basis: "unknown" } };
  if ("reply" in attempt) return { type: "done", message: { ...base, stopReason: "stop" } as AssistantMessage };
  const error = { kind: attempt.fail, message: attempt.message ?? `${attempt.fail} failure` };
  return { type: "error", message: { ...base, stopReason: "error", error } as AssistantMessage };
}

async function* runAttempt(model: ModelRef, attempt: Attempt, withStart = true): AsyncGenerator<ModelEvent> {
  if (withStart) yield { type: "start" };
  const text = "reply" in attempt ? attempt.reply : "partial";
  if ("fail" in attempt && !attempt.afterOutput) {
    yield terminal(model, [], attempt);
    return;
  }
  yield { type: "text_start", index: 0 };
  yield { type: "text_delta", index: 0, delta: text };
  if ("fail" in attempt) {
    yield terminal(model, [{ type: "text", text }], attempt);
    return;
  }
  const block: ContentBlock = { type: "text", text };
  yield { type: "text_end", index: 0, block };
  yield terminal(model, [block], attempt);
}

/** Plays one `Attempt` per call, in order, and records each call's options. Throws on a call past the script. */
export class FailingAdapter implements ModelAdapter {
  readonly specificationVersion = "v1";
  readonly api = "test-api";
  readonly provider = "test";
  readonly defaultCaps: ModelCaps = TEST_CAPS;
  readonly calls: StreamOptions[] = [];
  readonly #attempts: Attempt[];

  constructor(attempts: Attempt[]) {
    this.#attempts = attempts;
  }

  stream(model: ModelRef, _context: ModelContext, options: StreamOptions): AsyncIterable<ModelEvent> {
    const attempt = this.#attempts[this.calls.length];
    if (attempt === undefined) throw new Error(`FailingAdapter: call ${this.calls.length + 1} has no attempt`);
    this.calls.push(options);
    return runAttempt(model, attempt);
  }
}

/** One request a recording transport saw. */
export interface RecordedHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A mock transport that records every request and answers each with the next `[status, json]` pair. */
export function recordingTransport(responses: [number, unknown][]) {
  const requests: RecordedHttpRequest[] = [];
  const transport = markMockTransport(async (request: Request) => {
    requests.push({ url: request.url, headers: Object.fromEntries(request.headers), body: await request.text() });
    const next = responses.shift();
    if (next === undefined) throw new Error("recordingTransport: no response left");
    return new Response(JSON.stringify(next[1]), { status: next[0] });
  });
  return { transport, requests };
}

async function* httpAttempt(
  send: (body: unknown) => Promise<Response>,
  model: ModelRef,
  context: ModelContext,
  options: StreamOptions,
): AsyncGenerator<ModelEvent> {
  const draft = { model: model.id, system: context.system, messages: context.messages };
  const response = await send(options.onPayload ? options.onPayload(draft) : draft);
  const json = (await response.json()) as { text?: string; error?: { type?: string; message?: string } };
  yield { type: "start" };
  if (!response.ok) {
    const kind = classifyError({ status: response.status, ...json.error });
    const failure: Attempt = { fail: kind, message: json.error?.message ?? `HTTP ${response.status}` };
    yield terminal(model, [], failure);
    return;
  }
  yield* runAttempt(model, { reply: json.text ?? "" }, false);
}

/** A minimal HTTP adapter built the way real adapters are: `resolveProviderConfig()`, then one request per call. */
export function httpTestAdapter(config: ProviderConfig): ModelAdapter {
  const resolved = resolveProviderConfig(config, { baseURL: "https://api.provider.test" });
  const send = (body: unknown): Promise<Response> => {
    assertModelRequestAllowed(resolved.transport);
    const headers = { "content-type": "application/json", ...resolved.headers, "x-api-key": resolved.apiKey };
    const init = { method: "POST", headers, body: JSON.stringify(body) };
    return resolved.transport(new Request(`${resolved.baseURL}/v1/messages`, init));
  };
  return {
    specificationVersion: "v1",
    api: "test-http",
    provider: "test-http",
    defaultCaps: TEST_CAPS,
    stream: (model, context, options) => httpAttempt(send, model, context, options),
  };
}

/** A `Sleep` that resolves at once and records each delay. */
export function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms);
  };
  return { sleep, delays };
}

export async function collect<E>(events: AsyncIterable<E>): Promise<E[]> {
  const out: E[] = [];
  for await (const event of events) out.push(event);
  return out;
}
