/**
 * `explicitProvider()`: an `@ai-sdk/anthropic` or `@ai-sdk/openai` provider built only from the key and base URL the
 * caller passes. In the pinned provider builds, a missing `apiKey` falls back to `ANTHROPIC_API_KEY` or
 * `OPENAI_API_KEY` and a missing `baseURL` to `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`, while an empty `apiKey` is
 * sent as is. This builder refuses both gaps up front and puts `egressGuard()` under the provider's `fetch`, so a
 * request that would carry another key or reach another host fails before it is sent.
 */
import { type AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { type EgressCredential, egressGuard } from "../egress.js";
import { SafetyError } from "../errors.js";
import { parseModelBaseUrl } from "../model-url.js";

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
 * `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`, and it sends every request through `egressGuard()`, which refuses a
 * request to another host or with another credential. A request to Cloudflare AI Gateway also carries
 * `cf-aig-no-wholesale: true`.
 *
 * Throws a `SafetyError`, code `invalid_byok_config`, before any request when the key is missing, empty or padded with
 * whitespace, when the base URL is missing or breaks the guard's rules, or when it points at Vercel AI Gateway.
 */
export function explicitProvider(options: ExplicitProviderOptions): AnthropicProvider | OpenAIProvider {
  const { provider } = options;
  if (provider !== "anthropic" && provider !== "openai") {
    throw new SafetyError("invalid_byok_config", "explicitProvider builds only the anthropic and openai providers");
  }
  const apiKey = checkApiKey(options.apiKey, provider);
  const baseURL = checkBaseUrl(options.baseURL, provider);
  const guard = egressGuard({
    baseURL,
    credential: credentialFor(provider, apiKey),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return provider === "anthropic"
    ? createAnthropic({ apiKey, baseURL, fetch: guard })
    : createOpenAI({ apiKey, baseURL, fetch: guard });
}
