// Warns about entries in the gateway's shipped price catalog copied more than 90 days ago, and about entries whose
// `retires` date is 90 days away or less. It reads today's date, so it runs in CI rather than in the gateway's tests,
// which must be deterministic. A warning, not a failure: an old price or a near date should prompt a refresh, not
// block an unrelated change.
// Run with `node scripts/ci/catalog-staleness.mjs check`.
import { readFileSync } from "node:fs";
import path from "node:path";

const CATALOG = path.resolve(import.meta.dirname, "../../packages/gateway/src/catalog.json");
const DAY_MS = 86_400_000;

/** One warning per entry whose `asOf` is more than `maxAgeDays` days before `now`, in milliseconds. */
export function staleWarnings(catalog, now, maxAgeDays = 90) {
  return catalog.models
    .filter((e) => now - Date.parse(`${e.asOf}T00:00:00Z`) > maxAgeDays * DAY_MS)
    .map(
      (e) =>
        `price catalog: ${e.provider}/${e.id} was copied on ${e.asOf}, more than ${maxAgeDays} days ago; ` +
        `refresh it from ${e.sources.rates}`,
    );
}

const plural = (days) => (days === 1 ? "1 day" : `${days} days`);

/**
 * One warning per entry whose `retires` date is `withinDays` days or less after the calendar day of `now`, or already
 * past. Counting from the start of `now`'s UTC day makes "90 days away" a whole-day rule, so the hour the check runs
 * doesn't move the boundary. The date is a copy as of `asOf`, so the warning asks for a refresh and doesn't claim the
 * model is gone.
 */
export function retirementWarnings(catalog, now, withinDays = 90) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return catalog.models
    .filter((e) => e.retires !== undefined && Date.parse(`${e.retires}T00:00:00Z`) - today <= withinDays * DAY_MS)
    .map((e) => {
      const days = Math.round((Date.parse(`${e.retires}T00:00:00Z`) - today) / DAY_MS);
      const when = days < 0 ? `${plural(-days)} ago` : days === 0 ? "today" : `in ${plural(days)}`;
      return (
        `price catalog: ${e.provider}/${e.id} is recorded as retiring on ${e.retires} (${when}), as of ${e.asOf}; ` +
        `check the provider's deprecations page and refresh the entry`
      );
    });
}

const [command] = process.argv.slice(2);
if (command === "check") {
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  // `::warning::` makes GitHub Actions show each line as an annotation on the run.
  const now = Date.now();
  for (const warning of [...staleWarnings(catalog, now), ...retirementWarnings(catalog, now)])
    process.stdout.write(`::warning::${warning}\n`);
} else if (command !== undefined) {
  process.stderr.write("usage: catalog-staleness.mjs check\n");
  process.exit(2);
}
