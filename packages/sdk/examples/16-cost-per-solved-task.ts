// A cheap model that fails often can cost more per solved task than a dear one that fails rarely, and a lower effort
// on a large model can beat a smaller model outright. This example ranks four candidates on forty tasks by what each
// solved task costs, and it ranks two candidates against each other only when their pass rates differ by more than
// two standard errors of the paired difference. Inside that band a gap may be luck, so the pair shares a rank. Forty
// tasks resolve only large gaps, so a one-task gap stays tied. The book's fast-and-slow-calls chapter lists it.
//
// It reproduces Anthropic's method of pricing each candidate per solved task, and none of Anthropic's numbers. Every
// pass, fail and token count below is invented and measures no model. Effort appears only in the output tokens: the
// gateway has no effort option yet. Prices come from the gateway's catalog.
import { defaultCatalog, findCatalogEntry, priceUsage, type Usage } from "@buildanagent/gateway";
import { check } from "./lib/check.js";

const TIE_BELOW_SE = 2;
const NANOS_PER_DOLLAR = 1_000_000_000;
const INPUT_TOKENS = 4_000;

// #region candidates
/** One candidate: its catalog model, its output tokens a task and a pass ("1") or fail ("0") for each of 40 tasks. */
const candidate = (name: string, model: string, output: number, passed: string) => ({ name, model, output, passed });
type Candidate = ReturnType<typeof candidate>;
const candidates = [
  candidate("Haiku 5.5", "claude-haiku-5-5", 800, "1001101101011011101101110101000000000000"),
  candidate("Sonnet 5.5", "claude-sonnet-5-5", 3_000, "1101101101111011101101110101101011010111"),
  candidate("Opus 5.5 low", "claude-opus-5-5", 1_000, "1111101111111111101111111111101111111101"),
  candidate("Opus 5.5 medium", "claude-opus-5-5", 2_500, "1011101101011111101101111101101011110101"),
];
// #endregion

// #region price
/** The catalog's price of one task for a candidate, in whole nano-dollars so sums and ratios compare exactly. */
function taskNanos(c: Candidate): number {
  const usage: Usage = {
    uncachedInput: INPUT_TOKENS,
    output: c.output,
    cacheRead: 0,
    cacheWrite: { "5m": 0, "1h": 0 },
    reasoning: 0,
    raw: null,
  };
  const entry = findCatalogEntry(defaultCatalog, "anthropic", c.model);
  return Math.round((priceUsage(usage, entry).total ?? Number.NaN) * NANOS_PER_DOLLAR);
}
// #endregion

// #region noise
/** True when two candidates' paired pass-rate difference is under two standard errors, so a ranking would be luck. */
function tied(a: Candidate, b: Candidate): boolean {
  const diffs = [...a.passed].map((mark, task) => Number(mark) - Number(b.passed[task]));
  const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  const variance = diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (diffs.length - 1); // book:note sample-variance
  return Math.abs(mean) < TIE_BELOW_SE * Math.sqrt(variance / diffs.length);
}
// #endregion

// #region rank
const rows = candidates.map((c) => {
  const solved = [...c.passed].filter((mark) => mark === "1").length;
  return { ...c, solved, perSolved: Math.round((taskNanos(c) * c.passed.length) / solved) };
});
/** One more than the number of candidates that cost less per solved task and are not tied with this one. */
type Row = (typeof rows)[number];
const rankOf = (row: Row) => 1 + rows.filter((o) => o.perSolved < row.perSolved && !tied(o, row)).length;
// #endregion

for (const row of [...rows].sort((a, b) => a.perSolved - b.perSolved)) {
  const usd = (row.perSolved / NANOS_PER_DOLLAR).toFixed(4);
  console.log(
    `rank ${rankOf(row)}: ${row.name}, ${row.solved} of ${row.passed.length} solved, $${usd} per solved task`,
  );
}
const [haiku, sonnet, low, medium] = rows as [Row, Row, Row, Row]; // the four candidates above, in order
const ties = rows.flatMap((a, i) =>
  rows
    .slice(i + 1)
    .filter((b) => tied(a, b))
    .map((b) => `${a.name} / ${b.name}`),
);

check(rows.map(rankOf).join() === "1,3,2,3", "ranks: Haiku 1, Opus low 2, Sonnet and Opus medium share 3");
check(ties.join() === "Sonnet 5.5 / Opus 5.5 medium", `one tied pair, Sonnet and Opus medium (${ties.join()})`);
check(
  rankOf(sonnet) === rankOf(medium) && sonnet.perSolved < medium.perSolved,
  "the tied pair gets one rank, though Sonnet costs less per solved task",
);
check(low.perSolved < sonnet.perSolved && !tied(low, sonnet), "Opus at low beats Sonnet, outside the noise");
check(
  [haiku, sonnet, low, medium].map((r) => r.perSolved).join() === "1777778,54285714,40000000,91034483",
  "cost per solved task in nano-dollars: 1777778, 54285714, 40000000, 91034483",
);
