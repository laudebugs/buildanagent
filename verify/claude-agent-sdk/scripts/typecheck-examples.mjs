// Type-check every extracted example against the pinned SDK and classify the errors.
// "context" errors mean the block is a fragment (it uses names defined elsewhere on the page).
// "api" errors mean the block disagrees with the SDK's published types: candidate doc drift.
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

const CONTEXT = new Set([
  2300, 2304, 2552, 2582, 2580, 7006, 7005, 7031, 7034, 7053, 18046, 18047, 18048, 2454, 1375, 1378, 2393, 2451, 6133,
  2307, 2875, 2503, 2591,
]);
const API = new Set([
  2305, 2724, 2339, 2551, 2353, 2561, 2322, 2345, 2554, 2555, 2556, 2559, 2741, 2739, 2740, 2769, 2367, 2614, 2613,
  2349, 2694,
]);

const tsconfig = (files) =>
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2022",
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node"],
        isolatedModules: true,
        allowJs: false,
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
let files = manifest.map((m) => `extracted/${m.id}.ts`);
let out = "";
for (;;) {
  const pass = await runTsc(files);
  const bad = new Set([...pass.matchAll(/^(extracted\/[\w.-]+\.ts)\(\d+,\d+\): error TS1\d{3}:/gm)].map((m) => m[1]));
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
const byId = Object.fromEntries(manifest.map((m) => [m.id, { ...m, errors: [] }]));
const re = /^extracted\/([\w.-]+)\.ts\((\d+),(\d+)\): error TS(\d+): (.*)$/;
for (const line of out.split("\n")) {
  const m = line.match(re);
  if (!m || !byId[m[1]]) continue;
  const code = Number(m[4]);
  // 2307 on the SDK itself is real drift (bad subpath); on other modules it is fragment context.
  const sdkModule = code === 2307 && /@anthropic-ai\/claude-agent-sdk/.test(m[5]);
  const kind = sdkModule || API.has(code) ? "api" : CONTEXT.has(code) ? "context" : code < 2000 ? "syntax" : "other";
  byId[m[1]].errors.push({ line: Number(m[2]) - 1, code, kind, message: m[5] }); // -1 for the source header line
}

const results = Object.values(byId).map((r) => {
  const kinds = new Set(r.errors.map((e) => e.kind));
  // Pages that document removed APIs on purpose (the page says so) are expected to fail.
  const removedPage = r.page === "typescript-v2-preview.md";
  const signatureOnly = r.errors.length > 0 && r.errors.every((e) => e.code === 2391 || e.kind === "context");
  const status =
    r.errors.length === 0
      ? "pass"
      : removedPage
        ? "documented-removed"
        : signatureOnly && r.errors.some((e) => e.code === 2391)
          ? "signature"
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
const statuses = ["pass", "signature", "fragment", "documented-removed", "api-mismatch", "syntax", "other"];
console.log(`blocks: ${results.length}`);
for (const s of statuses)
  console.log(
    `  ${s.padEnd(18)} ${count((r) => r.status === s)}  (SDK-importing: ${count((r) => r.status === s && r.importsSdk)})`,
  );
