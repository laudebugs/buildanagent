/**
 * `createModel()`: binds an adapter to one model id and wraps it in the gateway's shared behaviour (SDK plan §3.2;
 * SDK decisions 4, 13). The order, outside in: middleware, then retries, then the request dump, then the adapter.
 */
import { type CatalogEntry, defaultCatalog, findCatalogEntry, parseCatalog } from "./catalog.js";
import { complete } from "./complete.js";
import { priceUsage } from "./cost.js";
import { GatewayError } from "./errors.js";
import { transformParams, wrapStream } from "./middleware.js";
import { startAttempt } from "./request-dump.js";
import { abortableSleep, DEFAULT_INITIAL_RETRY_DELAY_MS, type RetrySettings, withRetries } from "./retry.js";
import type { CreateModelOptions, GatewayEvent, Model, ModelCallOptions } from "./runtime-types.js";
import type { ModelAdapter } from "./spec.js";
import { assertKnownRoles } from "./transform-messages.js";
import type { ModelCaps, ModelContext, Usage } from "./types.js";

const DEFAULT_RETRIES = 2;

function assertAdapter(adapter: unknown): asserts adapter is ModelAdapter {
  const candidate = adapter as Partial<ModelAdapter> | null;
  if (typeof candidate !== "object" || candidate === null || typeof candidate.stream !== "function") {
    // A string here is usually a bare model id; the gateway never resolves one to a provider.
    throw new GatewayError("invalid_options", "createModel() needs an adapter object, such as anthropic({ apiKey }).");
  }
}

function nonNegativeInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new GatewayError("invalid_options", `createModel(): ${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}

/** The catalog entry's limits, with the adapter's defaults for anything the entry leaves out. */
function resolveCaps(adapter: ModelAdapter, id: string, entry: CatalogEntry | undefined): ModelCaps {
  const defaults = adapter.defaultCaps;
  if (entry) {
    return {
      contextWindow: entry.contextWindow,
      maxOutputTokens: entry.maxOutputTokens,
      // Without a record either way, assume no support: sending an image or reasoning option a model rejects fails.
      images: entry.images ?? defaults?.images ?? false,
      reasoning: entry.reasoning ?? defaults?.reasoning ?? false,
    };
  }
  if (defaults) return { ...defaults };
  throw new GatewayError(
    "missing_caps",
    `createModel(): ${adapter.provider}/${id} is not in the catalog and the adapter has no default caps`,
  );
}

/**
 * Creates a model from an adapter object and a model id. Every call through it is retried, wrapped in middleware
 * and dumped the same way, whatever the adapter. Throws a `GatewayError` for bad options, including a malformed
 * `catalog` (code `invalid_catalog`).
 */
export function createModel(options: CreateModelOptions): Model {
  const { adapter, id } = options;
  assertAdapter(adapter);
  const ref = { api: adapter.api, provider: adapter.provider, id };
  // A caller's catalog is checked like a JSON one: pricing relies on ascending tiers, an open last tier and
  // finite, non-negative rates, and a typed object can still break them.
  const catalog = options.catalog === undefined ? defaultCatalog : parseCatalog(options.catalog);
  const entry = findCatalogEntry(catalog, adapter.provider, id);
  const caps = resolveCaps(adapter, id, entry);
  const price = (usage: Usage) => priceUsage(usage, entry);
  const middleware = [...(options.middleware ?? [])];
  const settings: RetrySettings = {
    retries: nonNegativeInteger("retries", options.retries, DEFAULT_RETRIES),
    initialDelayMs: nonNegativeInteger(
      "initialRetryDelayMs",
      options.initialRetryDelayMs,
      DEFAULT_INITIAL_RETRY_DELAY_MS,
    ),
    sleep: options.sleep ?? abortableSleep,
    price,
  };
  const onRequest = options.onRequest?.bind(options);

  async function* stream(context: ModelContext, streamOptions: ModelCallOptions = {}): AsyncGenerator<GatewayEvent> {
    const params = await transformParams(middleware, { context, options: streamOptions });
    // Refuse a malformed transcript here, before any attempt, so nothing is sent and the caller gets the thrown error.
    assertKnownRoles(params.context.messages);
    const request = { adapter, ref, context: params.context, options: params.options, caps, onRequest };
    yield* wrapStream(middleware, params, () =>
      withRetries((n) => startAttempt(request, n), ref, params.options.signal, settings),
    );
  }

  return {
    ref,
    caps,
    stream,
    complete: (context, streamOptions) => complete(stream(context, streamOptions)),
    price,
  };
}
