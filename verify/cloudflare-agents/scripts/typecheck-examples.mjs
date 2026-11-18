// Type-check every extracted source against the pinned Cloudflare Agents packages and classify the errors.
// "context" errors mean the file depends on something outside it (a missing optional package,
// names defined elsewhere); "api" errors mean it disagrees with the SDK's published types.
// Usage: node scripts/typecheck-examples.mjs   (run extract first)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Find tsc in the nearest node_modules/.bin (pnpm keeps shared dev tools at the repo root).
const findBin = (name, dir = dirname(fileURLToPath(import.meta.url))) =>
  existsSync(join(dir, "node_modules/.bin", name))
    ? join(dir, "node_modules/.bin", name)
    : dirname(dir) === dir
      ? name
      : findBin(name, dirname(dir));
const TSC = findBin("tsc");

// Packages this harness installs: a missing subpath of one of these is an API finding.
const INSTALLED =
  /['"](agents|@cloudflare\/(think|ai-chat|workers-types)|ai|@ai-sdk\/(openai|anthropic|provider)|workers-ai-provider|zod|@modelcontextprotocol\/(sdk|server|client))(\/[\w/.-]+)?['"]/;

// Reviewed by hand: the API-coded error follows from an import the harness can't resolve.
const CONTEXT_IDS = new Set([]);

const CONTEXT = new Set([
  2391, 2390, 4112, 2689, 18004, 7016, 7026, 2882, 2300, 2304, 2552, 2582, 2580, 7006, 7005, 7031, 7034, 7053, 18046,
  18047, 18048, 2454, 1375, 1378, 2393, 2451, 6133, 2307, 2875, 2503, 2591,
]);
const API = new Set([
  2305, 2724, 2339, 2551, 2353, 2561, 2322, 2345, 2554, 2555, 2556, 2559, 2741, 2739, 2740, 2769, 2367, 2614, 2613,
  2349, 2694, 2416,
]);

// Mirrors the agents package's shipped tsconfig (agents/tsconfig): DOM libs plus Workers types,
// minus vite/client. scripts/env.d.ts types the Env every doc block assumes.
const tsconfig = (files) =>
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2024",
        lib: ["es2024", "dom", "dom.iterable"],
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node", "@cloudflare/workers-types"],
        allowImportingTsExtensions: true,
        jsx: "react-jsx",
      },
      files: ["scripts/env.d.ts", ...files],
    },
    null,
    2,
  );
const runTsc = async (files) => {
  await writeFile(".tmp-tsconfig.json", tsconfig(files));
  try {
    execFileSync(TSC, ["-p", ".tmp-tsconfig.json", "--pretty", "false"], { encoding: "utf8", maxBuffer: 64e6 });
    return "";
  } catch (e) {
    return e.stdout ?? "";
  }
};

const manifest = JSON.parse(await readFile("extracted/_manifest.json", "utf8"));
// tsc reports only syntax errors while any file fails to parse (TS1xxx, plus JSX parse errors
// TS2657 and TS17xxx), so peel those files off first.
let files = manifest.map((m) => `extracted/${m.file}`);
let out = "";
for (;;) {
  const pass = await runTsc(files);
  const bad = new Set(
    [...pass.matchAll(/^(extracted\/.+?\.tsx?)\(\d+,\d+\): error TS(1\d{3}|2657|17\d{3}):/gm)].map((m) => m[1]),
  );
  if (bad.size === 0) {
    out += pass;
    break;
  }
  out += `${pass
    .split("\n")
    .filter((l) => bad.has(l.split("(")[0]))
    .join("\n")}\n`;
  files = files.filter((f) => !bad.has(f));
}

const byFile = Object.fromEntries(manifest.map((m) => [`extracted/${m.file}`, { ...m, errors: [] }]));
const diagnostics = [...out.matchAll(/^(extracted\/.+?\.tsx?)\((\d+),(\d+)\): error TS(\d+): (.*)$/gm)];
// Names a file uses without declaring or importing (TS2304/2552/2689). A class extending one of
// them has no inherited members, so "Property 'state' does not exist on type 'MyAgent'" is a
// consequence of the missing import, not an API finding.
const unresolved = {};
for (const [, f, , , code, msg] of diagnostics) {
  const name = ["2304", "2552"].includes(code)
    ? msg.match(/^Cannot find name '(\w+)'/)?.[1]
    : code === "2689"
      ? msg.match(/interface '(\w+)'/)?.[1]
      : null;
  if (!name) continue;
  unresolved[f] ??= new Set();
  unresolved[f].add(name);
}
const sources = {};
const text = async (f) => (sources[f] ??= await readFile(f, "utf8"));
async function orphanClass(f, cls) {
  const src = await text(f);
  const base = src.match(new RegExp(`class\\s+${cls}\\b[^{]*?\\bextends\\s+([\\w.]+)`))?.[1];
  if (!base) return false;
  if (unresolved[f]?.has(base)) return true;
  // A mixin base such as `const VoiceAgent = withVoice(Agent)` over an unresolved class.
  const mixinArg = src.match(new RegExp(`const\\s+${base}\\s*=\\s*\\w+\\(\\s*(\\w+)`))?.[1];
  if (mixinArg && unresolved[f]?.has(mixinArg)) return true;
  return base !== cls && /^\w+$/.test(base) && new RegExp(`class\\s+${base}\\b`).test(src) && orphanClass(f, base);
}
for (const m of diagnostics) {
  if (!byFile[m[1]]) continue;
  const code = Number(m[4]);
  // `this.…` at module level (a method body shown on its own) is "possibly undefined".
  const looseThis =
    (code === 2532 || (code === 2345 && /^Argument of type 'undefined'/.test(m[5]))) &&
    /\bthis\b/.test((await text(m[1])).split("\n")[Number(m[2]) - 1] ?? "");
  const onType = m[5].match(/on type '(\w+)(<[^']*>)?'\.?( Did you mean '\w+'\?)?$/)?.[1];
  // Without a wrangler config, bindings are `any`: a stub from getAgentByName(env.X) is typed as a
  // plain Agent, and `cloudflare:workers` exports have no entries, so custom members are missing.
  const untypedBinding =
    /on type '(DurableObjectStub|DynamicAgentStub)<Agent<Env, unknown, object>>'|on type 'Exports'/.test(m[5]);
  // A member missing from the doc's own class whose body is elided ("// ...") was elided with it.
  const elidedMember =
    byFile[m[1]].elided &&
    [2339, 2551].includes(code) &&
    onType &&
    new RegExp(`class\\s+${onType}\\b`).test(await text(m[1]));
  const cascade =
    looseThis ||
    untypedBinding ||
    elidedMember ||
    ([2339, 2551].includes(code) && onType && (await orphanClass(m[1], onType)));
  // 2307 on an installed LangChain package is real drift (a bad subpath); on other modules it is context.
  const sdkModule = code === 2307 && INSTALLED.test(m[5]);
  // A call whose options don't match only because the block elides some ("// ...") is a fragment,
  // as is an undeclared name that happens to resolve to a DOM global (prompt, event).
  const elidedPrompt =
    (byFile[m[1]].elided && [2345, 2769, 2322, 2416, 2355, 2366, 2740].includes(code)) ||
    /^Type '\(message\?: string|on type 'Event'/.test(m[5]) ||
    CONTEXT_IDS.has(byFile[m[1]].id) ||
    cascade;
  const kind =
    sdkModule || (API.has(code) && !elidedPrompt)
      ? "api"
      : CONTEXT.has(code) || elidedPrompt
        ? "context"
        : code < 2000 || code === 2657 || (code >= 17000 && code < 18000)
          ? "syntax"
          : "other";
  byFile[m[1]].errors.push({ line: Number(m[2]), code, kind, message: m[5] });
}

const results = Object.values(byFile).map((r) => {
  const kinds = new Set(r.errors.map((e) => e.kind));
  const status =
    r.errors.length === 0
      ? "pass"
      : kinds.has("api")
        ? "api-mismatch"
        : kinds.has("syntax")
          ? "syntax"
          : kinds.has("other")
            ? "other"
            : "fragment";
  return { ...r, status };
});
await writeFile("results/typecheck-docs.json", JSON.stringify(results, null, 2));

const count = (f) => results.filter(f).length;
console.log(`sources: ${results.length}`);
for (const s of ["pass", "fragment", "api-mismatch", "syntax", "other"]) {
  console.log(
    `  ${s.padEnd(13)} ${count((r) => r.status === s)}  (complete: ${count((r) => r.status === s && r.complete)})`,
  );
}
