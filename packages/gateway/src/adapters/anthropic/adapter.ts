/**
 * `anthropic()`: the Anthropic Messages adapter over the gateway's `Transport` (D2). It streams every call and pins
 * the API version.
 *
 * The thinking prefix check (HD3 rules 4 and 5): every request sends the `thinking-binding-controls-2026-08-01`
 * beta header, so a 200 response lists each thinking block that failed the check and reached the model anyway in its
 * `input_transformations`, and each such entry becomes a warning. A 400 that says a block "is bound to a different
 * conversation" is retried once with `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`, and the
 * adapter sends that setting on every later request of the conversation, because the API applies it only to the
 * request that carries it (Prefix checks on thinking blocks,
 * https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks, as of November 2026).
 */
import { type CatalogEntry, defaultCatalog, findCatalogEntry } from "../../catalog.ts";
import { isGatewayError } from "../../errors.ts";
import { fnv1a } from "../../names.ts";
import { type ResolvedProviderConfig, resolveProviderConfig } from "../../provider-config.ts";
import { assertModelRequestAllowed, ModelRequestsDisabledError } from "../../request-policy.ts";
import type { ProviderConfig } from "../../runtime-types.ts";
import type { ModelAdapter, ModelEvent, StreamOptions } from "../../spec.ts";
import { readServerSentEvents } from "../../sse.ts";
import type { ModelCaps, ModelContext, ModelRef } from "../../types.ts";
import { abortedEvent, failureEvent, failureFromResponse, isPrefixMismatch } from "./failure.ts";
import { anthropicOptions, buildRequest, type RequestPlan } from "./request.ts";
import { MessageAssembler } from "./response.ts";

type Json = Record<string, unknown>;

/** The Messages API version every request pins. */
export const ANTHROPIC_VERSION = "2026-10-21";
/** The beta that adds `thinking.block_binding` and the response's `input_transformations`. */
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

// For a model the catalog lacks. It may be an older model that rejects adaptive thinking, so it is sent no thinking
// setting, and its own default applies.
const DEFAULT_CAPS: ModelCaps = { contextWindow: 200_000, maxOutputTokens: 32_000, images: true, reasoning: false };

/** What one adapter keeps between calls: the conversations that must send `drop_block`. */
interface AdapterState {
  readonly config: ResolvedProviderConfig;
  readonly dropBlock: Set<string>;
}

function capsOf(entry: CatalogEntry | undefined): ModelCaps {
  if (entry === undefined) return DEFAULT_CAPS;
  return {
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    images: entry.images ?? DEFAULT_CAPS.images,
    reasoning: entry.reasoning ?? DEFAULT_CAPS.reasoning,
  };
}

/** The conversation a call belongs to: its caller-given id, or a fingerprint of its system prompt and first message. */
function conversationKey(context: ModelContext, options: StreamOptions): string {
  const id = anthropicOptions(options).conversationId;
  if (id !== undefined) return `id:${id}`;
  return `fp:${fnv1a(JSON.stringify([context.system, context.messages[0] ?? null]))}`;
}

/** The body with the binding setting, which the API accepts only beside adaptive thinking. */
function withBinding(body: Json, dropBlock: boolean): Json {
  const thinking = body.thinking;
  if (!dropBlock || typeof thinking !== "object" || thinking === null) return body;
  if ((thinking as Json).type !== "adaptive") return body;
  return { ...body, thinking: { ...thinking, block_binding: { prefix_mismatch_behavior: "drop_block" } } };
}

function bindingApplies(body: Json): boolean {
  return withBinding(body, true) !== body;
}

function requestFor(state: AdapterState, body: unknown, signal: AbortSignal | undefined): Request {
  const { config } = state;
  const beta = [config.headers["anthropic-beta"], THINKING_BINDING_BETA].filter(Boolean).join(",");
  const headers = {
    ...config.headers,
    "content-type": "application/json",
    accept: "text/event-stream",
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": beta,
    "x-api-key": config.apiKey,
  };
  const url = `${config.baseURL.replace(/\/+$/, "")}/v1/messages`;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
}

/** Sends one HTTP request. A transport that throws becomes an `error` terminal unless the throw is a guard's. */
async function* send(
  state: AdapterState,
  model: ModelRef,
  body: Json,
  options: StreamOptions,
): AsyncGenerator<ModelEvent, Response | undefined> {
  const replaced = options.onPayload ? options.onPayload(body) : undefined;
  const request = requestFor(state, replaced === undefined ? body : replaced, options.signal);
  assertModelRequestAllowed(state.config.transport);
  try {
    return await state.config.transport(request);
  } catch (thrown) {
    if (isGatewayError(thrown) || thrown instanceof ModelRequestsDisabledError) throw thrown;
    if (options.signal?.aborted) yield abortedEvent(model);
    else yield failureEvent(model, { message: errorText(thrown) });
    return undefined;
  }
}

function errorText(thrown: unknown): string {
  return thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
}

/** Feeds each server-sent event to the assembler; returns true once it has yielded the terminal. */
async function* pump(
  body: ReadableStream<Uint8Array>,
  assembler: MessageAssembler,
): AsyncGenerator<ModelEvent, boolean> {
  for await (const sse of readServerSentEvents(body)) {
    const data: unknown = JSON.parse(sse.data);
    if (typeof data !== "object" || data === null) continue;
    const named = (data as Json).type;
    for (const event of assembler.handle(typeof named === "string" ? named : sse.event, data as Json)) {
      yield event;
      if (event.type === "done" || event.type === "error") return true;
    }
  }
  return false;
}

/** Reads a 200 stream to its terminal. A stream that breaks or ends early ends in an `error` terminal. */
async function* readMessage(response: Response, model: ModelRef, plan: RequestPlan, signal: AbortSignal | undefined) {
  const assembler = new MessageAssembler(model, plan.names, plan.cacheTtl);
  if (response.body === null) {
    yield failureEvent(model, { message: "the response has no body" });
    return;
  }
  try {
    if (yield* pump(response.body, assembler)) return;
  } catch (thrown) {
    if (signal?.aborted) {
      yield abortedEvent(model, assembler.partial());
      return;
    }
    // Malformed event data will not parse on a retry either; a broken connection might.
    const kind = thrown instanceof SyntaxError ? ("fatal" as const) : undefined;
    yield failureEvent(model, { message: errorText(thrown), ...(kind ? { kind } : {}) }, assembler.partial());
    return;
  }
  // No status and no terminal: the connection closed early, which a retry may fix.
  yield failureEvent(model, { message: "the stream ended before message_stop" }, assembler.partial());
}

async function* streamMessage(
  state: AdapterState,
  model: ModelRef,
  context: ModelContext,
  options: StreamOptions,
): AsyncGenerator<ModelEvent> {
  yield { type: "start" };
  const plan = buildRequest(
    model,
    context,
    options,
    capsOf(findCatalogEntry(defaultCatalog, model.provider, model.id)),
  );
  yield* plan.warnings;
  const key = conversationKey(context, options);
  for (;;) {
    const dropBlock = state.dropBlock.has(key);
    const response = yield* send(state, model, withBinding(plan.body, dropBlock), options);
    if (response === undefined) return;
    if (response.ok) {
      yield* readMessage(response, model, plan, options.signal);
      return;
    }
    const failure = await failureFromResponse(response);
    if (!isPrefixMismatch(failure) || dropBlock || !bindingApplies(plan.body)) {
      yield failureEvent(model, failure);
      return;
    }
    state.dropBlock.add(key);
    yield {
      type: "warning",
      code: "thinking_prefix_mismatch",
      message: `${failure.message} Retrying with drop_block.`,
    };
  }
}

/**
 * Creates an adapter for Anthropic's Messages API. Every request goes to `{baseURL}/v1/messages` through
 * `config.transport`, streams its response, and sends `anthropic-version: 2026-10-21` and the key from
 * `config.apiKey`, which is the only key it sends. Throws a `GatewayError` with code `missing_api_key` when the key
 * is missing or empty.
 *
 * `providerOptions.anthropic` takes a `conversationId`, which marks requests of one conversation, and an `extraBody`
 * merged into the request body. `temperature`, `top_p` and `top_k` are never sent, because this API version rejects
 * them; the call streams a `warning` instead.
 */
export function anthropic(config: ProviderConfig): ModelAdapter {
  const state: AdapterState = {
    config: resolveProviderConfig(config, { baseURL: DEFAULT_BASE_URL }),
    dropBlock: new Set(),
  };
  return {
    specificationVersion: "v1",
    api: "anthropic-messages",
    provider: "anthropic",
    defaultCaps: DEFAULT_CAPS,
    stream: (model, context, options) => streamMessage(state, model, context, options),
  };
}
