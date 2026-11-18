// Compare the API surface the AI SDK reference pages document with the installed package.
// Checks: generateText and streamText parameters, ToolLoopAgent settings, tool() options, the
// stop-condition helpers, and the documented default step cap. Writes results/factcheck-api.json.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REF = "../../docs/reference/vercel-ai-sdk/source/content/docs/07-reference/01-ai-sdk-core";
const page = (f) => readFile(join(REF, f), "utf8");
const js = await readFile("node_modules/ai/dist/index.js", "utf8");
const dts = await readFile("node_modules/ai/dist/index.d.ts", "utf8");
const utilsDts = await readFile("node_modules/@ai-sdk/provider-utils/dist/index.d.ts", "utf8");
const pkg = JSON.parse(await readFile("node_modules/ai/package.json", "utf8"));

const uniq = (xs) => [...new Set(xs)].sort();
const diff = (documented, actual, deprecatedNames = []) => {
  const d = uniq(documented);
  const a = uniq(actual);
  // experimental_X is a deprecated alias when X also exists; `system` is the alias of `instructions`.
  const deprecated = [
    ...deprecatedNames,
    ...a.filter((x) => a.includes(x.replace(/^experimental_/, "")) && x !== x.replace(/^experimental_/, "")),
  ];
  const undocumented = a.filter((x) => !d.includes(x));
  return {
    documented: d.length,
    actual: a.length,
    undocumented: undocumented.filter((x) => !deprecated.includes(x)),
    undocumentedDeprecated: undocumented.filter((x) => deprecated.includes(x)),
    notInPackage: d.filter((x) => !a.includes(x)),
  };
};

/** Text between the first `open` at or after `from` and its matching `close`. */
const balanced = (src, from, open = "{", close = "}") => {
  const j = src.indexOf(open, from);
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) depth++;
    else if (src[k] === close && --depth === 0) return src.slice(j + 1, k);
  }
  return "";
};

/** Top-level `name:` entries of the first <PropertiesTable> after `heading`. */
const tableNames = (md, heading) => {
  const start = md.indexOf(heading);
  if (start < 0) return [];
  const body = balanced(md, md.indexOf("content={", start), "[", "]");
  const names = (text) => {
    const indent = text.match(/^( *)name: /m)?.[1] ?? "";
    return [...text.matchAll(new RegExp(`^${indent}name: '([\\w$]+)'`, "gm"))].map((m) => m[1]);
  };
  const top = names(body);
  // tool() documents one wrapper entry whose `properties` hold the real options.
  return top.length === 1 ? names(balanced(body, body.indexOf("parameters: ["), "[", "]")) : top;
};

/** Top-level keys of a destructured parameter list, e.g. `function f({ a, b = 1, c: d, ...rest })`. */
const destructured = (signature) => {
  const body = balanced(signature, 0);
  const keys = [];
  let depth = 0;
  let token = "";
  for (const ch of `${body},`) {
    if ("{[(".includes(ch)) depth++;
    if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      const key = token.trim().split(/[\s:=]/)[0];
      if (key && !key.startsWith("...") && !key.startsWith("_")) keys.push(key);
      token = "";
    } else token += ch;
  }
  return keys;
};

/** Top-level members of a type literal (2-space indent), and which carry @deprecated. */
const typeMembers = (src, marker) => {
  const i = src.indexOf(marker);
  if (i < 0) return { names: [], deprecated: [] };
  // The type literal opens with the last "{" on the marker's line (`= {` or `& {`).
  const body = balanced(src, src.lastIndexOf("{", src.indexOf("\n", i)));
  const names = [];
  const deprecated = [];
  let doc = "";
  for (const line of body.split("\n")) {
    if (/^ {2}\/\*\*/.test(line)) doc = "";
    if (/^ {2,3}\*/.test(line) || /^ {2}\/\*\*/.test(line)) doc += line;
    const m = line.match(/^ {2}([a-zA-Z]\w*)\??:/);
    if (m) {
      names.push(m[1]);
      if (/@deprecated/.test(doc)) deprecated.push(m[1]);
      doc = "";
    }
  }
  return { names, deprecated };
};

const deprecatedIn = (...members) => members.flatMap((m) => m.deprecated);
const callOptions = typeMembers(dts, "type LanguageModelCallOptions = {");
const requestOptions = typeMembers(dts, "type RequestOptions<TOOLS extends ToolSet$1 = ToolSet$1> = {");
const prompt = typeMembers(dts, "type Prompt = {");
const toolsContext = {
  names: [
    ...typeMembers(dts, "type ToolsContextParameter<TOOLS extends ToolSet$1> = {").names,
    ...typeMembers(dts, "type ToolsContextSettings<").names,
  ],
};
const generateDeprecated = deprecatedIn(
  callOptions,
  requestOptions,
  prompt,
  typeMembers(dts, "declare function generateText"),
);

const checks = {};

// 1-2. generateText and streamText: the keys the implementation destructures, plus the
// LanguageModelCallOptions it spreads into `...settings`, plus experimental_steering.
for (const [name, file, fn] of [
  ["generateText", "01-generate-text.mdx", "async function generateTextInternal("],
  ["streamText", "02-stream-text.mdx", "function streamTextInternal("],
]) {
  const sig = js.slice(js.indexOf(fn));
  const actual = [...destructured(sig), ...callOptions.names, "experimental_steering"];
  const deprecated = uniq([
    ...generateDeprecated,
    "system",
    "onFinish",
    "onStepFinish",
    ...actual.filter((k) => /^experimental_on/.test(k)),
  ]);
  checks[name] = diff(tableNames(await page(file), "### Parameters"), actual, deprecated);
}

// 3. ToolLoopAgent constructor settings.
{
  const own = typeMembers(dts, "type ToolLoopAgentSettings<");
  const actual = [
    ...own.names,
    ...callOptions.names,
    ...requestOptions.names.filter((n) => n !== "abortSignal"),
    ...toolsContext.names,
  ];
  checks.toolLoopAgentSettings = diff(
    tableNames(await page("16-tool-loop-agent.mdx"), "### Parameters"),
    actual,
    deprecatedIn(own, callOptions, requestOptions),
  );
}

// 4. tool() options: the members of every Tool variant (function, dynamic, provider tools).
{
  const variants = [
    "BaseTool",
    "BaseFunctionTool",
    "FunctionTool",
    "DynamicTool",
    "BaseProviderTool",
    "ProviderDefinedTool",
    "ProviderExecutedTool",
    "ToolOutputProperties",
  ].map((t) => typeMembers(utilsDts, `type ${t}<`));
  checks.toolOptions = diff(
    tableNames(await page("20-tool.mdx"), "### Parameters"),
    variants.flatMap((v) => v.names),
    deprecatedIn(...variants),
  );
}

// 5. Stop-condition helpers named in the reference pages exist as exports.
{
  const exportsLine = js.slice(js.lastIndexOf("export {"));
  const exported = (n) => new RegExp(`\\b${n}\\b`).test(exportsLine);
  const helpers = ["isStepCount", "hasToolCall", "isLoopFinished", "stepCountIs"];
  checks.stopHelpers = Object.fromEntries(helpers.map((h) => [h, exported(h)]));
}

// 6. Documented default: ToolLoopAgent stops after isStepCount(20).
{
  const documented = Number((await page("16-tool-loop-agent.mdx")).match(/Default: isStepCount\((\d+)\)/)?.[1]);
  const actual = Number(js.match(/stopWhen: this\.settings\.stopWhen \?\? createDefaultStopCondition\((\d+)\)/)?.[1]);
  checks.agentDefaultStepCap = { documented, actual, match: documented === actual };
}

const out = { package: `ai@${pkg.version}`, checks };
await writeFile("results/factcheck-api.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
