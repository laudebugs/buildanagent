/**
 * `createModel()`: binds an adapter to one model id and wraps it in the gateway's shared behaviour (SDK plan §3.2;
 * SDK decisions 4, 13). The order, outside in: middleware, then retries, then the request dump, then the adapter.
 */
import { complete } from "./complete.ts";
import { GatewayError } from "./errors.ts";
import { transformParams, wrapStream } from "./middleware.ts";
import { startAttempt } from "./request-dump.ts";
import { abortableSleep, type RetrySettings, withRetries } from "./retry.ts";
import type { CreateModelOptions, GatewayEvent, Model, PriceCatalog } from "./runtime-types.ts";
import type { ModelAdapter, StreamOptions } from "./spec.ts";
import type { ModelCaps, ModelContext } from "./types.ts";

const DEFAULT_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 2000;

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
function resolveCaps(adapter: ModelAdapter, id: string, catalog: PriceCatalog | undefined): ModelCaps {
  const entry = catalog?.models.find((m) => m.provider === adapter.provider && m.id === id);
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
 * and dumped the same way, whatever the adapter.
 */
export function createModel(options: CreateModelOptions): Model {
  const { adapter, id } = options;
  assertAdapter(adapter);
  const ref = { api: adapter.api, provider: adapter.provider, id };
  const caps = resolveCaps(adapter, id, options.catalog);
  const middleware = [...(options.middleware ?? [])];
  const settings: RetrySettings = {
    retries: nonNegativeInteger("retries", options.retries, DEFAULT_RETRIES),
    initialDelayMs: nonNegativeInteger("initialRetryDelayMs", options.initialRetryDelayMs, DEFAULT_INITIAL_DELAY_MS),
    sleep: options.sleep ?? abortableSleep,
  };
  const onRequest = options.onRequest?.bind(options);

  async function* stream(context: ModelContext, streamOptions: StreamOptions = {}): AsyncGenerator<GatewayEvent> {
    const params = await transformParams(middleware, { context, options: streamOptions });
    const request = { adapter, ref, context: params.context, options: params.options, onRequest };
    yield* wrapStream(middleware, params, () =>
      withRetries((n) => startAttempt(request, n), params.options.signal, settings),
    );
  }

  return {
    ref,
    caps,
    stream,
    complete: (context, streamOptions) => complete(stream(context, streamOptions)),
  };
}
