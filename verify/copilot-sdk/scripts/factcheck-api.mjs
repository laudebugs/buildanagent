// Compare the API surface the mirrored Copilot SDK docs describe with the installed package's .d.ts.
// Checks:
//   1. exports       names imported from "@github/copilot-sdk" in any TS block vs index.d.ts exports
//   2. clientOptions README "Constructor" option bullets vs CopilotClientOptions
//   3. sessionConfig README "createSession" config bullets vs SessionConfig + SessionConfigBase
//                    (undocumented fields that other pages mention are listed separately)
//   4. clientMethods / sessionMethods  README "#####" method headings vs the classes' public methods
//   5. events        event names the docs subscribe to or match on vs the SessionEvent union, plus the event types the
//                    runtime actually emitted in examples/01-hello-session.ts
//   6. toolFields    defineTool config fields used or named in the docs vs the Tool interface
//   7. permission    result kinds in README's "Permission Result Kinds" table and request kinds in
//                    its handler comment vs the PermissionDecision and PermissionRequest unions
//   8. hooks         on* hook names in docs/hooks and docs/features/hooks.md vs SessionHooks
//   9. provider      ProviderConfig fields in docs/auth/byok.md's table vs ProviderConfig
// Writes results/factcheck-api.json. Usage: node scripts/factcheck-api.mjs
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SRC = "../../docs/reference/copilot-sdk/source";
const PKG = "node_modules/@github/copilot-sdk";
const read = (p) => readFile(p, "utf8");
const uniq = (xs) => [...new Set(xs)].sort();
const diff = (documented, actual, extra = {}) => {
  const d = uniq(documented);
  const a = uniq(actual);
  return {
    documented: d.length,
    actual: a.length,
    undocumented: a.filter((x) => !d.includes(x)),
    notInPackage: d.filter((x) => !a.includes(x)),
    ...extra,
  };
};
/** Body of the `{ … }` that opens on the line containing `marker`. */
const body = (src, marker) => {
  const i = src.indexOf(marker);
  if (i < 0) return "";
  let depth = 0;
  const j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(j + 1, k);
  }
  return "";
};
const members = (text, indent = 4) =>
  [...text.matchAll(new RegExp(`^ {${indent}}(?:readonly )?([a-zA-Z]\\w*)\\??[:(<]`, "gm"))].map((m) => m[1]);
const section = (md, heading) => {
  const start = md.indexOf(heading);
  if (start < 0) return "";
  const level = heading.match(/^#+/)[0].length;
  const rest = md.slice(start + heading.length);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return end < 0 ? rest : rest.slice(0, end);
};
const tsBlocks = (md) =>
  [...md.matchAll(/^\s*```(?:typescript|ts|tsx|js|javascript)\s*\n([\s\S]*?)^\s*```/gm)].map((m) => m[1]);

const pages = (await readdir(SRC, { recursive: true })).filter((f) => f.endsWith(".md"));
const docs = Object.fromEntries(await Promise.all(pages.map(async (p) => [p, await read(join(SRC, p))])));
// Only text meant for TypeScript readers: prose, plus TS/JS blocks (other languages' blocks dropped).
const tsDocs = Object.fromEntries(
  Object.entries(docs)
    .filter(([p]) => !/^(python|go|dotnet|java|rust)\//.test(p))
    .map(([p, md]) => [p, md.replace(/^\s*```(python|go|csharp|java|rust|groovy|xml|toml)\s*\n[\s\S]*?^\s*```/gm, "")]),
);
const allTs = Object.values(tsDocs).join("\n");
const readme = docs["nodejs/README.md"];

const index = await read(`${PKG}/dist/index.d.ts`);
const types = await read(`${PKG}/dist/types.d.ts`);
const clientDts = await read(`${PKG}/dist/client.d.ts`);
const sessionDts = await read(`${PKG}/dist/session.d.ts`);
const events = await read(`${PKG}/dist/generated/session-events.d.ts`);
const rpc = await read(`${PKG}/dist/generated/rpc.d.ts`);
const pkg = JSON.parse(await read(`${PKG}/package.json`));
const checks = {};

// 1. Root exports imported by the docs.
{
  const exported = [...index.matchAll(/export (?:type )?\{([^}]+)\}/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) =>
      s
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1),
    )
    .filter(Boolean);
  // `export type * from "./generated/session-events.js"` re-exports every event interface.
  exported.push(...[...events.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]));
  const imported = Object.values(tsDocs)
    .flatMap(tsBlocks)
    .flatMap((code) => [...code.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@github\/copilot-sdk["']/g)])
    .flatMap((m) => m[1].split(","))
    .map(
      (s) =>
        s
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0],
    )
    .filter(Boolean);
  const d = diff(imported, exported);
  checks.exports = { documented: d.documented, actual: d.actual, notInPackage: d.notInPackage };
}

// 2. CopilotClientOptions.
{
  const bullets = [...section(readme, "#### Constructor").matchAll(/^- `(\w+)\??:/gm)].map((m) => m[1]);
  checks.clientOptions = diff(bullets, members(body(types, "export interface CopilotClientOptions {")));
}

// 3. SessionConfig (README list), with the undocumented fields split by whether any page mentions them.
{
  const bullets = [...section(readme, "##### `createSession(").matchAll(/^- `(\w+)\??:/gm)].map((m) => m[1]);
  const fields = [
    ...members(body(types, "export interface SessionConfigBase {")),
    ...members(body(types, "export interface SessionConfig extends SessionConfigBase {")),
  ];
  const d = diff(bullets, fields);
  const mentioned = d.undocumented.filter(
    (f) => new RegExp(`\\b${f}\\b`).test(allTs.replace(readme, "")) || new RegExp(`\\b${f}\\??:`).test(readme),
  );
  checks.sessionConfig = {
    ...d,
    undocumentedButMentionedElsewhere: mentioned.length,
    neverMentioned: d.undocumented.filter((f) => !mentioned.includes(f)),
  };
}

// 4. Methods of CopilotClient and CopilotSession.
{
  const methods = (dts, cls) =>
    members(body(dts, `export declare class ${cls}`))
      .concat([...body(dts, `export declare class ${cls}`).matchAll(/^ {4}get (\w+)\(/gm)].map((m) => m[1]))
      .filter((n) => !["constructor"].includes(n) && !/^_/.test(n));
  const headings = (sec) => [...sec.matchAll(/^##### `(?:rpc\.[\w.]+|(\w+))\(/gm)].map((m) => m[1]).filter(Boolean);
  const clientSec = section(readme, "### CopilotClient");
  const sessionSec = section(readme, "### CopilotSession");
  const priv = (dts, cls) =>
    [...body(dts, `export declare class ${cls}`).matchAll(/^ {4}private (\w+)/gm)].map((m) => m[1]);
  const pub = (dts, cls) => methods(dts, cls).filter((n) => !priv(dts, cls).includes(n));
  checks.clientMethods = diff(headings(clientSec), pub(clientDts, "CopilotClient"));
  checks.sessionMethods = diff(
    [...headings(sessionSec), ...[...sessionSec.matchAll(/^##### `(\w+)\??(?::[^`]*)?`/gm)].map((m) => m[1])],
    pub(sessionDts, "CopilotSession"),
  );
}

// 5. Event names.
{
  const union = [...events.matchAll(/^ {4}type: "([\w.]+)";/gm)].map((m) => m[1]);
  const prefixes = uniq(union.map((t) => t.split(".")[0]));
  // Names in places only an event type can go: .on("…"), type === "…", case "…", and the first
  // column of the event tables in docs/features/streaming-events.md.
  const lifecycle = (types.match(/export type SessionLifecycleEventType = ([^;]+);/)?.[1] ?? "").match(/[\w.]+/g) ?? [];
  const inCode = [
    ...allTs.matchAll(/\.on\(\s*["']([\w.]+)["']/g),
    ...allTs.matchAll(/type\s*[!=]==?\s*["']([\w.]+)["']/g),
    ...allTs.matchAll(/case\s+["']([\w.]+)["']\s*:/g),
    ...(tsDocs["docs/features/streaming-events.md"] ?? "").matchAll(/^\| `([a-z_]+\.[\w.]+)` \|/gm),
  ].map((m) => m[1]);
  const named = inCode.filter((n) => n.includes(".") && prefixes.includes(n.split(".")[0]) && !lifecycle.includes(n));
  const d = diff(named, union);
  // What the runtime emitted in examples/01-hello-session.ts (printed as "observed-events: [...]").
  let observed = [];
  if (existsSync("results/run-examples.json")) {
    const run = JSON.parse(await read("results/run-examples.json")).find((r) => r.id === "01-hello-session");
    const line = run?.tail?.split("\n").find((l) => l.startsWith("observed-events: "));
    if (line) observed = JSON.parse(line.slice("observed-events: ".length));
  }
  checks.events = {
    documented: d.documented,
    actual: d.actual,
    undocumentedCount: d.undocumented.length,
    notInPackage: d.notInPackage,
    // Sorted, because the runtime emits some of these events concurrently, so their arrival order varies by run.
    emittedButUntyped: observed.filter((t) => !union.includes(t)).sort(),
  };
}

// 6. Tool definition fields.
{
  const fields = members(body(types, "export interface Tool<TArgs = unknown> {"));
  const used = Object.values(tsDocs)
    .flatMap(tsBlocks)
    .flatMap((code) => [...code.matchAll(/defineTool\(\s*["'][\w-]+["']\s*,\s*\{([\s\S]*?)\n\s*\}\s*\)/g)])
    .flatMap((m) => {
      // Top-level keys only: those at the indentation of the config object's first key.
      const indent = m[1].match(/\n( +)\w+\??\s*:/)?.[1].length ?? 4;
      return [...m[1].matchAll(new RegExp(`^ {${indent}}(\\w+)\\??\\s*:`, "gm"))].map((x) => x[1]);
    });
  const prose = fields.filter((f) => new RegExp(`\`${f}(: [^\`]+)?\``).test(allTs));
  checks.toolFields = diff([...used, ...prose, "name"], fields);
}

// 7. Permission result and request kinds.
{
  const decisionNames = (rpc.match(/export type PermissionDecision = ([^;]+);/)?.[1] ?? "")
    .split("|")
    .map((s) => s.trim());
  const kindOf = (iface) =>
    rpc.match(new RegExp(`export interface ${iface} \\{[\\s\\S]*?\\n {4}kind: "([\\w-]+)"`))?.[1];
  const resultKinds = [...decisionNames.map(kindOf).filter(Boolean), "no-result"];
  const table = section(readme, "### Permission Result Kinds");
  const docResults = [...table.matchAll(/^\| `"([\w-]+)"`/gm)].map((m) => m[1]);
  const presentTense = resultKinds.filter((k) => /^(approve-|reject$|user-not-available$|no-result$)/.test(k));
  checks.permissionResults = {
    ...diff(docResults, presentTense),
    legacyPastTenseKindsAlsoAccepted: resultKinds.filter((k) => !presentTense.includes(k)),
  };
  const reqUnion = events.match(/export type PermissionRequest = ([^;]+);/)?.[1] ?? "";
  const reqKinds = reqUnion
    .split("|")
    .map((s) => s.trim())
    .map((iface) => events.match(new RegExp(`export interface ${iface} \\{[\\s\\S]*?\\n {4}kind: "([\\w-]+)"`))?.[1])
    .filter(Boolean);
  const handler = section(readme, "### Custom Permission Handler");
  const docReq = [...handler.matchAll(/^\s*\/\/\s+"([\w-]+)"\s+—/gm)].map((m) => m[1]);
  checks.permissionRequests = diff(docReq, reqKinds);
}

// 8. Hooks.
{
  const hookDocs = Object.entries(tsDocs)
    .filter(([p]) => p.startsWith("docs/hooks/") || p === "docs/features/hooks.md")
    .map(([, md]) => md)
    .join("\n");
  const named = [...hookDocs.matchAll(/\b(on(?:Pre|Post|User|Session|Error|Agent|Subagent)\w+)\b/g)].map((m) => m[1]);
  checks.hooks = diff(named, members(body(types, "export interface SessionHooks {")));
}

// 9. ProviderConfig.
{
  const table = section(docs["docs/auth/byok.md"], "### ProviderConfig fields");
  const documented = [...table.matchAll(/^\| `(\w+)`(?: \/ `\w+`)?/gm)]
    .map((m) => m[1])
    .flatMap((f) => (f.includes(".") ? [f.split(".")[0]] : [f]));
  const azure = table.includes("`azure.apiVersion`") ? ["azure"] : [];
  checks.provider = diff([...documented, ...azure], members(body(types, "export interface ProviderConfig {")));
}

const report = {
  package: `${pkg.name}@${pkg.version}`,
  cli: pkg.copilotCliVersion,
  checkedAt: new Date().toISOString(),
  checks,
};
await writeFile("results/factcheck-api.json", JSON.stringify(report, null, 2));
console.log(`${report.package} (runtime ${report.cli})`);
for (const [k, v] of Object.entries(checks)) {
  const und = v.undocumented?.length ?? v.undocumentedCount ?? 0;
  console.log(
    `${k.padEnd(19)} docs=${v.documented} pkg=${v.actual} undocumented=${und} notInPackage=${v.notInPackage.length}`,
  );
  if (v.notInPackage.length) console.log(`   notInPackage: ${v.notInPackage.join(", ")}`);
  if (v.emittedButUntyped?.length) console.log(`   emittedButUntyped: ${v.emittedButUntyped.join(", ")}`);
  if (v.undocumented?.length && v.undocumented.length <= 20)
    console.log(`   undocumented: ${v.undocumented.join(", ")}`);
  if (v.neverMentioned) console.log(`   neverMentioned (${v.neverMentioned.length}): ${v.neverMentioned.join(", ")}`);
}
