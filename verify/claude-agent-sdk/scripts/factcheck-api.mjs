// Compare the API surface documented in typescript.md with the installed SDK's sdk.d.ts.
// Checks: exported functions, Options fields, PermissionMode, HookEvent, SDKMessage members,
// and the tool input schema names. Writes factcheck-api.json and prints a summary.
// Usage: node scripts/factcheck-api.mjs
import { readFile, writeFile } from "node:fs/promises";

const docs = await readFile("../../docs/reference/claude-agent-sdk/source/typescript.md", "utf8");
const dts = await readFile("node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts", "utf8");
const pkg = JSON.parse(await readFile("node_modules/@anthropic-ai/claude-agent-sdk/package.json", "utf8"));

const section = (heading) => {
  const start = docs.indexOf(heading);
  if (start < 0) return "";
  const rest = docs.slice(start + heading.length);
  const level = heading.match(/^#+/)[0].length;
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return end < 0 ? rest : rest.slice(0, end);
};
const dtsBlock = (decl) => {
  const i = dts.indexOf(decl);
  if (i < 0) return "";
  let depth = 0, j = dts.indexOf("{", i);
  for (let k = j; k < dts.length; k++) {
    if (dts[k] === "{") depth++;
    else if (dts[k] === "}" && --depth === 0) return dts.slice(j + 1, k);
  }
  return "";
};
const unionLiterals = (s) => [...s.matchAll(/["']([\w-]+)["']/g)].map((m) => m[1]);
const dtsUnion = (name) => {
  const m = dts.match(new RegExp(`export declare type ${name} = ([^;]+);`));
  return m ? m[1] : "";
};
const diff = (documented, actual) => ({
  documented: documented.length,
  actual: actual.length,
  undocumented: actual.filter((x) => !documented.includes(x)).sort(),
  notInPackage: documented.filter((x) => !actual.includes(x)).sort(),
});

const checks = {};

// 1. Exported functions
const docFns = [...section("## Functions").matchAll(/^### `(\w+)\(\)`/gm)].map((m) => m[1]);
const dtsFns = [...dts.matchAll(/^export declare function (\w+)/gm)].map((m) => m[1]);
checks.functions = diff([...new Set(docFns)], [...new Set(dtsFns)]);

// 2. Options fields (top-level members only: 4-space indent inside the type literal)
const docOpts = [...section("### `Options`").matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
const dtsOpts = [...dtsBlock("export declare type Options = {").matchAll(/^    (\w+)\??:/gm)].map((m) => m[1]);
checks.options = diff([...new Set(docOpts)], [...new Set(dtsOpts)]);

// 3. PermissionMode and HookEvent unions
checks.permissionMode = diff(unionLiterals(section("### `PermissionMode`")), unionLiterals(dtsUnion("PermissionMode")));
checks.hookEvent = diff(unionLiterals(section("### `HookEvent`")), unionLiterals(dtsUnion("HookEvent")));

// 4. SDKMessage union members
const docMsg = [...section("### `SDKMessage`").matchAll(/\|\s*(SDK\w+)/g)].map((m) => m[1]);
const dtsMsg = [...dtsUnion("SDKMessage").matchAll(/(SDK\w+)/g)].map((m) => m[1]);
checks.sdkMessage = diff([...new Set(docMsg)], [...new Set(dtsMsg)]);

// 5. Built-in tool input schemas: "### Name" headings under Tool Input Types vs ToolInputSchemas union
const toolSection = section("## Tool Input Types");
const docTools = [...toolSection.matchAll(/^### (\w+)$/gm)].map((m) => m[1]);
const toolsDts = await readFile("node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts", "utf8").catch(() => "");
const unionSrc = (toolsDts.match(/export type ToolInputSchemas =([\s\S]*?);/) ?? [])[1] ?? "";
const dtsTools = [...unionSrc.matchAll(/(\w+)Input\b/g)].map((m) => m[1]);
checks.toolInputs = diff([...new Set(docTools)], [...new Set(dtsTools)]);

const report = { package: `${pkg.name}@${pkg.version}`, checkedAt: new Date().toISOString(), checks };
await writeFile("results/factcheck-api.json", JSON.stringify(report, null, 2));
console.log(report.package);
for (const [k, v] of Object.entries(checks)) {
  console.log(`${k.padEnd(15)} docs=${v.documented} pkg=${v.actual}  undocumented=${v.undocumented.length}  notInPackage=${v.notInPackage.length}`);
  if (v.undocumented.length) console.log(`   undocumented: ${v.undocumented.join(", ")}`);
  if (v.notInPackage.length) console.log(`   notInPackage: ${v.notInPackage.join(", ")}`);
}
