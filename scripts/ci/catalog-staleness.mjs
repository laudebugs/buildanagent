// Warns about entries in the gateway's shipped price catalog copied more than 90 days ago. It reads today's date,
// so it runs in CI rather than in the gateway's tests, which must be deterministic. A warning, not a failure: an
// old price should prompt a refresh, not block an unrelated change.
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

const [command] = process.argv.slice(2);
if (command === "check") {
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  // `::warning::` makes GitHub Actions show each line as an annotation on the run.
  for (const warning of staleWarnings(catalog, Date.now())) process.stdout.write(`::warning::${warning}\n`);
} else if (command !== undefined) {
  process.stderr.write("usage: catalog-staleness.mjs check\n");
  process.exit(2);
}
