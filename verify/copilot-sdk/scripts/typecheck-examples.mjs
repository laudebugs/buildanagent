// Type-check every extracted source against the pinned @github/copilot-sdk and classify the errors.
// "context" errors mean the file depends on something outside it (a missing optional package,
// names defined elsewhere); "api" errors mean it disagrees with the SDK's published types.
// Usage: node scripts/typecheck-examples.mjs   (run extract first)
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Run the workspace's pinned TypeScript (the root devDependency). Resolving the package, not the nearest
// node_modules/.bin/tsc, keeps a stray bin left by another TypeScript version from changing the results.
const TSC = fileURLToPath(new URL("bin/tsc", import.meta.resolve("typescript/package.json")));

// Packages this harness installs: a missing subpath of one of these is an API finding.
const INSTALLED = /['"](@github\/copilot-sdk|zod)(\/[\w/-]+)?['"]/;

// Reviewed by hand: the API-coded error follows from an import the harness can't resolve.
const CONTEXT_IDS = new Set([]);

const CONTEXT = new Set([
  18004, 7016, 7026, 2882, 2300, 2304, 2552, 2582, 2580, 7006, 7005, 7031, 7034, 7053, 18046, 18047, 18048, 2454, 1375,
  1378, 2393, 2451, 6133, 2307, 2875, 2503, 2591,
]);
const API = new Set([
  2305, 2724, 2339, 2551, 2353, 2561, 2322, 2345, 2554, 2555, 2556, 2559, 2741, 2739, 2740, 2769, 2367, 2614, 2613,
  2349, 2694,
]);

// Some doc examples are browser or React code, so include the DOM lib and JSX.
const tsconfig = (files) =>
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2024",
        lib: ["es2024", "dom"],
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node"],
        allowImportingTsExtensions: true,
        jsx: "react-jsx",
      },
      files,
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
// tsc reports only syntax errors while any file fails to parse, so peel those files off first.
let files = manifest.map((m) => `extracted/${m.file}`);
let out = "";
for (;;) {
  const pass = await runTsc(files);
  const bad = new Set([...pass.matchAll(/^(extracted\/.+?\.tsx?)\(\d+,\d+\): error TS1\d{3}:/gm)].map((m) => m[1]));
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
const ERROR_LINE = /^(extracted\/.+?\.tsx?)\((\d+),(\d+)\): error TS(\d+): (.*)$/;
// Files that use a name they never declare (a `client` or `session` from an earlier block).
const undeclared = new Set(
  out
    .split("\n")
    .map((l) => l.match(ERROR_LINE))
    .filter((m) => m && [2304, 7006].includes(Number(m[4])))
    .map((m) => m[1]),
);
for (const line of out.split("\n")) {
  const m = line.match(ERROR_LINE);
  if (!m || !byFile[m[1]]) continue;
  const code = Number(m[4]);
  // 2307 on an installed package is real drift (a bad subpath); on other modules it is context.
  const sdkModule = code === 2307 && INSTALLED.test(m[5]);
  // A call whose options don't match only because the block elides some ("// ...") is a fragment,
  // as is an undeclared name that happens to resolve to a DOM global (prompt, event).
  // In a "js" block the code is untyped JavaScript, so strict-mode errors other than a missing export
  // are context. In a TS fragment that uses an undeclared `client` or `session`, errors on `{}`,
  // `never` or `any` cascade from that missing name.
  const file = byFile[m[1]];
  const jsBlock = file.lang === "js" && ![2305, 2724].includes(code) && !sdkModule;
  const cascade = undeclared.has(m[1]) && /type '(\{\}|never)'|'any' is not assignable/.test(m[5]);
  const elidedPrompt =
    (file.elided && [2345, 2769, 2322].includes(code)) || jsBlock || cascade || CONTEXT_IDS.has(file.id);
  const kind =
    sdkModule || (API.has(code) && !elidedPrompt)
      ? "api"
      : CONTEXT.has(code) || elidedPrompt
        ? "context"
        : code < 2000
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

// Second pass: most fragments only lack the `client` or `session` an earlier block created. Declare
// the missing ones (at the end of a copy, so line numbers hold) and check again, which surfaces API
// errors the missing names were hiding. The first-pass status stays the headline number.
const PRELUDE = {
  client: 'declare const client: import("@github/copilot-sdk").CopilotClient;',
  session: 'declare const session: import("@github/copilot-sdk").CopilotSession;',
};
// Reviewed by hand: the block's `session` is something else, or its error comes from another
// undeclared name, so a declared CopilotSession proves nothing.
const PRELUDE_CONTEXT_IDS = new Set([
  "nodejs__README__01", // `session` is Electron's session (session.resolveProxy), not a CopilotSession
  "nodejs__README__18", // `answerSchema` is declared in the hidden twin block, so the typed overload can't apply
]);
const needs = (r) =>
  Object.keys(PRELUDE).filter((n) => r.errors.some((e) => e.code === 2304 && e.message === `Cannot find name '${n}'.`));
const retry = results.filter((r) => r.status === "fragment" && r.lang !== "js" && needs(r).length);
await mkdir(".tmp/prelude", { recursive: true });
for (const r of retry) {
  const code = await readFile(`extracted/${r.file}`, "utf8");
  await writeFile(
    `.tmp/prelude/${r.file}`,
    `${code}${needs(r)
      .map((n) => PRELUDE[n])
      .join("\n")}\n`,
  );
}
const second = retry.length ? await runTsc(retry.map((r) => `.tmp/prelude/${r.file}`)) : "";
for (const r of retry) {
  const errors = [...second.matchAll(/^\.tmp\/prelude\/(.+?\.tsx?)\((\d+),\d+\): error TS(\d+): (.*)$/gm)]
    .filter((m) => m[1] === r.file)
    .map((m) => {
      const code = Number(m[3]);
      const api = API.has(code) && !(r.elided && [2345, 2769, 2322].includes(code)) && !PRELUDE_CONTEXT_IDS.has(r.id);
      return { line: Number(m[2]), code, kind: api ? "api" : CONTEXT.has(code) ? "context" : "other", message: m[4] };
    });
  r.withPrelude = {
    declared: needs(r),
    status: errors.length === 0 ? "pass" : errors.some((e) => e.kind === "api") ? "api-mismatch" : "fragment",
    errors,
  };
}
await writeFile("results/typecheck-docs.json", JSON.stringify(results, null, 2));

const count = (f) => results.filter(f).length;
console.log(`sources: ${results.length}`);
for (const s of ["pass", "fragment", "api-mismatch", "syntax", "other"]) {
  console.log(
    `  ${s.padEnd(13)} ${count((r) => r.status === s)}  (complete: ${count((r) => r.status === s && r.complete)})`,
  );
}
const pre = results.filter((r) => r.withPrelude);
console.log(`fragments re-checked with a declared client/session: ${pre.length}`);
for (const s of ["pass", "fragment", "api-mismatch"])
  console.log(`  ${s.padEnd(13)} ${pre.filter((r) => r.withPrelude.status === s).length}`);
