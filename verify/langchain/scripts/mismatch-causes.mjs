// Group the remaining API mismatches by root cause, so the fact-check can count them.
// Each cause is a regex over the error message; the first match wins. Writes
// results/mismatch-causes.json. Run after typecheck-examples.mjs and ahead-of-release.mjs.
import { readFileSync, writeFileSync } from "node:fs";

const CAUSES = [
  [
    "message-content-not-narrowed",
    /\(ContentBlock \| Text\)\[\]|GraphNodeReturnValue|Property 'toLowerCase' does not exist on type 'string \| \(/,
  ],
  ["init-chat-model-not-awaited", /Promise<ConfigurableModel/],
  ["summarization-trigger-shape", /Type 'number' has no properties in common with type '\{ fraction\?/],
  ["store-api", /Property '(get|put|search|delete)' does not exist on type 'BaseStore<string, unknown>'/],
  ["interrupt-field", /Property '__interrupt__' does not exist/],
  [
    "newer-release-name",
    /Property '(executionInfo|serverInfo)' does not exist|modelRefusalMiddleware|ModelRefusalError/,
  ],
  ["hitl-allow-flags", /'allow(Accept|Edit|Respond|Ignore)' does not exist/],
  ["untyped-message-narrowing", /Property 'tool_calls' does not exist on type 'BaseMessage/],
  ["missing-export", /has no exported member/],
  ["unknown-context-or-state", /does not exist on type '(unknown|AgentBuiltInState|String)'/],
  ["state-type", /does not exist on type 'StateType|does not exist in type 'CommandInstance|on type 'StateSchema/],
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
