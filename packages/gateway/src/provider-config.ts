/**
 * `resolveProviderConfig()`: the one place adapters read their `ProviderConfig` (SDK decision 13; agent-SDK guide §9).
 * It reads nothing from the environment, so the only key an adapter can send is the one its caller passed.
 */
import { GatewayError } from "./errors.ts";
import type { ProviderConfig, Transport } from "./runtime-types.ts";

/** A `ProviderConfig` with every default filled in. */
export interface ResolvedProviderConfig {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly transport: Transport;
  readonly headers: Readonly<Record<string, string>>;
}

// Looked up on each request, not when the adapter is made, so a fetch installed later (a test guard) still applies.
const defaultTransport: Transport = (request) => globalThis.fetch(request);

/**
 * Checks a provider config and fills in its defaults. Throws a `GatewayError` with code `missing_api_key` when the
 * key is missing or empty, so the adapter factory fails before any request is made.
 */
export function resolveProviderConfig(config: ProviderConfig, defaults: { baseURL: string }): ResolvedProviderConfig {
  if (typeof config?.apiKey !== "string" || config.apiKey.trim() === "") {
    throw new GatewayError(
      "missing_api_key",
      "ProviderConfig.apiKey is missing or empty. Pass the key explicitly; the gateway never reads one from the environment.",
    );
  }
  return {
    apiKey: config.apiKey,
    baseURL: config.baseURL ?? defaults.baseURL,
    transport: config.transport ?? defaultTransport,
    headers: { ...config.headers },
  };
}
