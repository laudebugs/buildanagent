// Compare the API surface Pi's reference pages document with the installed 1.5.2 package.
// Checks: settings keys, session entry types, RPC commands, extension events,
// createAgentSession() options, and AgentSession members named in sdk.md.
// Writes results/factcheck-api.json and prints a summary.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DOCS = "../../docs/reference/pi/source/coding-agent";
const PKG = "node_modules/@earendil-works/pi-coding-agent";
const doc = (f) => readFile(join(DOCS, f), "utf8");
const dts = (f) => readFile(join(PKG, "dist", f), "utf8");
const pkg = JSON.parse(await readFile(join(PKG, "package.json"), "utf8"));

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

const checks = {};

// 1. Settings: settings.md tables vs the package's JSON schema (top-level keys).
{
  const md = await doc("settings.md");
  const documented = [...md.matchAll(/^\| `([\w.]+)` \|/gm)].map((m) => m[1].split(".")[0]);
  const schema = JSON.parse(await readFile(join(PKG, "schemas/settings.schema.json"), "utf8"));
  checks.settings = diff(
    documented,
    Object.keys(schema.properties ?? {}).filter((k) => k !== "$schema"),
  );
}

// 2. Session entry types: "### XxxEntry" headings vs the SessionEntry union.
{
  const md = await doc("session-format.md");
  const documented = [...md.matchAll(/^### (\w+Entry)$/gm)].map((m) => m[1]);
  const src = await dts("core/session-manager.d.ts");
  const union = src.match(/export type SessionEntry = ([^;]+);/)?.[1] ?? "";
  checks.sessionEntries = diff(
    documented,
    union.split("|").map((s) => s.trim()),
  );
}

// 3. RPC commands: "### name" headings vs `type: "..."` members of RpcCommand.
{
  const md = await doc("rpc-commands.md");
  const documented = [...md.matchAll(/^### ([a-z_]+)$/gm)].map((m) => m[1]);
  const src = await dts("modes/rpc/rpc-types.d.ts");
  const start = src.indexOf("export type RpcCommand =");
  const end = src.indexOf(";\n", src.indexOf("}", start) + 1);
  const body = src.slice(start, src.indexOf("\nexport ", start + 10));
  const actual = [...body.matchAll(/^\s+type: "([a-z_]+)";/gm)].map((m) => m[1]);
  checks.rpcCommands = diff(
    documented,
    actual.length ? actual : [...src.slice(start, end).matchAll(/type: "([a-z_]+)"/g)].map((m) => m[1]),
  );
}

// 4. Extension events: "#### a / b" headings under "## Events" vs pi.on("event", ...) overloads.
{
  const md = await doc("extensions.md");
  const events = md.slice(md.indexOf("\n## Events"), md.indexOf("\n## ", md.indexOf("\n## Events") + 5));
  const documented = [...events.matchAll(/^#### ([a-z_ /]+)$/gm)].flatMap((m) => m[1].split("/").map((s) => s.trim()));
  const src = await dts("core/extensions/types.d.ts");
  const actual = [...src.matchAll(/^\s+on\(event: "([a-z_]+)"/gm)].map((m) => m[1]);
  checks.extensionEvents = diff(documented, actual);
}

// 5. createAgentSession() options named in sdk.md vs CreateAgentSessionOptions.
{
  const md = await doc("sdk.md");
  const section = md.slice(md.indexOf("## Configuring a session"), md.indexOf("## Examples"));
  const bullets = section.split("\n").filter((l) => l.startsWith("- "));
  const documented = [...bullets.join("\n").matchAll(/`(\w+)`/g)].map((m) => m[1]).concat(["cwd", "sessionManager"]);
  const src = await dts("core/sdk.d.ts");
  const actual = [...block(src, "export interface CreateAgentSessionOptions").matchAll(/^\s{4}(\w+)\??:/gm)].map(
    (m) => m[1],
  );
  const r = diff(documented, actual);
  checks.createAgentSessionOptions = r;
}

// 6. AgentSession members sdk.md names as `session.x` vs the class declaration.
{
  const md = await doc("sdk.md");
  const named = [...md.matchAll(/`session\.(\w+)/g)].map((m) => m[1]);
  const bare = [...md.matchAll(/`(prompt|steer|followUp|abort|waitForIdle|subscribe|dispose)\(\)`/g)].map((m) => m[1]);
  const src = await dts("core/agent-session.d.ts");
  const cls = block(src, "export declare class AgentSession ");
  const members = [...cls.matchAll(/^\s{4}(?:readonly |get |set |static |private |protected )*(\w+)[(?:<]/gm)].map(
    (m) => m[1],
  );
  const documented = uniq([...named, ...bare]);
  checks.agentSessionMembers = {
    documented: documented.length,
    actual: uniq(members).length,
    notInPackage: documented.filter((x) => !members.includes(x)),
    undocumented: [],
  };
}

const report = { package: `${pkg.name}@${pkg.version}`, checkedAt: new Date().toISOString(), checks };
await writeFile("results/factcheck-api.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(report.package);
for (const [k, v] of Object.entries(checks)) {
  console.log(
    `${k.padEnd(26)} docs=${v.documented} pkg=${v.actual}  undocumented=${v.undocumented.length}  notInPackage=${v.notInPackage.length}`,
  );
  if (v.undocumented.length) console.log(`   undocumented: ${v.undocumented.join(", ")}`);
  if (v.notInPackage.length) console.log(`   notInPackage: ${v.notInPackage.join(", ")}`);
}
