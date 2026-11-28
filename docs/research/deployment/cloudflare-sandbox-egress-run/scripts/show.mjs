// Prints a case record from results/ in a short readable form: node scripts/show.mjs <case> [maxChars]
import { readFileSync } from "node:fs";

const [name, max = "500"] = process.argv.slice(2);
const record = JSON.parse(readFileSync(new URL(`../results/${name}.json`, import.meta.url), "utf8"));
const r = record.result;
console.log(name, record.requestedAt, "start:", JSON.stringify(r.start), "notes:", r.notes);
for (const g of r.registrations ?? []) if (!g.ok || process.env.ALL) console.log("REG", JSON.stringify(g));
console.log(
  "registrations ok:",
  (r.registrations ?? []).filter((g) => g.ok).length,
  "failed:",
  (r.registrations ?? []).filter((g) => !g.ok).length,
);
for (const s of r.steps ?? []) {
  console.log(`--- ${s.label} | exit ${s.exitCode} | ${s.ms} ms ${s.error ?? ""}`);
  if (s.stdout.trim()) console.log(s.stdout.slice(0, Number(max)).trimEnd());
  if (s.stderr.trim()) console.log("stderr:", s.stderr.slice(0, Number(max)).trimEnd());
}
