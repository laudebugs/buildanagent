// Type-check every extracted example against the pinned SDK and classify the errors.
// "context" errors mean the block is a fragment (it uses names defined elsewhere on the page).
// "api" errors mean the block disagrees with the SDK's published types: candidate doc drift.
// Usage: node scripts/typecheck-examples.mjs   (run extract first)
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Run the workspace's pinned TypeScript (the root devDependency). Resolving the package, not the nearest
// node_modules/.bin/tsc, keeps a stray bin left by another TypeScript version from changing the results.
const TSC = fileURLToPath(new URL("bin/tsc", import.meta.resolve("typescript/package.json")));

const CONTEXT = new Set([
  18004, 7016, 2300, 2304, 2552, 2582, 2580, 7006, 7005, 7031, 7034, 7053, 18046, 18047, 18048, 2454, 1375, 1378, 2393,
  2451, 6133, 2307, 2875, 2503, 2591,
]);
const API = new Set([
  2305, 2724, 2339, 2551, 2353, 2561, 2322, 2345, 2554, 2555, 2556, 2559, 2741, 2739, 2740, 2769, 2367, 2614, 2613,
  2349, 2694,
]);

// Match the Pi repo's tsconfig.base.json (ES2024, strict). Extension code is checked against the
// extension view of pi-ai that Pi supplies at run time (see shims/); programs use the real package.
const tsconfig = (files, extension) =>
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2024",
        lib: ["es2024"],
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node"],
        isolatedModules: true,
        allowJs: false,
        allowImportingTsExtensions: true,
        ...(extension ? { paths: { "@earendil-works/pi-ai": ["./shims/pi-ai-extension-view.ts"] } } : {}),
      },
      files,
    },
    null,
    2,
  );
let profile = false;
const runTsc = async (files) => {
  await writeFile(".tmp-tsconfig.json", tsconfig(files, profile));
  try {
    execFileSync(TSC, ["-p", ".tmp-tsconfig.json", "--pretty", "false"], { encoding: "utf8", maxBuffer: 64e6 });
    return "";
  } catch (e) {
    return e.stdout ?? "";
  }
};

const manifest = JSON.parse(await readFile("extracted/_manifest.json", "utf8"));
// Extension code: upstream extension examples, and doc blocks that use the ExtensionAPI.
const isExtension = async (m) =>
  m.kind === "example-extensions" ||
  /ExtensionAPI|ExtensionContext|pi\.registerTool|pi\.on\(/.test(await readFile(`extracted/${m.id}.ts`, "utf8"));
const extFlags = await Promise.all(manifest.map(isExtension));
let out = "";
for (const ext of [false, true]) {
  profile = ext;
  // tsc reports only syntax errors while any file fails to parse, so peel those files off first.
  let files = manifest.filter((_m, i) => extFlags[i] === ext).map((m) => `extracted/${m.id}.ts`);
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
}
const byId = Object.fromEntries(manifest.map((m, i) => [m.id, { ...m, extensionProfile: extFlags[i], errors: [] }]));
const re = /^extracted\/([\w.-]+)\.ts\((\d+),(\d+)\): error TS(\d+): (.*)$/;
for (const line of out.split("\n")) {
  const m = line.match(re);
  if (!m || !byId[m[1]]) continue;
  const code = Number(m[4]);
  // 2307 on the SDK itself is real drift (bad subpath); on other modules it is fragment context.
  const sdkModule = code === 2307 && /@earendil-works\/pi-[\w-]+/.test(m[5]);
  const kind = sdkModule || API.has(code) ? "api" : CONTEXT.has(code) ? "context" : code < 2000 ? "syntax" : "other";
  byId[m[1]].errors.push({ line: Number(m[2]) - 1, code, kind, message: m[5] }); // -1 for the source header line
}

const results = Object.values(byId).map((r) => {
  const kinds = new Set(r.errors.map((e) => e.kind));
  // Pages that document removed APIs on purpose (the page says so) are expected to fail.
  const removedPage = false; // Pi has no page documenting removed APIs
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
