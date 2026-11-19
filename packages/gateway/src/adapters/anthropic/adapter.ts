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
import { isTransportFailure } from "../../classify.js";
import { isGatewayError } from "../../errors.js";
import { fnv1a } from "../../names.js";
import { type ResolvedProviderConfig, resolveProviderConfig } from "../../provider-config.js";
import { assertModelRequestAllowed, ModelRequestsDisabledError } from "../../request-policy.js";
import type { ProviderConfig } from "../../runtime-types.js";
import type { ModelAdapter, ModelEvent, StreamOptions } from "../../spec.js";
import { readServerSentEvents } from "../../sse.js";
import type { ContentBlock, Message, ModelCaps, ModelContext, ModelRef } from "../../types.js";
import { abortedEvent, failureEvent, failureFromResponse, isPrefixMismatch } from "./failure.js";
import { anthropicOptions, buildRequest, type RequestPlan } from "./request.js";
import { MessageAssembler } from "./response.js";

type Json = Record<string, unknown>;

/** The Messages API version every request pins. */
export const ANTHROPIC_VERSION = "2026-10-21";
/** The beta that adds `thinking.block_binding` and the response's `input_transformations`. */
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

// The adapter's `defaultCaps`: the one fallback for a model with no caps, which `createModel()` uses for a model its
// catalog lacks and a direct `stream()` call without `options.caps` uses for any model. Every Claude model takes
// images, but an unlisted one may be an older model that rejects adaptive thinking, so it is sent no thinking setting
// and its own default applies.
const DEFAULT_CAPS: ModelCaps = { contextWindow: 200_000, maxOutputTokens: 32_000, images: true, reasoning: false };

// How many conversations the adapter remembers as needing `drop_block`. A conversation pushed out sends the setting
// no more; its next mismatch costs one more 400 and puts it back.
const DROP_BLOCK_MEMORY = 1_000;

/** A set of keys that keeps the `limit` most recently used, so a long-lived adapter's memory stays bounded. */
class RecentKeys {
  readonly #keys = new Set<string>();
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  /** True when the key is held; a hit counts as a use. */
  has(key: string): boolean {
    if (!this.#keys.has(key)) return false;
    this.add(key);
    return true;
  }

  add(key: string): void {
    this.#keys.delete(key);
    this.#keys.add(key);
    // A Set iterates in insertion order, so its first key is the least recently used.
    const oldest = this.#keys.size > this.#limit ? this.#keys.values().next().value : undefined;
    if (oldest !== undefined) this.#keys.delete(oldest);
  }
}

/** What one adapter keeps between calls: the conversations that must send `drop_block`. */
interface AdapterState {
  readonly config: ResolvedProviderConfig;
  readonly dropBlock: RecentKeys;
}

/**
 * The conversation a call belongs to: its caller-given id, or else an FNV-1a hash of its system prompt and first
 * message. Two conversations that share both share the hash, so one's `drop_block` reaches the other; a
 * `conversationId` keeps them apart.
 */
function conversationKey(context: ModelContext, options: StreamOptions): string {
  const id = anthropicOptions(options).conversationId;
  if (id !== undefined) return `id:${id}`;
  return `fp:${fnv1a(JSON.stringify([context.system, fingerprintOf(context.messages[0])]))}`;
}

/**
 * The part of a message the fingerprint hashes: its role and each block's text, or the block's type for any other
 * block. An image's base64 data stays out, so a large image never gets stringified on every call.
 */
function fingerprintOf(message: Message | undefined): unknown {
  if (message === undefined) return null;
  const blocks: readonly ContentBlock[] = message.content;
  return [message.role, blocks.map((block) => (block.type === "text" ? block.text : `[${block.type}]`))];
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

// Header names the adapter sets itself. A caller's key header is dropped, because `config.apiKey` is the only key
// the adapter sends.
const CALLER_HEADERS_DROPPED = new Set(["x-api-key", "authorization", "anthropic-beta"]);

/**
 * The caller's headers with lower-case names, without the ones the adapter owns, and the betas they ask for. Header
 * names are case-insensitive, so `Anthropic-Beta` and `anthropic-beta` are one header.
 */
function callerHeaders(headers: Readonly<Record<string, string>>): { rest: Record<string, string>; betas: string[] } {
  const rest: Record<string, string> = {};
  const betas: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "anthropic-beta") betas.push(...value.split(",").map((beta) => beta.trim()));
    if (!CALLER_HEADERS_DROPPED.has(lower)) rest[lower] = value;
  }
  return { rest, betas };
}

function requestFor(state: AdapterState, body: unknown, signal: AbortSignal | undefined): Request {
  const { config } = state;
  const { rest, betas } = callerHeaders(config.headers);
  const beta = [...new Set([...betas, THINKING_BINDING_BETA])].filter(Boolean).join(",");
  const headers = {
    ...rest,
    "content-type": "application/json",
    accept: "text/event-stream",
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": beta,
    "x-api-key": config.apiKey,
  };
  const url = `${config.baseURL.replace(/\/+$/, "")}/v1/messages`;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
}

/**
 * Sends one HTTP request. A transport that throws becomes an `error` terminal unless the throw is a guard's; only a
 * transport failure, by the rule the retries use, may be retried, and any other throw is `fatal`.
 */
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
    else yield thrownFailureEvent(model, thrown);
    return undefined;
  }
}

/** The `error` terminal for a throw: retryable only for a transport failure, and `fatal` for a bug or bad data. */
function thrownFailureEvent(model: ModelRef, thrown: unknown, partial?: ReturnType<MessageAssembler["partial"]>) {
  const message = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  return failureEvent(model, { message, ...(isTransportFailure(thrown) ? {} : { kind: "fatal" }) }, partial);
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
    // A broken connection may work on a retry; malformed event data, a SyntaxError, will not parse on one either.
    yield thrownFailureEvent(model, thrown, assembler.partial());
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
  const plan = buildRequest(model, context, options, options.caps ?? DEFAULT_CAPS);
  // Each attempt warns again; the gateway's retries stream a repeated warning only once per call.
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
 * The model's caps come from `options.caps`, which `createModel()` sets; a direct call without them uses
 * `defaultCaps`. Caller headers from `config.headers` are sent with lower-case names; a caller `anthropic-beta` is
 * merged with the adapter's beta, and a caller `x-api-key` or `authorization` is dropped.
 *
 * `providerOptions.anthropic` takes a `conversationId`, which marks requests of one conversation, and an `extraBody`,
 * whose fields join the request body wherever the adapter sets no field of the same name. Without a
 * `conversationId`, the adapter tells conversations apart by their system prompt and the text of their first message, so conversations that share
 * both also share the `drop_block` setting; pass a `conversationId` for each conversation to keep them apart. The
 * adapter remembers the last 1,000 conversations that needed `drop_block`. `temperature`, `top_p` and `top_k` are
 * never sent, because this API version rejects them; the call streams a `warning` instead.
 */
export function anthropic(config: ProviderConfig): ModelAdapter {
  const state: AdapterState = {
    config: resolveProviderConfig(config, { baseURL: DEFAULT_BASE_URL }),
    dropBlock: new RecentKeys(DROP_BLOCK_MEMORY),
  };
  return {
    specificationVersion: "v1",
    api: "anthropic-messages",
    provider: "anthropic",
    defaultCaps: DEFAULT_CAPS,
    stream: (model, context, options) => streamMessage(state, model, context, options),
  };
}
