// Extract every TypeScript source from the mirrored Copilot SDK docs into one file each.
// Pages show the same example in up to six languages; only typescript/ts/tsx/js blocks are kept.
// The upstream repo marks blocks for its own (unpublished) docs validator with
// "<!-- docs-validate: strict|hidden|skip|wrap-async -->"; the marker is recorded per block.
// Whole TypeScript files under nodejs/examples/ and samples/ are copied as sources too.
// Usage: node scripts/extract-examples.mjs [sourceDir] [outDir]
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const sourceDir = resolve(process.argv[2] ?? "../../docs/reference/copilot-sdk/source");
const outDir = resolve(process.argv[3] ?? "extracted");
const LANGS = { ts: "ts", typescript: "ts", tsx: "tsx", js: "ts", javascript: "ts" };
const SDK_IMPORT = /from\s+["']@github\/copilot-sdk(\/[\w-]+)?["']/;
// "Complete" means it builds a client itself and could run as-is (it does not lean on a `client`
// or `session` defined in an earlier block).
const isComplete = (code) => SDK_IMPORT.test(code) && /new\s+CopilotClient\s*\(/.test(code);
const isElided = (code) =>
  /^\s*(\/\/\s*)?\.\.\.\s*$|\/\*\s*\.\.\.\s*\*\/|^\s*\/\/\s*\.\.\.|\{\s*\.\.\.\s*\}/m.test(code);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const all = (await readdir(sourceDir, { recursive: true })).sort();
const slug = (p) => p.replace(/\.(mdx?|m?ts)$/, "").replace(/[/.]/g, "__");
const manifest = [];

for (const page of all.filter((f) => f.endsWith(".md"))) {
  const lines = (await readFile(join(sourceDir, page), "utf8")).split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(\S*)\s*(.*)$/);
    if (!open) continue;
    const [, indent, fence, rawLang, info] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, "") === "") break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    const ext = LANGS[rawLang.toLowerCase()];
    if (ext) {
      n++;
      const code = body.join("\n");
      const id = `${slug(page)}__${String(n).padStart(2, "0")}`;
      // The validator marker, if any, sits on one of the three lines above the fence.
      const near = lines.slice(Math.max(0, i - 3), i).join("\n");
      const validate = [...near.matchAll(/<!-- docs-validate: ([\w-]+) -->/g)].at(-1)?.[1] ?? null;
      const importsSdk = SDK_IMPORT.test(code);
      await writeFile(join(outDir, `${id}.${ext}`), `// source: ${page}:${i + 1}\n${code}\nexport {};\n`);
      manifest.push({
        id,
        file: `${id}.${ext}`,
        page,
        line: i + 1,
        lang: rawLang,
        title: info.trim() || null,
        validate,
        lines: body.length,
        importsSdk,
        complete: isComplete(code),
        elided: isElided(code),
      });
    }
    i = j;
  }
}

for (const f of all.filter((f) => /^(nodejs\/examples|samples)\/.+\.m?ts$/.test(f))) {
  const code = await readFile(join(sourceDir, f), "utf8");
  const id = slug(f);
  await writeFile(join(outDir, `${id}.ts`), `// source: ${f}:1\n${code}\n`);
  const importsSdk = SDK_IMPORT.test(code);
  manifest.push({
    id,
    file: `${id}.ts`,
    page: f,
    line: 1,
    lang: "file",
    title: null,
    validate: null,
    lines: code.split("\n").length,
    importsSdk,
    complete: isComplete(code),
    elided: false,
  });
}

await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const blocks = manifest.filter((m) => m.lang !== "file");
console.log(
  `${blocks.length} TypeScript blocks from ${new Set(blocks.map((m) => m.page)).size} pages and ${manifest.length - blocks.length} example files; ${manifest.filter((m) => m.importsSdk).length} import the SDK; ${manifest.filter((m) => m.complete).length} look complete`,
);
