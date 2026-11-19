/**
 * `openaiChat()`: the OpenAI-compatible Chat Completions adapter over the gateway's `Transport` (D2). It streams every
 * call and posts to `{baseURL}/chat/completions` with `Authorization: Bearer <apiKey>`, as openai-node v7.49.0 does
 * (`src/client.ts`, `src/resources/chat/completions/completions.ts`, as of November 2026). The quirks of other
 * compatible servers come in through `ChatCompat` flags, per adapter or per model.
 */
import { type ResolvedProviderConfig, resolveProviderConfig } from "../../provider-config.js";
import type { ModelAdapter, ModelEvent, StreamOptions } from "../../spec.js";
import type { ModelCaps, ModelContext, ModelRef } from "../../types.js";
import { payloadOf, readEventStream, sendRequest } from "../wire.js";
import { type CompatSettings, compatFor, type OpenAIChatConfig } from "./compat.js";
import { failureEvent, failureFromResponse } from "./failure.js";
import { buildRequest } from "./request.js";
import { ChunkAssembler } from "./response.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// The adapter's `defaultCaps`, for a model with no catalog entry. An unknown model behind a compatible server may
// read text only and may reject reasoning settings, so it is sent no images and asked for no reasoning.
const DEFAULT_CAPS: ModelCaps = { contextWindow: 128_000, maxOutputTokens: 16_384, images: false, reasoning: false };

// Header names the adapter sets itself. A caller's key header is dropped, because `config.apiKey` is the only key
// the adapter sends.
const CALLER_HEADERS_DROPPED = new Set(["authorization", "api-key", "x-api-key"]);

function callerHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const rest: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!CALLER_HEADERS_DROPPED.has(lower)) rest[lower] = value;
  }
  return rest;
}

function requestFor(config: ResolvedProviderConfig, body: unknown, signal: AbortSignal | undefined): Request {
  const headers = {
    ...callerHeaders(config.headers),
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${config.apiKey}`,
  };
  const url = `${config.baseURL.replace(/\/+$/, "")}/chat/completions`;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
}

async function* streamCompletion(
  settings: CompatSettings,
  resolved: ResolvedProviderConfig,
  model: ModelRef,
  context: ModelContext,
  options: StreamOptions,
): AsyncGenerator<ModelEvent> {
  yield { type: "start" };
  const plan = buildRequest(model, context, options, options.caps ?? DEFAULT_CAPS, compatFor(settings, model.id));
  // Each attempt warns again; the gateway's retries stream a repeated warning only once per call.
  yield* plan.warnings;
  const request = requestFor(resolved, payloadOf(plan.body, options), options.signal);
  const response = yield* sendRequest(resolved.transport, request, model, options.signal);
  if (response === undefined) return;
  if (!response.ok) {
    yield failureEvent(model, await failureFromResponse(response));
    return;
  }
  yield* readEventStream(response, model, new ChunkAssembler(model, plan), options.signal);
}

/**
 * Creates an adapter for OpenAI's Chat Completions API or a server compatible with it. Every request goes to
 * `{baseURL}/chat/completions` through `config.transport`, streams its response, and sends the key from
 * `config.apiKey` as a bearer token; it is the only key the adapter sends. `baseURL` defaults to
 * `https://api.openai.com/v1`. Throws a `GatewayError` with code `missing_api_key` when the key is missing or empty.
 *
 * The adapter reports the provider `config.provider`, `"openai"` by default, which is the name `createModel()` looks
 * the model up under in the price catalog. `config.compat` sets the server's quirks for every model, and
 * `config.modelCompat` for single models by id. The model's caps come from `options.caps`, which `createModel()`
 * sets; a direct call without them uses `defaultCaps`, which send no images.
 *
 * Caller headers from `config.headers` are sent with lower-case names; a caller `authorization`, `api-key` or
 * `x-api-key` is dropped. `providerOptions.openaiChat.extraBody` adds fields to the request body, such as
 * `reasoning_effort`.
 */
export function openaiChat(config: OpenAIChatConfig): ModelAdapter {
  const resolved = resolveProviderConfig(config, { baseURL: DEFAULT_BASE_URL });
  // Copied, so a caller who changes the objects later does not change the adapter's requests.
  const settings: CompatSettings = {
    ...(config.compat ? { compat: { ...config.compat } } : {}),
    ...(config.modelCompat
      ? { modelCompat: Object.fromEntries(Object.entries(config.modelCompat).map(([id, own]) => [id, { ...own }])) }
      : {}),
  };
  return {
    specificationVersion: "v1",
    api: "openai-chat",
    provider: config.provider ?? "openai",
    defaultCaps: DEFAULT_CAPS,
    stream: (model, context, options) => streamCompletion(settings, resolved, model, context, options),
  };
}
