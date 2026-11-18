// Compare the API surface the OpenAI Agents SDK guides document with the installed package.
// Checks: Agent constructor properties, run() arguments, RunConfig fields, run-item stream event
// names, error classes, and the documented maxTurns default. Writes results/factcheck-api.json.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const GUIDES = "../../docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides";
const CORE = "node_modules/@openai/agents-core/dist";
const guide = (f) => readFile(join(GUIDES, f), "utf8");
const dts = (f) => readFile(join(CORE, f), "utf8");
const pkg = JSON.parse(await readFile("node_modules/@openai/agents/package.json", "utf8"));

const uniq = (xs) => [...new Set(xs)].sort();
const diff = (documented, actual) => {
  const d = uniq(documented);
  const a = uniq(actual);
  return {
    documented: d.length,
    actual: a.length,
    undocumented: a.filter((x) => !d.includes(x)),
    notInPackage: d.filter((x) => !a.includes(x)),
  };
};
/** Body of the first `{ ... }` block after `marker`. */
const block = (src, marker) => {
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
/** Top-level member names of a type literal body (4-space indent in the .d.ts files). */
const members = (body) => [...body.matchAll(/^ {4}(\w+)\??:/gm)].map((m) => m[1]);
/** Backticked names in the first column of the table that follows `heading`. */
const tableNames = (md, heading) => {
  const start = md.indexOf(heading);
  const rest = md.slice(start + heading.length);
  const end = rest.search(/\n#{2,4} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| `([\w]+)`(?: \/ `(\w+)`)? \|/gm)].flatMap((m) => [m[1], m[2]].filter(Boolean));
};

const checks = {};
const agentsMd = await guide("agents.mdx");
const runMd = await guide("running-agents.mdx");
const streamMd = await guide("streaming.mdx");

// 1. Agent constructor properties.
{
  const src = await dts("agent.d.ts");
  const body = block(src, "export interface AgentConfiguration") || block(src, "type AgentConfiguration");
  checks.agentConfiguration = diff(tableNames(agentsMd, "### Basic configuration"), members(body));
}

// 2. run() arguments: SharedRunOptions plus `stream`.
{
  const src = await dts("run.d.ts");
  const actual = [...members(block(src, "type SharedRunOptions")), "stream"];
  checks.runOptions = diff(tableNames(runMd, "### Run arguments"), actual);
}

// 3. RunConfig fields.
{
  const src = await dts("run.d.ts");
  checks.runConfig = diff(tableNames(runMd, "### Run config"), members(block(src, "export type RunConfig = {")));
}

// 4. Run-item stream event names.
{
  const src = await dts("events.d.ts");
  const union = src.match(/export type RunItemStreamEventName = ([^;]+);/)?.[1] ?? "";
  const documented = [...streamMd.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).filter((n) => n !== "name");
  checks.runItemEvents = diff(
    documented,
    [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  );
}

// 5. Error classes listed under "Exceptions" vs exported subclasses of AgentsError.
{
  const section = runMd.slice(runMd.indexOf("### Exceptions"));
  const documented = [...section.matchAll(/^- \[`(\w+Error)`\]/gm)].map((m) => m[1]);
  const src = await dts("errors.d.ts");
  const actual = [...src.matchAll(/export declare class (\w+Error) extends (\w+)/g)]
    .filter((m) => m[2] === "AgentsError" || m[2].endsWith("Error"))
    .map((m) => m[1]);
  checks.errors = diff(documented, actual);
}

// 6. Documented defaults.
{
  const constants = await dts("runner/constants.d.ts");
  const documented = runMd.match(/\| `maxTurns` \| `(\d+)` \|/)?.[1];
  const actual = constants.match(/DEFAULT_MAX_TURNS = (\d+)/)?.[1];
  checks.maxTurnsDefault = {
    documented: Number(documented),
    actual: Number(actual),
    undocumented: [],
    notInPackage: documented === actual ? [] : [`docs say ${documented}, package says ${actual}`],
  };
}

const report = { package: `${pkg.name}@${pkg.version}`, checkedAt: new Date().toISOString(), checks };
await writeFile("results/factcheck-api.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(report.package);
for (const [k, v] of Object.entries(checks)) {
  console.log(
    `${k.padEnd(20)} docs=${v.documented} pkg=${v.actual}  undocumented=${v.undocumented.length}  notInPackage=${v.notInPackage.length}`,
  );
  if (v.undocumented.length) console.log(`   undocumented: ${v.undocumented.join(", ")}`);
  if (v.notInPackage.length) console.log(`   notInPackage: ${v.notInPackage.join(", ")}`);
}
