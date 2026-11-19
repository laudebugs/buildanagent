// The live run's cost guard, the owner's rule of 2026-11-19: "A run may cost at most $1, but should aim to be less
// than $.50". Before each model call, a harness's live mode projects the call's cost from the gateway's price catalog
// (packages/gateway/src/catalog.json) and a token estimate, the formula D9 and E5 share, and refuses the call when the
// spend so far plus that projection would pass the ledger's cap, which run.mjs sets to the job's share of $1.00. After
// the call it records what the provider reported. The run's examples run one after another, each in its own process,
// so the spend lives in a ledger file that each call reads and writes in turn.
//
// The formula restates the gateway's projectCost() and priceUsage() (packages/gateway/src/cost.ts) for plain Node,
// because the harnesses don't depend on the gateway: every input token at the dearest input rate of the tier the input
// selects, plus the call's whole output allowance at the output rate. scripts/ci/live-run.test.mjs checks the two
// against fixed figures. The file holds only syntax that Node.js can strip, so .mjs scripts import it without a build.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The hard cap on one run's spend, in USD. */
export const CAP_USD = 1;
/** The spend one run aims to stay under, in USD. */
export const TARGET_USD = 0.5;

/** The gateway's catalog, which the live run prices against unless a test passes another. */
export const CATALOG_FILE = fileURLToPath(new URL("../../packages/gateway/src/catalog.json", import.meta.url));

// The gateway's own character rate (cost.ts): Anthropic's models overview puts 1M tokens at roughly 2.5M characters,
// and other tokenizers fit more characters in a token, so the estimate errs high.
const CHARS_PER_TOKEN = 2.5;
const PER_MILLION = 1_000_000;

export interface RateTier {
  upToInputTokens: number | null;
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: { "5m": number; "1h": number };
  output: number;
}

export interface CatalogEntry {
  provider: string;
  id: string;
  rates: RateTier[];
  asOf: string;
}

export interface Catalog {
  models: CatalogEntry[];
}

/** The token counts a provider reported for one call. */
export interface TokenUsage {
  uncachedInput: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** One model call in the ledger: what it was projected to cost before it ran, and what it cost. */
export interface LedgerCall {
  example: string;
  provider: string;
  model: string;
  projected: number;
  cost: number;
  /** Whether `cost` comes from the provider's reported usage, or is the projection because none was reported. */
  basis: "usage" | "projection";
}

/** The call the guard refused, and the figures that made it refuse. */
export interface LedgerAbort {
  example: string;
  provider: string;
  model: string;
  projected: number | null;
  spent: number;
  reason: string;
}

export interface Ledger {
  cap: number;
  target: number;
  spent: number;
  calls: LedgerCall[];
  aborted: LedgerAbort | null;
}

/** What the guard needs to know about the next call. */
export interface PlannedCall {
  example: string;
  provider: string;
  model: string;
  inputTokens: number;
  maxOutputTokens: number;
}

/** Thrown when the guard refuses a call; the ledger already records why. */
export class LiveBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveBudgetError";
  }
}

export function readCatalog(file: string = CATALOG_FILE): Catalog {
  return JSON.parse(readFileSync(file, "utf8")) as Catalog;
}

export function catalogEntry(catalog: Catalog, provider: string, model: string): CatalogEntry | undefined {
  return catalog.models.find((entry) => entry.provider === provider && entry.id === model);
}

/** The gateway's character-based estimate of the tokens in `chars` characters, rounded up. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function tierFor(entry: CatalogEntry, inputTokens: number): RateTier | undefined {
  return entry.rates.find((tier) => tier.upToInputTokens === null || inputTokens <= tier.upToInputTokens);
}

/**
 * The most one call can cost: every input token at the dearest of the tier's uncached and cache-write rates, plus
 * `maxOutputTokens` at the output rate. A model the catalog lacks has no projection, never a guessed zero.
 */
export function projectCost(
  tokens: { inputTokens: number; maxOutputTokens: number },
  entry: CatalogEntry | undefined,
): number | null {
  const tier = entry ? tierFor(entry, tokens.inputTokens) : undefined;
  if (tier === undefined) return null;
  const input = Math.max(tier.uncachedInput, tier.cacheWrite["5m"], tier.cacheWrite["1h"]);
  return (tokens.inputTokens * input + tokens.maxOutputTokens * tier.output) / PER_MILLION;
}

/** What a call's reported usage costs. Cache writes are priced at the 5-minute rate, the one both adapters report. */
export function priceUsage(usage: TokenUsage, entry: CatalogEntry | undefined): number | null {
  const read = usage.cacheRead ?? 0;
  const write = usage.cacheWrite ?? 0;
  const tier = entry ? tierFor(entry, usage.uncachedInput + read + write) : undefined;
  if (tier === undefined) return null;
  return (
    (usage.uncachedInput * tier.uncachedInput +
      read * tier.cacheRead +
      write * tier.cacheWrite["5m"] +
      usage.output * tier.output) /
    PER_MILLION
  );
}

export function newLedger(cap: number = CAP_USD, target: number = TARGET_USD): Ledger {
  return { cap, target, spent: 0, calls: [], aborted: null };
}

export function readLedger(file: string): Ledger {
  if (!existsSync(file)) throw new LiveBudgetError(`the live run's ledger ${file} is missing`);
  return JSON.parse(readFileSync(file, "utf8")) as Ledger;
}

export function writeLedger(file: string, ledger: Ledger): void {
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

const usd = (value: number): string => `$${value.toFixed(4)}`;

/**
 * Checks the next call against the cap before it is sent, and returns its projected cost. When the spend so far plus
 * the projection would pass the cap, or the call can't be projected, the ledger records the refusal, no later call
 * may run, and this throws.
 */
export function reserveCall(file: string, call: PlannedCall, catalog: Catalog = readCatalog()): number {
  const ledger = readLedger(file);
  const refuse = (projected: number | null, reason: string): never => {
    ledger.aborted ??= {
      example: call.example,
      provider: call.provider,
      model: call.model,
      projected,
      spent: ledger.spent,
      reason,
    };
    writeLedger(file, ledger);
    throw new LiveBudgetError(`live run stopped before a model call: ${reason}`);
  };
  if (ledger.aborted) refuse(null, `an earlier call was refused (${ledger.aborted.reason})`);
  const projected = projectCost(call, catalogEntry(catalog, call.provider, call.model));
  if (projected === null) return refuse(null, `the price catalog has no entry for ${call.provider} ${call.model}`);
  if (ledger.spent + projected > ledger.cap) {
    return refuse(
      projected,
      `${usd(ledger.spent)} spent plus this call's projected ${usd(projected)} would pass the ${usd(ledger.cap)} cap`,
    );
  }
  return projected;
}

/**
 * Records a call's cost once it has answered: its reported usage priced with the catalog, or its projection when the
 * provider reported no usage. Returns the cost recorded.
 */
export function settleCall(
  file: string,
  call: PlannedCall,
  projected: number,
  usage: TokenUsage | undefined,
  catalog: Catalog = readCatalog(),
): number {
  const ledger = readLedger(file);
  const priced = usage === undefined ? null : priceUsage(usage, catalogEntry(catalog, call.provider, call.model));
  const cost = priced ?? projected;
  ledger.spent += cost;
  ledger.calls.push({
    example: call.example,
    provider: call.provider,
    model: call.model,
    projected,
    cost,
    basis: priced === null ? "projection" : "usage",
  });
  writeLedger(file, ledger);
  return cost;
}
