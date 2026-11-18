// Compare the API surface the ADK TypeScript docs use with @google/adk@2.5.0's .d.ts files.
// Reads the extracted TypeScript sources (run extract first), so Python, Go, Java and Kotlin tabs are
// already gone. Checks:
//   1. LlmAgent options: keys of every `new LlmAgent({…})` / `new Agent({…})` vs LlmAgentConfig and its bases.
//   2. Callbacks: callback option keys and BasePlugin hook methods the docs use vs the types, plus the
//      Python callback names the callbacks pages document, mapped to camelCase.
//   3. Workflow agents: SequentialAgent / ParallelAgent / LoopAgent option keys, and their deprecation.
//   4. Graph workflow runtime: names the graphs/ and workflows/ sources import, and Workflow option keys.
//   5. Runner and session services: members called on runners and session services vs the classes.
//   6. "Supported in ADK" tags on every page: TypeScript versions newer than 2.5.0, and tagged sections
//      that list Python but not TypeScript (the parity signal).
// Writes results/factcheck-api.json.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TYPES = "node_modules/@google/adk/dist/types";
const DOCS = "../../docs/reference/google-adk/source/adk-docs/docs";
const PINNED = "2.5.0";
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
const dts = (p) => readFile(join(TYPES, p), "utf8");
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
// Top-level members of a type body (4-space indent in the shipped .d.ts).
const members = (text) =>
  [...text.matchAll(/^ {4}(?:readonly |abstract |static |protected |get |set )*([a-zA-Z]\w*)\??[:(<]/gm)].map(
    (m) => m[1],
  );

// Top-level keys of every object literal passed as the first argument of `<callee>(`.
function objectKeys(text, callee) {
  const keys = [];
  for (const m of text.matchAll(new RegExp(`${callee}\\(\\s*\\{`, "g"))) {
    // Skip commented-out calls: `// const runner = new Runner({`.
    if (/\/\/|^\s*\*/.test(text.slice(text.lastIndexOf("\n", m.index) + 1, m.index))) continue;
    let depth = 0;
    let token = "";
    let inValue = false;
    let quote = null;
    for (let k = text.indexOf("{", m.index); k < text.length; k++) {
      const ch = text[k];
      if (quote) {
        if (ch === quote && text[k - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === "/" && text[k + 1] === "/") {
        k = text.indexOf("\n", k) - 1;
        continue;
      }
      if (ch === "/" && text[k + 1] === "*") {
        k = text.indexOf("*/", k) + 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if ("{[(".includes(ch)) {
        depth++;
        continue;
      }
      if ("}])".includes(ch)) {
        if (--depth === 0) {
          if (!inValue && /^[a-z]\w*$/.test(token)) keys.push(token);
          break;
        }
        continue;
      }
      if (depth !== 1) continue;
      if (ch === "." && !inValue) {
        // A spread (`...handler.callbacks`) is a value, not a key.
        inValue = true;
        token = "";
      } else if (ch === ":" && !inValue) {
        if (/^[a-z]\w*$/.test(token)) keys.push(token);
        inValue = true;
        token = "";
      } else if (ch === ",") {
        if (!inValue && /^[a-z]\w*$/.test(token)) keys.push(token);
        inValue = false;
        token = "";
      } else if (!inValue) token = /[\w$]/.test(ch) ? token + ch : /\s/.test(ch) ? token : "";
    }
  }
  return keys;
}

const manifest = JSON.parse(await readFile("extracted/_manifest.json", "utf8"));
const sources = await Promise.all(
  manifest.map(async (m) => ({ ...m, text: await readFile(join("extracted", m.file), "utf8") })),
);
const all = sources.map((s) => s.text).join("\n");
const keysOf = (callee) => sources.flatMap((s) => objectKeys(s.text, callee));
const checks = {};

const baseNode = members(body(await dts("workflow/base_node.d.ts"), "export interface BaseNodeConfig"));
const baseAgent = members(body(await dts("agents/base_agent.d.ts"), "export interface BaseAgentConfig"));
const llmAgentTypes = await dts("agents/llm_agent.d.ts");
const llmAgent = members(body(llmAgentTypes, "export interface LlmAgentConfig"));

// 1. LlmAgent options.
checks.llmAgentOptions = diff(
  [...keysOf("new LlmAgent"), ...keysOf("new Agent")],
  [...llmAgent, ...baseAgent, ...baseNode],
);

// 2. Callbacks.
{
  const CALLBACK = /^(before|after|on)\w*Callback$/;
  const agentHooks = [...llmAgent, ...baseAgent].filter((n) => CALLBACK.test(n));
  const documented = [...keysOf("new LlmAgent"), ...keysOf("new Agent")].filter((n) => CALLBACK.test(n));
  const plugin = await dts("plugins/base_plugin.d.ts");
  const pluginHooks = members(body(plugin, "export declare abstract class BasePlugin")).filter((n) => CALLBACK.test(n));
  // Hook methods that BasePlugin subclasses in the docs override.
  const overridden = sources
    .filter((s) => /extends BasePlugin/.test(s.text))
    .flatMap((s) => [...s.text.matchAll(/^\s+(?:override\s+)?(?:async\s+)?(\w+Callback)\s*\(/gm)].map((m) => m[1]));
  // Python names on the callbacks pages (the TS tabs mirror them), mapped to camelCase.
  const pages = ["callbacks/index.md", "callbacks/types-of-callbacks.md", "plugins/index.md"];
  const md = (await Promise.all(pages.map((p) => readFile(join(DOCS, p), "utf8").catch(() => "")))).join("\n");
  const camel = (s) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());
  const pythonNames = uniq([...md.matchAll(/\b((?:before|after|on)_[a-z_]+_callback)\b/g)].map((m) => m[1]));
  checks.callbacks = {
    agentOptions: diff(documented, agentHooks),
    pluginHooks: diff(overridden, pluginHooks),
    pythonNamesWithoutTsEquivalent: pythonNames.filter((n) => ![...agentHooks, ...pluginHooks].includes(camel(n))),
  };
}

// 3. Workflow agents.
{
  const out = {};
  for (const [cls, file, iface] of [
    ["SequentialAgent", "agents/sequential_agent.d.ts", null],
    ["ParallelAgent", "agents/parallel_agent.d.ts", null],
    ["LoopAgent", "agents/loop_agent.d.ts", "export interface LoopAgentConfig"],
  ]) {
    const text = await dts(file);
    const own = iface ? members(body(text, iface)) : [];
    out[cls] = {
      ...diff(keysOf(`new ${cls}`), [...own, ...baseAgent, ...baseNode]),
      deprecated: /@deprecated/.test(text),
      deprecationNote: text
        .match(/@deprecated ([^\n]+(?:\n \* [^@\n][^\n]*)*)/)?.[1]
        .replace(/\n \* /g, " ")
        .trim(),
      usedInSources: sources.filter((s) => new RegExp(`new ${cls}\\(`).test(s.text)).length,
    };
  }
  checks.workflowAgents = out;
}

// 4. Graph workflow runtime.
{
  const workflowIndex = await dts("workflow/index.d.ts");
  const exported = uniq(
    [...workflowIndex.matchAll(/export (?:type )?\{([^}]+)\}/g)].flatMap((m) =>
      m[1]
        .split(",")
        .map((x) => x.trim().replace(/^type /, ""))
        .filter(Boolean),
    ),
  );
  const common = await dts("common.d.ts");
  const allExports = uniq(
    [...common.matchAll(/export (?:type )?\{([^}]+)\}/g)].flatMap((m) =>
      m[1]
        .split(",")
        .map((x) =>
          x
            .trim()
            .replace(/^type /, "")
            .split(/\s+as\s+/)
            .at(-1),
        )
        .filter(Boolean),
    ),
  );
  const graphSources = sources.filter((s) => /graphs|workflows/.test(s.page));
  const imported = uniq(
    graphSources.flatMap((s) =>
      [...s.text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@google\/adk["']/g)].flatMap((m) =>
        m[1]
          .split(",")
          .map(
            (x) =>
              x
                .trim()
                .replace(/^type /, "")
                .split(/\s+as\s+/)[0],
          )
          .filter(Boolean),
      ),
    ),
  );
  const workflowTypes = await dts("workflow/workflow.d.ts");
  const workflowKeys = [
    ...members(body(workflowTypes, "export type WorkflowConfig = BaseNodeConfig & {")),
    "edges",
    "dynamicEntry",
    ...baseNode,
  ];
  checks.graphRuntime = {
    sources: graphSources.length,
    workflowExports: exported.length,
    importsNotExported: imported.filter((n) => !allExports.includes(n)),
    workflowRuntimeNamesUsed: imported.filter((n) => exported.includes(n)),
    workflowOptions: diff(keysOf("new Workflow"), workflowKeys),
    experimental: /@experimental/.test(workflowTypes),
  };
}

// 5. Runner and session services.
{
  const runner = members(body(await dts("runner/runner.d.ts"), "export declare class Runner"));
  const session = members(
    body(await dts("sessions/base_session_service.d.ts"), "export declare abstract class BaseSessionService"),
  );
  const inMemory = members(
    body(await dts("sessions/in_memory_session_service.d.ts"), "export declare class InMemorySessionService"),
  );
  const calls = (re) => uniq([...all.matchAll(re)].map((m) => m[1]));
  checks.runner = {
    members: diff(calls(/\brunner\.(\w+)\b/g), runner),
    configKeys: diff(
      [...keysOf("new Runner"), ...keysOf("new InMemoryRunner")],
      members(body(await dts("runner/runner.d.ts"), "export interface RunnerConfig")),
    ),
  };
  checks.sessionService = diff(calls(/[sS]essionService\.(\w+)\(/g), [...session, ...inMemory]);
}

// 6. "Supported in ADK" tags.
{
  const pages = (await readdir(DOCS, { recursive: true })).filter((f) => f.endsWith(".md")).sort();
  const newer = (v) => {
    const [a, b, c] = v.split(".").map(Number);
    const [x, y, z] = PINNED.split(".").map(Number);
    return a > x || (a === x && (b > y || (b === y && c > z)));
  };
  const tags = [];
  for (const p of pages) {
    const lines = (await readFile(join(DOCS, p), "utf8")).split("\n");
    lines.forEach((l, i) => {
      if (!l.includes('class="lst-supported"')) return;
      const langs = Object.fromEntries(
        [...l.matchAll(/class="lst-(python|typescript|go|java|kotlin)">([^<]*)</g)].map((m) => [
          m[1],
          m[2].match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? "unversioned",
        ]),
      );
      const status = l.match(/class="lst-preview">([^<]*)</)?.[1];
      // The heading this tag annotates: the nearest heading above it.
      const heading =
        lines
          .slice(0, i)
          .reverse()
          .find((h) => /^#{1,4} /.test(h))
          ?.replace(/^#+ /, "") ?? null;
      tags.push({ page: `docs/${p}`, line: i + 1, heading, langs, status });
    });
  }
  const pythonOnly = tags.filter((t) => t.langs.python && !t.langs.typescript);
  checks.supportTags = {
    tags: tags.length,
    withTypeScript: tags.filter((t) => t.langs.typescript).length,
    typescriptNewerThanPinned: tags.filter(
      (t) => t.langs.typescript && t.langs.typescript !== "unversioned" && newer(t.langs.typescript),
    ),
    pythonWithoutTypeScript: pythonOnly.length,
    pythonWithoutTypeScriptSections: pythonOnly.map(
      (t) => `${t.page}:${t.line} ${t.heading ?? ""} (Python ${t.langs.python}${t.status ? `, ${t.status}` : ""})`,
    ),
  };
}

const pkg = JSON.parse(await readFile("node_modules/@google/adk/package.json", "utf8"));
const out = { package: `@google/adk@${pkg.version}`, checks };
await writeFile("results/factcheck-api.json", JSON.stringify(out, null, 2));
const { pythonWithoutTypeScriptSections, ...tagSummary } = checks.supportTags;
console.log(JSON.stringify({ ...out, checks: { ...checks, supportTags: tagSummary } }, null, 2));
