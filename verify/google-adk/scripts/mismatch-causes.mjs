// Group the remaining ADK API mismatches by root cause, so the fact-check can count them.
// Each cause is a regex over the error message; the first match wins. Writes
// results/mismatch-causes.json. Run after typecheck-examples.mjs and ahead-of-release.mjs.
import { readFileSync, writeFileSync } from "node:fs";

const CAUSES = [
  ["value-imported-as-type", /cannot be used as a value because it was imported using 'import type'/],
  [
    "event-helpers-from-genai",
    /Module '"@google\/genai"' has no exported member '(Event|createEvent|createEventActions)'/,
  ],
  ["plugin-positional-params", /in type '\w+' is not assignable to the same property in base type 'BasePlugin'/],
  ["base-agent-missing-runLiveImpl", /does not implement inherited abstract member runLiveImpl/],
  ["plain-function-as-tool", /is not assignable to type 'ToolUnion'/],
  ["state-get-default-narrows", /This comparison appears to be unintentional/],
  ["missing-export", /has no exported member/],
  [
    "call-shape",
    /No overload matches|is not assignable|has no properties in common|Expected \d+(-\d+)? arguments|is missing in type|not callable|does not exist in type/,
  ],
];

const results = JSON.parse(readFileSync("results/typecheck-docs.json", "utf8"));
const byCause = {};
for (const r of results.filter((r) => r.status === "api-mismatch")) {
  for (const e of r.errors.filter((e) => e.kind === "api")) {
    const cause = CAUSES.find(([, re]) => re.test(e.message))?.[0] ?? "other";
    byCause[cause] ??= { errors: 0, files: new Set(), example: null };
    byCause[cause].errors++;
    byCause[cause].files.add(r.id);
    byCause[cause].example ??= `${r.page}:${r.line + e.line - 2} ${e.message.slice(0, 160)}`;
  }
}
const out = Object.fromEntries(
  Object.entries(byCause)
    .sort((a, b) => b[1].errors - a[1].errors)
    .map(([k, v]) => [k, { errors: v.errors, files: [...v.files].sort(), example: v.example }]),
);
writeFileSync("results/mismatch-causes.json", JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out))
  console.log(`${k.padEnd(26)} ${String(v.errors).padStart(3)} errors in ${v.files.length} files`);
