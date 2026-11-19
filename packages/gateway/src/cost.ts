/**
 * Pricing usage against the catalog, and projecting a call's cost before it is sent (D3, D4, D9; ADR 0043).
 *
 * Separate token classes (D3) mean the fold multiplies each class by its own rate with no conversion. A provider's
 * billed total wins over the catalog, and a model the catalog lacks has an unknown price, never a guessed zero.
 */
import type { CatalogEntry, RateTier } from "./catalog.ts";
import type { Model } from "./runtime-types.ts";
import type { StreamOptions } from "./spec.ts";
import type { AssistantMessage, ContentBlock, Cost, Message, ModelContext, Usage } from "./types.ts";
import { emptyUsage, totalInput } from "./usage.ts";

const PER_MILLION = 1_000_000;

/** The cost of a model the catalog doesn't list. */
const UNKNOWN_COST: Cost = { total: null, basis: "unknown", currency: "USD" };

/** The first tier whose limit covers `inputTokens`; the catalog check guarantees the last tier has no limit. */
function tierFor(rates: readonly RateTier[], inputTokens: number): RateTier | undefined {
  return rates.find((tier) => tier.upToInputTokens === null || inputTokens <= tier.upToInputTokens);
}

/**
 * Prices one response's usage with a catalog entry. Each token class is multiplied by its rate in the tier that the
 * response's total input selects. Without an entry, the result is `{ total: null, basis: "unknown" }`.
 */
export function priceUsage(usage: Usage, entry: CatalogEntry | undefined): Cost {
  const tier = entry ? tierFor(entry.rates, totalInput(usage)) : undefined;
  if (entry === undefined || tier === undefined) return { ...UNKNOWN_COST };
  const total =
    (usage.uncachedInput * tier.uncachedInput +
      usage.cacheRead * tier.cacheRead +
      usage.cacheWrite["5m"] * tier.cacheWrite["5m"] +
      usage.cacheWrite["1h"] * tier.cacheWrite["1h"] +
      usage.output * tier.output) /
    PER_MILLION;
  return { total, basis: "catalog", currency: "USD", catalogAsOf: entry.asOf };
}

/** The message's cost: the provider's billed total when the adapter reported one, else `price(usage)`. */
export function foldCost(message: AssistantMessage, price: (usage: Usage) => Cost): Cost {
  if (message.cost.basis === "provider" && message.cost.total !== null) return message.cost;
  return price(message.usage);
}

/** The token counts a projection prices: the input to send and the most output the call may produce. */
export interface ProjectedTokens {
  readonly inputTokens: number;
  readonly maxOutputTokens: number;
}

/**
 * The most one call can cost: every input token at the uncached rate, in the tier the input selects, plus
 * `maxOutputTokens` at the output rate. Without an entry, the result is `{ total: null, basis: "unknown" }`.
 */
export function projectCost(tokens: ProjectedTokens, entry: CatalogEntry | undefined): Cost {
  return priceUsage(projectedUsage(tokens), entry);
}

function projectedUsage(tokens: ProjectedTokens): Usage {
  return { ...emptyUsage(), uncachedInput: tokens.inputTokens, output: tokens.maxOutputTokens };
}

// Anthropic's models overview puts 1M tokens at roughly 2.5M Unicode characters on its current tokenizer, as of
// November 2026. Other tokenizers fit more characters in a token, so this rate errs towards a higher estimate.
const CHARS_PER_TOKEN = 2.5;
// The largest per-image cost a first provider documents: Anthropic's high-resolution limit of 4,784 visual tokens
// (vision docs, as of November 2026). Counting an image's base64 data instead would overstate it a hundredfold.
const TOKENS_PER_IMAGE = 4784;

function blockChars(block: ContentBlock): number {
  switch (block.type) {
    case "text":
    case "reasoning":
      return block.text.length;
    case "tool_call":
      return block.name.length + JSON.stringify(block.input ?? null).length;
    case "image":
      return 0;
  }
}

function messageEstimate(message: Message): number {
  const blocks: readonly ContentBlock[] = message.content;
  const chars = blocks.reduce((sum, block) => sum + blockChars(block), 0);
  const images = blocks.filter((block) => block.type === "image").length;
  return chars / CHARS_PER_TOKEN + images * TOKENS_PER_IMAGE;
}

function promptEstimate(context: ModelContext): number {
  const tools = context.tools.reduce(
    (sum, tool) => sum + tool.name.length + tool.description.length + JSON.stringify(tool.inputSchema).length,
    0,
  );
  return (context.system.length + tools) / CHARS_PER_TOKEN;
}

/**
 * One request's usage: a retried call's `usage` sums every attempt, so its last attempt's usage alone gives the size
 * of the request that produced the message.
 */
function requestUsage(message: AssistantMessage): Usage {
  return message.lastAttemptUsage ?? message.usage;
}

/** The index of the last assistant message whose request reports any input, or -1 when there is none. */
function lastReportedCall(messages: readonly Message[]): number {
  return messages.findLastIndex((m) => m.role === "assistant" && totalInput(requestUsage(m)) > 0);
}

/**
 * Estimates the input tokens of sending `context`. When an earlier assistant message reports its usage, the estimate
 * is that request's total input and output plus a character-based estimate of the messages after it; otherwise every
 * part of the context is estimated from its characters. A retried call counts only its last attempt, through
 * `lastAttemptUsage`, because its summed `usage` would count the same prompt once per attempt. The estimate errs high,
 * so a budget check errs towards stopping.
 */
export function estimateInputTokens(context: ModelContext): number {
  const last = lastReportedCall(context.messages);
  const previous = context.messages[last];
  if (previous?.role !== "assistant") {
    const messages = context.messages.reduce((sum, m) => sum + messageEstimate(m), 0);
    return Math.ceil(promptEstimate(context) + messages);
  }
  // The reported output stands in for the assistant message's own content, which the next call sends as input.
  const added = context.messages.slice(last + 1).reduce((sum, m) => sum + messageEstimate(m), 0);
  const usage = requestUsage(previous);
  return Math.ceil(totalInput(usage) + usage.output + added);
}

/**
 * The most the next call can cost: `projectCost()` over `estimateInputTokens(context)` and the call's
 * `maxOutputTokens`, or the model's own output limit when the options leave it out. Priced with the model's catalog
 * entry, so a model the catalog lacks projects `{ total: null, basis: "unknown" }`.
 */
export function projectCallCost(model: Model, context: ModelContext, options: StreamOptions = {}): Cost {
  const tokens = {
    inputTokens: estimateInputTokens(context),
    maxOutputTokens: options.maxOutputTokens ?? model.caps.maxOutputTokens,
  };
  return model.price(projectedUsage(tokens));
}
