/**
 * `explicitProvider()`: an `@ai-sdk/anthropic` or `@ai-sdk/openai` provider built only from the key and base URL the
 * caller passes. In the pinned provider builds, a missing `apiKey` falls back to `ANTHROPIC_API_KEY` or
 * `OPENAI_API_KEY` and a missing `baseURL` to `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`, while an empty `apiKey` is
 * sent as is. This builder refuses both gaps up front and puts `egressGuard()` under the provider's `fetch`, so a
 * request that would carry another key or reach another host fails before it is sent.
 */
import { type AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, type OpenAIProvider, type OpenAIProviderSettings } from "@ai-sdk/openai";
import { type EgressCredential, egressGuard, egressGuardWebSocket } from "../egress.js";
import { SafetyError } from "../errors.js";
import { cloudflareProviderMismatch, isCloudflareAiGatewayHost, parseModelBaseUrl } from "../model-url.js";

/** The providers `explicitProvider()` builds. */
export type ExplicitProviderName = "anthropic" | "openai";

/** The options of `explicitProvider()`. Every field but `fetch` is required, and none falls back to the environment. */
export interface ExplicitProviderOptions<PROVIDER extends ExplicitProviderName = ExplicitProviderName> {
  readonly provider: PROVIDER;
  /** The user's own key for this provider. It must be a non-empty string with no surrounding whitespace. */
  readonly apiKey: string;
  /**
   * Where the provider sends requests, such as `https://api.anthropic.com/v1`, `https://api.openai.com/v1` or a
   * Cloudflare AI Gateway endpoint like `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`. It must
   * use https, and it must not be Vercel AI Gateway.
   */
  readonly baseURL: string;
  /**
   * The token of a Cloudflare AI Gateway with authentication turned on. The guard sends it as `cf-aig-authorization` with
   * every request, beside the provider key, and allows no other second credential. `baseURL` must then be a Cloudflare AI
   * Gateway endpoint, so the token can reach no other host. Left out, a request that carries `cf-aig-authorization`
   * is refused. The package has no stored-key mode: `apiKey` is always sent, which Cloudflare treats as the request's own key.
   */
  readonly gatewayToken?: string;
  /** The `fetch` that sends a request once the guard allows it. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
}

// Header values can't hold control characters, and a key with surrounding whitespace is almost always a paste error
// that the provider would reject with a confusing 401.
const UNUSABLE_KEY = /^\s|\s$|[\p{Cc}]/u;

function checkApiKey(apiKey: unknown, provider: string): string {
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new SafetyError("invalid_byok_config", `explicitProvider(${provider}) needs the user's apiKey, and got none`);
  }
  if (UNUSABLE_KEY.test(apiKey)) {
    throw new SafetyError(
      "invalid_byok_config",
      `explicitProvider(${provider}) got an apiKey with surrounding whitespace or a control character`,
    );
  }
  return apiKey;
}

function checkBaseUrl(baseURL: unknown, provider: string): string {
  const parsed = parseModelBaseUrl(baseURL);
  if (!parsed.ok) throw new SafetyError("invalid_byok_config", `explicitProvider(${provider}): ${parsed.message}`);
  if (isCloudflareAiGatewayHost(parsed.url.hostname)) {
    const mismatch = cloudflareProviderMismatch(parsed.url.path, provider);
    if (mismatch !== undefined)
      throw new SafetyError("invalid_byok_config", `explicitProvider(${provider}): ${mismatch}`);
  }
  return baseURL as string;
}

function credentialFor(provider: ExplicitProviderName, apiKey: string): EgressCredential {
  // Anthropic's provider sends the key in x-api-key, which is also where Cloudflare AI Gateway reads an Anthropic key;
  // OpenAI's sends it as a bearer token.
  return provider === "anthropic"
    ? { header: "x-api-key", value: apiKey }
    : { header: "authorization", value: `Bearer ${apiKey}` };
}

/** Builds an Anthropic provider on the user's key and base URL alone. */
export function explicitProvider(options: ExplicitProviderOptions<"anthropic">): AnthropicProvider;
/** Builds an OpenAI provider on the user's key and base URL alone. */
export function explicitProvider(options: ExplicitProviderOptions<"openai">): OpenAIProvider;
/** Builds the provider `options.provider` names, when that is known only at runtime. */
export function explicitProvider(options: ExplicitProviderOptions): AnthropicProvider | OpenAIProvider;
/**
 * Builds an `@ai-sdk/anthropic` or `@ai-sdk/openai` provider that uses only the `apiKey` and `baseURL` you pass. It
 * passes both to the provider, so the provider never reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
 * `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`. It sends every request through `egressGuard()`, and every OpenAI
 * WebSocket handshake through the same checks, which refuse a request to another host or with another credential. A
 * request to Cloudflare AI Gateway also carries `cf-aig-no-wholesale: true`. A gateway with authentication turned on
 * needs its token in a `cf-aig-authorization` header: pass it as `gatewayToken`, and the guard sends it and allows no
 * other second credential and no other host.
 *
 * Throws a `SafetyError`, code `invalid_byok_config`, before any request when the key is missing, empty or padded with
 * whitespace, when the base URL is missing or breaks the guard's rules, when it points at Vercel AI Gateway, or when a
 * `gatewayToken` is unusable or the base URL is not a Cloudflare AI Gateway endpoint.
 */
export function explicitProvider(options: ExplicitProviderOptions): AnthropicProvider | OpenAIProvider {
  const { provider } = options;
  if (provider !== "anthropic" && provider !== "openai") {
    throw new SafetyError("invalid_byok_config", "explicitProvider builds only the anthropic and openai providers");
  }
  const apiKey = checkApiKey(options.apiKey, provider);
  const baseURL = checkBaseUrl(options.baseURL, provider);
  const credential = credentialFor(provider, apiKey);
  const gateway = options.gatewayToken === undefined ? {} : { gatewayToken: options.gatewayToken };
  const guard = egressGuard({
    baseURL,
    credential,
    ...gateway,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  if (provider === "anthropic") return createAnthropic({ apiKey, baseURL, fetch: guard });
  // OpenAI's realtime transcription and speech translation open a WebSocket instead of calling fetch, so the
  // handshake goes through the same checks.
  const webSocket = egressGuardWebSocket({ baseURL, credential, ...gateway }) as NonNullable<
    OpenAIProviderSettings["webSocket"]
  >;
  return createOpenAI({ apiKey, baseURL, fetch: guard, webSocket });
}
