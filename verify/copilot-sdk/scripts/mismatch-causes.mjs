// Group the API mismatches by root cause, so the fact-check can count them. Covers both passes of
// typecheck-examples.mjs: first-pass api errors, and the errors that appear once a fragment's missing
// `client`/`session` is declared. Each cause is a regex over the error message; the first match wins.
// Writes results/mismatch-causes.json. Run after typecheck-examples.mjs.
import { readFileSync, writeFileSync } from "node:fs";

const CAUSES = [
  ["hook-returns-null", /=> Promise<(null|.*\| null)>' is not assignable to type '\w+Handler'/],
  ["hook-types-not-exported", /has no exported member (named )?'(\w+Hook(Input|Output)|HookInvocation)'/],
  ["tool-result-field-not-in-type", /does not exist on type 'ToolResultObject'/],
  ["missing-export", /has no exported member/],
  ["call-shape", /No overload matches|is not assignable|Expected \d+(-\d+)? arguments|is missing in type/],
];

const results = JSON.parse(readFileSync("results/typecheck-docs.json", "utf8"));
const byCause = {};
const add = (r, e, pass) => {
  const cause = CAUSES.find(([, re]) => re.test(e.message))?.[0] ?? "other";
  byCause[cause] ??= { errors: 0, files: new Set(), passes: new Set(), example: null };
  byCause[cause].errors++;
  byCause[cause].files.add(r.id);
  byCause[cause].passes.add(pass);
  byCause[cause].example ??= `${r.page}:${r.line + e.line - 2} ${e.message.slice(0, 160)}`;
};
for (const r of results) {
  if (r.status === "api-mismatch") for (const e of r.errors.filter((e) => e.kind === "api")) add(r, e, "first");
  if (r.withPrelude?.status === "api-mismatch")
    for (const e of r.withPrelude.errors.filter((e) => e.kind === "api")) add(r, e, "prelude");
}
const out = Object.fromEntries(
  Object.entries(byCause)
    .sort((a, b) => b[1].errors - a[1].errors)
    .map(([k, v]) => [k, { errors: v.errors, files: [...v.files].sort(), passes: [...v.passes], example: v.example }]),
);
writeFileSync("results/mismatch-causes.json", JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out))
  console.log(`${k.padEnd(30)} ${String(v.errors).padStart(3)} errors in ${String(v.files.length).padStart(2)} files`);
