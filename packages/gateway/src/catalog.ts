/**
 * The price catalog: per-model rates, limits, the date they were copied and where from (D4). `catalog.json` ships
 * with the package; a caller may pass its own catalog instead. Nothing here fetches prices at run time, so cost never
 * depends on the network.
 *
 * A fine-tuned model is a new model id with its own rates, so the shipped catalog lists none and the gateway prices
 * one as unknown. To price it, pass a catalog with an entry for it. A catalog you pass replaces the shipped one, so it
 * must also list every other model you use: spread `defaultCatalog.models` into it, or those models lose their prices
 * and fall back to the adapter's default limits and image and reasoning flags.
 */
import shipped from "./catalog.json" with { type: "json" };
import { GatewayError } from "./errors.js";

/**
 * The USD price per million tokens of each token class, for requests up to `upToInputTokens` input tokens.
 * `upToInputTokens` counts every input class, cache reads and cache writes included, and is `null` for the last tier.
 */
export interface RateTier {
  readonly upToInputTokens: number | null;
  readonly uncachedInput: number;
  readonly cacheRead: number;
  /**
   * The short and the long cache-write rate. The keys name Anthropic's 5-minute and 1-hour writes; an OpenAI entry
   * stores its 30-minute rate under `"5m"`, the key its adapter counts every Chat Completions write under.
   */
  readonly cacheWrite: { readonly "5m": number; readonly "1h": number };
  /** Reasoning tokens are part of output and are billed at this rate. */
  readonly output: number;
}

/** Where each part of a catalog entry was copied from: the provider's own pricing and model pages. */
export interface CatalogSources {
  readonly rates: string;
  readonly contextWindow: string;
  readonly maxOutputTokens: string;
}

/**
 * One model in the price catalog: its rates, its limits, and the date and pages they were copied from.
 *
 * A fine-tuned model needs its own entry. Its `id` is the exact id the provider gives the tuned model, such as OpenAI's
 * `ft:<base>:<org>::<suffix>`, and its `rates` are the tuned rates, which usually differ from the base model's. Set
 * `images` and `reasoning` as well, or the adapter's defaults apply. Record the `asOf` date and the provider's pricing
 * page in `sources`, as for any entry.
 */
export interface CatalogEntry {
  readonly provider: string;
  readonly id: string;
  /** The rate tiers, in ascending order of `upToInputTokens`. A model without long-context pricing has one tier. */
  readonly rates: readonly RateTier[];
  /**
   * The most input tokens one request can send: the context window, or the provider's lower input limit when its
   * model page sets one inside the window.
   */
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  /** Whether the model takes image input. Left out, the adapter's default applies. */
  readonly images?: boolean;
  /** Whether the model reasons. Left out, the adapter's default applies. */
  readonly reasoning?: boolean;
  /** The date the rates and limits were copied, as `YYYY-MM-DD`. */
  readonly asOf: string;
  readonly sources: CatalogSources;
  /** How a number was derived when the sources don't state it directly. */
  readonly note?: string;
}

/** A list of catalog entries. `createModel()` reads a model's caps and prices from it. */
export interface PriceCatalog {
  readonly models: readonly CatalogEntry[];
}

type Json = Record<string, unknown>;

function fail(where: string, problem: string): never {
  throw new GatewayError("invalid_catalog", `price catalog: ${where} ${problem}`);
}

function objectAt(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(where, "must be an object");
  return value as Json;
}

function rate(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(where, "must be a non-negative number");
  return value;
}

function tokenCount(value: unknown, where: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) fail(where, "must be a positive integer");
  return value as number;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") fail(where, "must be a non-empty string");
  return value;
}

function url(value: unknown, where: string): string {
  const s = text(value, where);
  if (!/^https:\/\/\S+$/.test(s)) fail(where, "must be an https URL");
  return s;
}

function date(value: unknown, where: string): string {
  const s = text(value, where);
  // A calendar check, so "2026-02-30" fails as well as "Nov 2026". `Date.parse` is NaN for a month or day out of
  // range, such as "2026-13-01", where `toISOString()` would throw a RangeError.
  const time = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== s) {
    fail(where, "must be a date in the form YYYY-MM-DD");
  }
  return s;
}

function optionalFlag(value: unknown, where: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") fail(where, "must be true or false");
  return value;
}

function optionalText(value: unknown, where: string): string | undefined {
  return value === undefined ? undefined : text(value, where);
}

function parseTier(value: unknown, where: string, last: boolean): RateTier {
  const tier = objectAt(value, where);
  const cacheWrite = objectAt(tier.cacheWrite, `${where}.cacheWrite`);
  const limit = tier.upToInputTokens;
  if (last && limit !== null) fail(`${where}.upToInputTokens`, "must be null on the last tier");
  return {
    upToInputTokens: last ? null : tokenCount(limit, `${where}.upToInputTokens`),
    uncachedInput: rate(tier.uncachedInput, `${where}.uncachedInput`),
    cacheRead: rate(tier.cacheRead, `${where}.cacheRead`),
    cacheWrite: {
      "5m": rate(cacheWrite["5m"], `${where}.cacheWrite.5m`),
      "1h": rate(cacheWrite["1h"], `${where}.cacheWrite.1h`),
    },
    output: rate(tier.output, `${where}.output`),
  };
}

function parseTiers(value: unknown, where: string): RateTier[] {
  if (!Array.isArray(value) || value.length === 0) fail(where, "must be a non-empty array");
  const tiers = value.map((tier, i) => parseTier(tier, `${where}[${i}]`, i === value.length - 1));
  let previous = 0;
  for (const tier of tiers) {
    if (tier.upToInputTokens === null) break;
    if (tier.upToInputTokens <= previous) fail(where, "must be in ascending order of upToInputTokens");
    previous = tier.upToInputTokens;
  }
  return tiers;
}

function parseSources(value: unknown, where: string): CatalogSources {
  const sources = objectAt(value, where);
  return {
    rates: url(sources.rates, `${where}.rates`),
    contextWindow: url(sources.contextWindow, `${where}.contextWindow`),
    maxOutputTokens: url(sources.maxOutputTokens, `${where}.maxOutputTokens`),
  };
}

function parseEntry(value: unknown, where: string): CatalogEntry {
  const entry = objectAt(value, where);
  const images = optionalFlag(entry.images, `${where}.images`);
  const reasoning = optionalFlag(entry.reasoning, `${where}.reasoning`);
  const note = optionalText(entry.note, `${where}.note`);
  return {
    provider: text(entry.provider, `${where}.provider`),
    id: text(entry.id, `${where}.id`),
    rates: parseTiers(entry.rates, `${where}.rates`),
    contextWindow: tokenCount(entry.contextWindow, `${where}.contextWindow`),
    maxOutputTokens: tokenCount(entry.maxOutputTokens, `${where}.maxOutputTokens`),
    ...(images === undefined ? {} : { images }),
    ...(reasoning === undefined ? {} : { reasoning }),
    asOf: date(entry.asOf, `${where}.asOf`),
    sources: parseSources(entry.sources, `${where}.sources`),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Checks a catalog read from JSON and returns it typed. Throws a `GatewayError` with code `invalid_catalog` that
 * names the first bad field, such as a negative rate, a missing source URL or two entries for one model.
 */
export function parseCatalog(value: unknown): PriceCatalog {
  const catalog = objectAt(value, "the catalog");
  if (!Array.isArray(catalog.models)) fail("models", "must be an array");
  const models = catalog.models.map((entry, i) => parseEntry(entry, `models[${i}]`));
  const seen = new Set<string>();
  for (const { provider, id } of models) {
    // A plain `provider/id` join would collide, because both may contain "/".
    const key = JSON.stringify([provider, id]);
    if (seen.has(key)) fail("models", `lists ${provider}/${id} twice`);
    seen.add(key);
  }
  return { models };
}

/**
 * The catalog that ships with the gateway. `createModel()` uses it unless you pass your own, which replaces it. It
 * lists base models only, so a fine-tuned model has an unknown price until you add an entry for it.
 */
export const defaultCatalog: PriceCatalog = parseCatalog(shipped);

/** The entry for one model, or `undefined` when the catalog doesn't list it. */
export function findCatalogEntry(catalog: PriceCatalog, provider: string, id: string): CatalogEntry | undefined {
  return catalog.models.find((m) => m.provider === provider && m.id === id);
}

const DAY_MS = 86_400_000;

/**
 * The entries whose `asOf` date is more than `maxAgeDays` days before `now`. Prices change often, so check a catalog
 * you maintain with this before each release.
 */
export function staleCatalogEntries(catalog: PriceCatalog, now: Date, maxAgeDays = 90): CatalogEntry[] {
  return catalog.models.filter((entry) => now.getTime() - Date.parse(`${entry.asOf}T00:00:00Z`) > maxAgeDays * DAY_MS);
}
