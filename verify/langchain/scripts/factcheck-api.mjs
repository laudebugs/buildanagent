// Compare the API surface the LangChain JS docs describe with the installed packages.
// Checks: middleware hooks (custom.mdx table), built-in middleware factories (built-in.mdx),
// createAgent options used anywhere in the JS docs, and the documented recursion-limit default.
// Pages mix Python and JS, so ":::python" blocks are removed before reading names.
// Writes results/factcheck-api.json.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DOCS = "../../docs/reference/langchain/source/src/oss";
const jsOnly = (t) => t.replace(/^:::python[ \t]*$[\s\S]*?^:::[ \t]*$/gm, "");
const page = async (p) => jsOnly(await readFile(join(DOCS, p), "utf8"));
const dts = (p) => readFile(join("node_modules", p), "utf8");
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
/** Body of the `{ … }` that opens on the line containing `marker`. */
const body = (src, marker) => {
  const i = src.indexOf(marker);
  if (i < 0) return "";
  let depth = 0;
  const j = src.lastIndexOf("{", src.indexOf("\n", i));
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(j + 1, k);
  }
  return "";
};
const members = (text) => [...text.matchAll(/^ {2}(?:readonly )?([a-zA-Z]\w*)\??[:(]/gm)].map((m) => m[1]);

const checks = {};
const mwTypes = await dts("langchain/dist/agents/middleware/types.d.ts");
const index = await dts("langchain/dist/index.d.ts");

// 1. Middleware hooks: the table rows in custom.mdx vs the hook members of AgentMiddleware.
{
  const md = await page("langchain/middleware/custom.mdx");
  const documented = [...md.matchAll(/^\| `(\w+)` \|/gm)]
    .map((m) => m[1])
    .filter((n) => /^(before|after|wrap)/.test(n));
  const hooks = members(body(mwTypes, "export interface AgentMiddleware<")).filter((n) =>
    /^(before|after|wrap)/.test(n),
  );
  checks.middlewareHooks = diff(documented, hooks);
}

// 2. Built-in middleware: camelCase factories named in built-in.mdx vs those exported by langchain.
{
  const md = await page("langchain/middleware/built-in.mdx");
  const documented = [...md.matchAll(/\b([a-z]\w*Middleware)\b/g)]
    .map((m) => m[1])
    .filter((n) => n !== "createMiddleware");
  const exported = [...index.matchAll(/\b([a-z]\w*Middleware)\b/g)]
    .map((m) => m[1])
    .filter((n) => n !== "createMiddleware");
  // Factories the page imports from other packages (e.g. deepagents) are not langchain's.
  const foreign = [...md.matchAll(/import \{([^}]+)\} from ["'](?!langchain["'])([^"']+)["']/g)].flatMap((m) =>
    m[1].split(",").map((x) => x.trim()),
  );
  checks.builtInMiddleware = {
    ...diff(
      documented.filter((n) => !foreign.includes(n)),
      exported,
    ),
    fromOtherPackages: uniq(documented.filter((n) => foreign.includes(n))),
  };
}

// 3. createAgent options: top-level keys used in createAgent({ … }) across the JS docs, vs the
//    members of CreateAgentParams.
{
  const files = (await readdir(DOCS, { recursive: true })).filter((f) => f.endsWith(".mdx"));
  const used = [];
  for (const f of files) {
    const text = await page(f);
    for (const m of text.matchAll(/createAgent\(\{/g)) {
      // Walk the object literal: skip strings, track depth, and read a key only before ":" or a
      // shorthand "," at depth 1; everything after ":" is a value until the next depth-1 ",".
      let depth = 0;
      let token = "";
      let inValue = false;
      let quote = null;
      for (let k = m.index + "createAgent(".length; k < text.length; k++) {
        const ch = text[k];
        if (quote) {
          if (ch === quote && text[k - 1] !== "\\") quote = null;
          continue;
        }
        if (ch === "/" && text[k + 1] === "/") {
          k = text.indexOf("\n", k) - 1;
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
            if (!inValue && /^[a-z]\w*$/.test(token)) used.push(token);
            break;
          }
          continue;
        }
        if (depth !== 1) continue;
        if (ch === ":" && !inValue) {
          if (/^[a-z]\w*$/.test(token)) used.push(token);
          inValue = true;
          token = "";
        } else if (ch === ",") {
          if (!inValue && /^[a-z]\w*$/.test(token)) used.push(token);
          inValue = false;
          token = "";
        } else if (!inValue) token = /[\w$]/.test(ch) ? token + ch : /\s/.test(ch) ? token : "";
      }
    }
  }
  const types = await dts("langchain/dist/agents/types.d.ts");
  const params = members(body(types, "export type CreateAgentParams<")).concat(
    members(body(types, "interface CreateAgentParams<")),
  );
  checks.createAgentOptions = diff(uniq(used), params);
}

// 4. The recursion limit: graph-api.mdx says "The default is N super-steps".
{
  const md = await page("langgraph/graph-api.mdx");
  const documented = Number(md.match(/default is (\d+) super-steps/)?.[1]);
  const loop = await dts("@langchain/langgraph/dist/pregel/loop.js");
  const constants = (await readdir("node_modules/@langchain/langgraph/dist", { recursive: true })).filter((f) =>
    f.endsWith(".js"),
  );
  let actual;
  for (const f of constants) {
    const m = (await dts(`@langchain/langgraph/dist/${f}`)).match(/DEFAULT_LOOP_LIMIT = (\d+)/);
    if (m) {
      actual = Number(m[1]);
      break;
    }
  }
  checks.recursionLimitDefault = {
    documented,
    actual,
    usedIn: loop.includes("DEFAULT_LOOP_LIMIT"),
    match: documented === actual,
  };
}

const pkg = JSON.parse(await readFile("node_modules/langchain/package.json", "utf8"));
const out = { package: `langchain@${pkg.version}`, checks };
await writeFile("results/factcheck-api.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
