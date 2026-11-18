// Collect every TypeScript source the OpenAI Agents SDK docs show, into extracted/:
//   1. examples/**/*.ts (docs/ plus the one embedded file outside it), copied with their layout so relative imports resolve, each mapped to
//      the docs pages that embed it through `import x from '…?raw'` + <Code code={x} />;
//   2. inline ```typescript blocks in the .md/.mdx pages, one file per block.
// Usage: node scripts/extract-examples.mjs
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const source = resolve("../../docs/reference/openai-agents-sdk/source");
const docsDir = join(source, "docs/src/content/docs");
const examplesDir = join(source, "examples");
const outDir = resolve("extracted");
const SDK = /from\s+["']@openai\/agents[\w/-]*["']/;
// A program that runs an agent end to end (definitions alone are not complete).
const RUNS = /\b(run|runner\.run|new Runner\([^)]*\)\.run|Runner\.run)\s*\(|await\s+run\(/;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Which pages embed which example files.
const embeds = new Map();
const pages = [];
for await (const f of walk(docsDir)) if (/\.mdx?$/.test(f)) pages.push(f);
pages.sort();
for (const page of pages) {
  const text = await readFile(page, "utf8");
  for (const m of text.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.ts)\?raw['"]/g)) {
    const file = relative(examplesDir, resolve(dirname(page), m[2]));
    const shown = new RegExp(`code=\\{${m[1]}\\b`).test(text);
    const list = embeds.get(file) ?? [];
    list.push({ page: relative(docsDir, page), shown });
    embeds.set(file, list);
  }
}

const manifest = [];

// 1. The example files, layout preserved.
await cp(examplesDir, join(outDir, "examples"), { recursive: true });
for await (const f of walk(examplesDir)) {
  if (!f.endsWith(".ts")) continue;
  const rel = relative(examplesDir, f);
  const code = await readFile(f, "utf8");
  const usedBy = embeds.get(rel) ?? [];
  manifest.push({
    id: `ex:${rel}`,
    file: `examples/${rel}`,
    kind: "example-file",
    pages: usedBy.map((u) => u.page),
    embedded: usedBy.some((u) => u.shown),
    importsSdk: SDK.test(code),
    complete: SDK.test(code) && RUNS.test(code),
  });
}

// 2. Inline code blocks in the pages.
for (const page of pages) {
  const lines = (await readFile(page, "utf8")).split("\n");
  const rel = relative(docsDir, page);
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(typescript|ts|tsx)\b/i);
    if (!open) continue;
    const [, indent, fence] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === fence) break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    n++;
    const id = `block:${rel.replace(/\.mdx?$/, "")}#${n}`;
    const file = `blocks/${rel.replace(/\.mdx?$/, "").replace(/\//g, "_")}__${String(n).padStart(2, "0")}.ts`;
    const code = body.join("\n");
    await mkdir(join(outDir, "blocks"), { recursive: true });
    await writeFile(join(outDir, file), `// source: ${rel}:${i + 1}\n${code}\nexport {};\n`);
    manifest.push({
      id,
      file,
      kind: "doc-block",
      pages: [rel],
      line: i + 1,
      embedded: true,
      importsSdk: SDK.test(code),
      complete: SDK.test(code) && RUNS.test(code),
    });
    i = j;
  }
}

manifest.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const files = manifest.filter((m) => m.kind === "example-file");
const missing = [...embeds.keys()].filter((k) => !files.some((f) => f.id === `ex:${k}`));
console.log(
  `${files.length} example files (${files.filter((f) => f.embedded).length} shown on ${pages.length} pages, ${files.filter((f) => f.complete).length} look complete); ${manifest.length - files.length} inline blocks`,
);
if (missing.length) console.log(`embeds pointing at missing files: ${missing.join(", ")}`);
