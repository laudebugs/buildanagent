// Extract every TypeScript block from the mirrored Pi docs, plus the upstream example files the
// docs link to, into extracted/ (one file per block) with a manifest.
// Usage: node scripts/extract-examples.mjs
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const sourceDir = resolve("../../docs/reference/pi/source");
const outDir = resolve("extracted");
const LANGS = new Set(["typescript", "ts", "tsx"]);
const SDK = /from\s+["']@earendil-works\/pi-[\w-]+(\/[\w/-]+)?["']/;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const manifest = [];
const pages = [];
for await (const f of walk(sourceDir)) if (f.endsWith(".md")) pages.push(f);
pages.sort();

// 1. Code blocks in Markdown pages.
for (const file of pages) {
  const page = relative(sourceDir, file);
  const lines = (await readFile(file, "utf8")).split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(\S*)\s*(.*)$/);
    if (!open || !LANGS.has(open[3].toLowerCase())) continue;
    const [, indent, fence] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, "") === "") break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    n++;
    const code = body.join("\n");
    const id = `${page.replace(/\.md$/, "").replace(/[/]/g, "_")}__${String(n).padStart(2, "0")}`;
    const importsSdk = SDK.test(code);
    // Runnable as a program: imports Pi and creates a session or calls a model (extensions are loaded by Pi, not run).
    const complete =
      importsSdk &&
      !/export default function/.test(code) &&
      /\b(createAgentSession|createAgentSessionRuntime|new Agent|complete|stream|streamSimple|completeSimple|runPrintMode|runRpcMode)\s*\(/.test(
        code,
      );
    await writeFile(join(outDir, `${id}.ts`), `// source: ${page}:${i + 1}\n${code}\nexport {};\n`);
    manifest.push({ id, page, line: i + 1, kind: "doc-block", lines: body.length, importsSdk, complete });
    i = j;
  }
}

// 2. Upstream example files (SDK programs and extensions), copied verbatim.
for (const sub of ["sdk", "extensions"]) {
  const dir = join(sourceDir, "examples", sub);
  for await (const f of walk(dir)) {
    if (!f.endsWith(".ts")) continue;
    const rel = relative(join(sourceDir, "examples"), f);
    const id = `example_${rel.replace(/\.ts$/, "").replace(/[/]/g, "_")}`;
    // Files are flattened into one folder, so rewrite relative imports between example files
    // ("./index.ts", "../shared/x.ts") to their flattened names.
    const relDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const code = (await readFile(f, "utf8")).replace(
      /(from\s+["'])(\.{1,2}\/[^"']+)\.(?:ts|js)(["'])/g,
      (_, a, spec, b) => {
        const target = join(relDir, spec).replace(/[/]/g, "_");
        return `${a}./example_${target}.ts${b}`;
      },
    );
    await writeFile(
      join(outDir, `${id}.ts`),
      `// source: examples/${rel}\n${code}${code.includes("export") ? "" : "\nexport {};"}\n`,
    );
    manifest.push({
      id,
      page: `examples/${rel}`,
      line: 1,
      kind: `example-${sub}`,
      lines: code.split("\n").length,
      importsSdk: SDK.test(code),
      complete: sub === "sdk",
    });
  }
}

await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const blocks = manifest.filter((m) => m.kind === "doc-block");
console.log(
  `${blocks.length} TypeScript blocks from ${new Set(blocks.map((m) => m.page)).size} pages (${blocks.filter((m) => m.importsSdk).length} import Pi, ${blocks.filter((m) => m.complete).length} look complete)`,
);
console.log(
  `${manifest.length - blocks.length} upstream example files (${manifest.filter((m) => m.kind === "example-sdk").length} SDK programs)`,
);
