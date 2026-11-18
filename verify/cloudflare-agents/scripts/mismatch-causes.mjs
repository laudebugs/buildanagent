// Group the remaining API mismatches by root cause, so the fact-check can count them.
// Each cause is a regex over the error message (or the page, for migration guides); the first
// match wins. Writes results/mismatch-causes.json. Run after typecheck-examples.mjs and
// ahead-of-release.mjs.
import { readFileSync, writeFileSync } from "node:fs";

const CAUSES = [
  // Migration guides show the code you are migrating from, so old AI SDK names are expected.
  ["migration-before-code", /'"ai"' has no exported member|Cannot find module 'ai\/react'/, /migration-to-ai-sdk/],
  [
    "wrong-import-path",
    /'"agents"' has no exported member '(AgentWorkflow\w*)'|Cannot find module 'agents\/experimental\/memory|'"@cloudflare\/think"' has no exported member 'Workspace'|'"@cloudflare\/codemode"' has no exported member/,
  ],
  ["api-not-in-any-release", /defineScheduledTasks|defineMessengers/],
  ["workflow-cascade", /on type '\w+Workflow'/],
  ["ai-sdk-v3-provider-types", /LanguageModelV3|specificationVersion/],
  ["override-signature-mismatch", /is not assignable to the same property in base type/],
  ["route-handler-returns-null", /Promise<Response \| null>/],
  ["untyped-client-or-row-state", /on type '\{\}'/],
  ["unknown-payload", /on type 'unknown'|Argument of type 'unknown'/],
  ["service-worker-globals", /on type 'Window & typeof globalThis'/],
  ["typed-array-generics", /ArrayBufferLike/],
  ["workers-types-request-generic", /Request<CfHostMetadata/],
  ["helper-not-shown", /does not exist on type '(typeof )?[A-Z]\w*'/],
  [
    "call-shape",
    /No overload matches|is not assignable|has no properties in common|Expected \d+(-\d+)? arguments|is missing in type|not callable|does not exist in type|does not exist on type/,
  ],
];

const results = JSON.parse(readFileSync("results/typecheck-docs.json", "utf8"));
const byCause = {};
for (const r of results.filter((r) => r.status === "api-mismatch")) {
  for (const e of r.errors.filter((e) => e.kind === "api")) {
    const cause = CAUSES.find(([, re, page]) => re.test(e.message) && (!page || page.test(r.page)))?.[0] ?? "other";
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
  console.log(`${k.padEnd(30)} ${String(v.errors).padStart(3)} errors in ${v.files.length} files`);
