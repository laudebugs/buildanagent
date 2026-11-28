// What a model switch costs when each model keeps its own prompt cache. A ten-turn session adds 2,000 input tokens a
// turn and gets 200 output tokens back, which stay out of the cached context. Each model's cache holds the prefix up
// to its own last turn, so a model that takes a turn after others (or after the five-minute cache lifetime) rewrites
// the whole prefix at the cache-write rate. We price six schedules from the gateway's catalog, with no model call,
// then price them again with a gap between turns longer than the cache lifetime.
//
// This is arithmetic on published rates, not a measurement. It assumes what the Switchcraft router paper's replay
// assumes, a separate cache per model per conversation, so the alternating totals depend on that assumption and on
// which model takes turn 1. The book's fast-and-slow-calls chapter lists it.
import { defaultCatalog, findCatalogEntry, priceUsage, type Usage } from "@buildanagent/gateway";
import { check } from "./lib/check.js";

const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";
const TURNS = 10;
const INPUT_PER_TURN = 2_000;
const OUTPUT_PER_TURN = 200;
const TURN_GAP_SECONDS = 30;
const EXPIRED_GAP_SECONDS = 360;
const CACHE_LIFETIME_SECONDS = 300;
const NANOS_PER_DOLLAR = 1_000_000_000;
const NANOS_PER_TEN_THOUSANDTH = 100_000;
const TEN_THOUSANDTHS = 10_000;

type Pick = (turn: number) => string;

// #region price
/** Prices a session in which `pick(turn)` names the model that answers each turn, `gapSeconds` apart. */
function session(pick: Pick, gapSeconds: number) {
  const caches = new Map<string, { tokens: number; usedAt: number }>();
  return Array.from({ length: TURNS }, (_, turn) => {
    const id = pick(turn);
    const now = turn * gapSeconds;
    const cache = caches.get(id);
    const live = cache !== undefined && now - cache.usedAt <= CACHE_LIFETIME_SECONDS;
    const context = INPUT_PER_TURN * (turn + 1);
    const read = live ? cache.tokens : 0;
    const usage: Usage = {
      uncachedInput: 0,
      cacheRead: read,
      cacheWrite: { "5m": context - read, "1h": 0 },
      output: OUTPUT_PER_TURN,
      reasoning: 0,
      raw: null,
    };
    caches.set(id, { tokens: context, usedAt: now });
    return { usage, cost: priceUsage(usage, findCatalogEntry(defaultCatalog, "anthropic", id)).total ?? Number.NaN };
  });
}
// #endregion

/** A session's total in dollars to four decimals, rounded half up from whole nano-dollars so 0.06795 is not 0.0679. */
function total(turns: { cost: number }[]): string {
  const nanos = Math.round(turns.reduce((sum, turn) => sum + turn.cost, 0) * NANOS_PER_DOLLAR);
  return (Math.round(nanos / NANOS_PER_TEN_THOUSANDTH) / TEN_THOUSANDTHS).toFixed(4);
}

// #region schedules
const stay =
  (id: string): Pick =>
  () =>
    id;
const switchAt =
  (turn: number, first: string, then: string): Pick =>
  (t) =>
    t < turn ? first : then;
const alternate =
  (first: string, second: string): Pick =>
  (t) =>
    t % 2 === 0 ? first : second; // book:note alternate
const half = TURNS / 2;
const schedules: [string, Pick, string][] = [
  ["Sonnet throughout", stay(SONNET), "0.0790"],
  ["Haiku throughout", stay(HAIKU), "0.0044"],
  ["Haiku then Sonnet", switchAt(half, HAIKU, SONNET), "0.0680"],
  ["Sonnet then Haiku", switchAt(half, SONNET, HAIKU), "0.0406"],
  ["alternating from Sonnet", alternate(SONNET, HAIKU), "0.0616"],
  ["alternating from Haiku", alternate(HAIKU, SONNET), "0.0671"],
];
for (const [name, pick, expected] of schedules) {
  const cost = total(session(pick, TURN_GAP_SECONDS)); // book:note cached-run
  check(cost === expected, `${name} costs $${expected} (${cost})`);
}
// #endregion

// #region expiry
for (const [name, pick] of schedules) {
  const turns = session(pick, EXPIRED_GAP_SECONDS); // book:note expired-run
  const reads = turns.reduce((sum, turn) => sum + turn.usage.cacheRead, 0);
  check(reads === 0, `${name}: after a gap past the cache lifetime, every turn rewrites its whole prefix`);
}
check(total(session(stay(SONNET), EXPIRED_GAP_SECONDS)) === "0.2950", "Sonnet throughout, expired: $0.2950");
check(total(session(stay(HAIKU), EXPIRED_GAP_SECONDS)) === "0.0148", "Haiku throughout, expired: $0.0148");
// #endregion
