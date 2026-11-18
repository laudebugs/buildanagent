// Compare the API surface the Cloudflare Agents docs use with the pinned packages' .d.ts files.
// Checks:
//   1. Members: every `this.<name>` a doc block uses inside a class extending Agent, AIChatAgent,
//      Think or McpAgent (and every `this.mcp.<name>`) must be declared by the block itself or by
//      the base class chain (Agent extends the platform DurableObject). Also lists public base
//      members no page mentions.
//   2. Imports: every name a doc block imports from agents, @cloudflare/think or
//      @cloudflare/ai-chat (any subpath) must be exported there, and the subpath must exist in the
//      package's exports map. Checked by compiling one probe file per module with tsc.
// Writes results/factcheck-api.json.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Run the workspace's pinned TypeScript (the root devDependency). Resolving the package, not the nearest
// node_modules/.bin/tsc, keeps a stray bin left by another TypeScript version from changing the results.
const TSC = fileURLToPath(new URL("bin/tsc", import.meta.resolve("typescript/package.json")));

const manifest = JSON.parse(readFileSync("extracted/_manifest.json", "utf8")).filter((m) => !m.example);
const blocks = manifest.map((m) => ({ ...m, code: readFileSync(join("extracted", m.file), "utf8") }));
const SOURCE = "../../docs/reference/cloudflare-agents/source";
const allDocsText = readdirSync(SOURCE, { recursive: true })
  .filter((f) => /\.mdx?$/.test(f))
  .map((f) => readFileSync(join(SOURCE, f), "utf8"))
  .join("\n");
const uniq = (xs) => [...new Set(xs)].sort();
const dist = (pkg) => join("node_modules", pkg, "dist");
const dtsText = (pkg) =>
  readdirSync(dist(pkg), { recursive: true })
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => readFileSync(join(dist(pkg), f), "utf8"))
    .join("\n");

/** Body of the class declared by `marker`: from the first "{" that ends a line, brace-matched. */
function classBody(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return "";
  const start = src.indexOf(" {\n", i) + 1;
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(start, k);
  }
  return "";
}
/** Public member names of a class body (two-space indent, not private or #private). */
const members = (body) =>
  uniq(
    [
      ...body.matchAll(
        /^ {2}(?!private\b)(?:(?:readonly|static|protected|public|abstract|override|get|set|async|declare)\s+)*([A-Za-z_$][\w$]*)[?!]?\s*[(<:]/gm,
      ),
    ].map((m) => m[1]),
  ).filter((n) => !["constructor", "private"].includes(n));

const agentsDts = dtsText("agents");
const thinkDts = dtsText("@cloudflare/think");
const chatDts = dtsText("@cloudflare/ai-chat");
// Agent extends the platform DurableObject (cloudflare:workers): ctx, env and the handler methods.
const DURABLE_OBJECT = ["ctx", "env", "fetch", "alarm", "webSocketMessage", "webSocketClose", "webSocketError"];
const AGENT = [...members(classBody(agentsDts, "declare class Agent<")), ...DURABLE_OBJECT];
const BASES = {
  Agent: AGENT,
  AIChatAgent: [...AGENT, ...members(classBody(chatDts, "declare class AIChatAgent<"))],
  Think: [...AGENT, ...members(classBody(thinkDts, "declare class Think<"))],
  McpAgent: [...AGENT, ...members(classBody(agentsDts, "declare abstract class McpAgent<"))],
};
const MCP_MANAGER = members(classBody(agentsDts, "declare class MCPClientManager "));
const checks = { baseMembers: Object.fromEntries(Object.entries(BASES).map(([k, v]) => [k, uniq(v).length])) };

// 1. Member usage.
{
  const missing = {};
  const used = {};
  const add = (bucket, key, where) => {
    bucket[key] ??= [];
    if (bucket[key].length < 3) bucket[key].push(where);
  };
  for (const b of blocks) {
    const local = new Set(
      [
        ...b.code.matchAll(
          /^\s*(?:(?:readonly|static|protected|public|private|override|async|get|set|declare)\s+)*([A-Za-z_$][\w$]*)\s*[?!]?\s*(?:[(<:=]|$)/gm,
        ),
        ...b.code.matchAll(/^\s*@\w+\([^)]*\)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm),
      ].map((m) => m[1]),
    );
    // Each class extending an SDK base, with its own body (other classes in the block are skipped).
    for (const c of b.code.matchAll(
      /class\s+\w+(?:<[^>{]*>)?\s+extends\s+(Agent|AIChatAgent|Think|McpAgent)\b[^{]*\{/g,
    )) {
      const base = c[1];
      let depth = 0;
      let end = c.index + c[0].length - 1;
      for (; end < b.code.length; end++) {
        if (b.code[end] === "{") depth++;
        else if (b.code[end] === "}" && --depth === 0) break;
      }
      const body = b.code.slice(c.index, end);
      for (const m of body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
        const [, name, sub] = m;
        const where = `${b.page}:${b.line}`;
        add(used, `${base}.${name}`, where);
        if (name === "mcp" && sub && !local.has("mcp")) {
          add(used, `mcp.${sub}`, where);
          if (!MCP_MANAGER.includes(sub)) add(missing, `this.mcp.${sub}`, where);
        }
        // A helper the block calls but elides ("// ...") is the block's own, not the SDK's.
        if (!local.has(name) && !BASES[base].includes(name) && !b.elided) add(missing, `${base}.${name}`, where);
      }
    }
  }
  // Public members of the bases that no page mentions by name.
  const undocumented = Object.fromEntries(
    Object.entries(BASES).map(([k, v]) => [
      k,
      uniq(v).filter(
        (n) => !n.startsWith("_") && !DURABLE_OBJECT.includes(n) && !new RegExp(`\\b${n}\\b`).test(allDocsText),
      ),
    ]),
  );
  // Split the misses: names the packages declare somewhere (a mixin member, a different class)
  // are worth reviewing; names they never declare are the block's own helpers, not shown.
  const allDts = `${agentsDts}\n${thinkDts}\n${chatDts}`;
  const sorted = Object.entries(missing).sort();
  const inDts = ([k]) => new RegExp(`\\b${k.split(".").pop()}\\b`).test(allDts);
  checks.members = {
    usedNames: Object.keys(used).length,
    notInPackage: Object.fromEntries(sorted.filter(inDts)),
    helpersNotShown: Object.fromEntries(sorted.filter((e) => !inDts(e)).map(([k, v]) => [k, v[0]])),
    undocumentedPublicMembers: undocumented,
  };
}

// 2. Imports: names per module, probed with tsc.
{
  const byModule = {};
  for (const b of blocks) {
    for (const m of b.code.matchAll(
      /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']((?:agents|@cloudflare\/(?:think|ai-chat))(?:\/[\w/.-]+)?)["']/g,
    )) {
      for (const raw of m[2].split(",")) {
        const name = raw
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue; // comments or elisions inside the braces
        byModule[m[3]] ??= {};
        byModule[m[3]][name] ??= [];
        if (byModule[m[3]][name].length < 3) byModule[m[3]][name].push(`${b.page}:${b.line}`);
      }
    }
  }
  const pkgOf = (spec) => spec.match(/^(@cloudflare\/[\w-]+|agents)/)[1];
  const exportsMap = (pkg) =>
    Object.keys(JSON.parse(readFileSync(join("node_modules", pkg, "package.json"), "utf8")).exports);
  const missingSubpaths = {};
  const probes = [];
  for (const [spec, names] of Object.entries(byModule)) {
    const pkg = pkgOf(spec);
    const sub = `.${spec.slice(pkg.length)}`;
    if (!exportsMap(pkg).includes(sub)) {
      missingSubpaths[spec] = Object.values(names).flat().slice(0, 3);
      continue;
    }
    const file = `.tmp-probe-${probes.length}.ts`;
    const list = Object.keys(names);
    writeFileSync(
      file,
      `import type { ${list.map((n, i) => `${n} as _${i}`).join(", ")} } from "${spec}";\nexport {};\n`,
    );
    probes.push({ file, spec, list, names });
  }
  writeFileSync(
    ".tmp-probe-tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "es2024",
        lib: ["es2024", "dom"],
        module: "esnext",
        moduleResolution: "bundler",
        noEmit: true,
        skipLibCheck: true,
        types: ["@cloudflare/workers-types"],
      },
      files: ["scripts/env.d.ts", ...probes.map((p) => p.file)],
    }),
  );
  let out = "";
  try {
    execFileSync(TSC, ["-p", ".tmp-probe-tsconfig.json", "--pretty", "false"], { encoding: "utf8" });
  } catch (e) {
    out = e.stdout ?? "";
  }
  const notExported = {};
  for (const m of out.matchAll(/^(\.tmp-probe-\d+\.ts)\(\d+,\d+\): error TS(2305|2724|2614): .*?'(\w+)'/gm)) {
    const p = probes.find((x) => x.file === m[1]);
    notExported[`${p.spec}#${m[3]}`] = p.names[m[3]];
  }
  if (process.env.KEEP_PROBES) console.log(out.slice(0, 2000));
  for (const p of probes) execFileSync("rm", ["-f", p.file]);
  execFileSync("rm", ["-f", ".tmp-probe-tsconfig.json"]);
  checks.imports = {
    modules: Object.keys(byModule).length,
    names: Object.values(byModule).reduce((n, x) => n + Object.keys(x).length, 0),
    missingSubpaths,
    notExported,
  };
}

writeFileSync("results/factcheck-api.json", `${JSON.stringify(checks, null, 2)}\n`);
const m = checks.members;
console.log(
  `members: ${m.usedNames} used, ${Object.keys(m.notInPackage).length} not on the base class, ${Object.keys(m.helpersNotShown).length} helpers the blocks never define; undocumented public: ${Object.entries(
    m.undocumentedPublicMembers,
  )
    .map(([k, v]) => `${k} ${v.length}`)
    .join(", ")}`,
);
console.log(
  `imports: ${checks.imports.names} names from ${checks.imports.modules} modules; ${Object.keys(checks.imports.missingSubpaths).length} missing subpaths, ${Object.keys(checks.imports.notExported).length} names not exported`,
);
