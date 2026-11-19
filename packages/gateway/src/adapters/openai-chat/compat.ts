/**
 * The quirks of one OpenAI-compatible server or model, as flags (D2: one wire adapter serves many vendors, and their
 * differences live in per-model data, as Pi's `compat` objects do). Every default is what OpenAI's own Chat
 * Completions API accepts, as its parameters read in openai-node v7.49.0
 * (`src/resources/chat/completions/completions.ts`, as of November 2026).
 */
import type { ProviderConfig } from "../../runtime-types.js";

/** How one OpenAI-compatible server or model differs from OpenAI's own Chat Completions API. */
export interface ChatCompat {
  /**
   * The body field that carries the output limit. Defaults to `"max_completion_tokens"`; OpenAI deprecates
   * `max_tokens` and says reasoning models do not accept it, but many compatible servers read only `max_tokens`.
   */
  readonly maxTokensField?: "max_completion_tokens" | "max_tokens";
  /** The role the system prompt is sent as. Defaults to `"system"`, which every compatible server reads. */
  readonly systemRole?: "system" | "developer";
  /**
   * Whether to ask for a final usage chunk with `stream_options: { include_usage: true }`. Defaults to `true`. A
   * server that rejects the field needs `false`, and its replies then report no usage.
   */
  readonly streamUsage?: boolean;
  /** Whether tools are sent with `strict: true` when their schema allows it. Defaults to `true`. */
  readonly strictTools?: boolean;
  /**
   * Whether the model accepts `temperature`. Defaults to `true`; with `false`, a `temperature` you set is not sent and
   * the call streams a warning.
   */
  readonly temperature?: boolean;
  /**
   * Whether the model takes explicit cache breakpoints (`prompt_cache_breakpoint` on content parts and
   * `prompt_cache_options`), which OpenAI supports from `gpt-5.6`. Defaults to `false`, which leaves caching to the
   * server's automatic prefix cache.
   */
  readonly cacheBreakpoints?: boolean;
  /**
   * Whether `cacheRetention: "long"` sends `prompt_cache_retention: "24h"`, for models before `gpt-5.6` that offer
   * extended caching. Defaults to `false`.
   */
  readonly promptCacheRetention?: boolean;
}

/** The configuration `openaiChat()` takes: a `ProviderConfig` plus the server's name and quirks. */
export interface OpenAIChatConfig extends ProviderConfig {
  /**
   * The vendor name the adapter reports, which `createModel()` looks the model up under in the price catalog.
   * Defaults to `"openai"`; set it for another OpenAI-compatible server.
   */
  readonly provider?: string;
  /** Quirks that hold for every model behind this adapter. */
  readonly compat?: ChatCompat;
  /** Quirks for single models, by model id, which override `compat` flag by flag. */
  readonly modelCompat?: Readonly<Record<string, ChatCompat>>;
}

/** The part of the configuration `compatFor()` reads. */
export type CompatSettings = Pick<OpenAIChatConfig, "compat" | "modelCompat">;

/** A `ChatCompat` with every flag set. */
export type ResolvedCompat = Required<ChatCompat>;

const DEFAULT_COMPAT: ResolvedCompat = {
  maxTokensField: "max_completion_tokens",
  systemRole: "system",
  streamUsage: true,
  strictTools: true,
  temperature: true,
  cacheBreakpoints: false,
  promptCacheRetention: false,
};

/** The flags for one model: its own entry over the adapter's, over the defaults. */
export function compatFor(config: CompatSettings, modelId: string): ResolvedCompat {
  const own = Object.hasOwn(config.modelCompat ?? {}, modelId) ? config.modelCompat?.[modelId] : undefined;
  return { ...DEFAULT_COMPAT, ...definedFlags(config.compat), ...definedFlags(own) };
}

/** The flags that are set, so an `undefined` flag keeps the value beneath it. */
function definedFlags(compat: ChatCompat | undefined): ChatCompat {
  return Object.fromEntries(Object.entries(compat ?? {}).filter(([, value]) => value !== undefined));
}
