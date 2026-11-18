// Extract every TypeScript code block from the mirrored AI SDK docs into one file per block.
// Ids come from the page's path under content/, so blocks from different sections never collide.
// Usage: node scripts/extract-examples.mjs [sourceDir] [outDir]
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const sourceDir = resolve(process.argv[2] ?? "../../docs/reference/vercel-ai-sdk/source/content");
const outDir = resolve(process.argv[3] ?? "extracted");
const LANGS = { ts: "ts", typescript: "ts", tsx: "tsx" };
const MODEL = '"anthropic/claude-sonnet-5.5"';

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const pages = (await readdir(sourceDir, { recursive: true })).filter((f) => /\.mdx?$/.test(f)).sort();
const manifest = [];
for (const page of pages) {
  const lines = (await readFile(join(sourceDir, page), "utf8")).split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(\S*)\s*(.*)$/);
    const ext = open && LANGS[open[3].toLowerCase()];
    if (!ext) continue;
    const [, indent, fence, , info] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, "") === "") break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    n++;
    // The docs site fills these placeholders from its model picker; its default is the gateway
    // string below, with no provider import (checked on ai-sdk.dev, 2026-11-18).
    const code = body
      .join("\n")
      .replace(/^\s*__PROVIDER_IMPORT__;?\s*$/gm, "")
      .replace(/__MODEL__/g, MODEL);
    const slug = relative(".", page)
      .replace(/\.mdx?$/, "")
      .replace(/(^|\/)\d+-/g, "$1")
      .replace(/\//g, "__");
    const id = `${slug}__${String(n).padStart(2, "0")}`;
    const file = `${id}.${ext}`;
    const title = info.match(/filename="([^"]+)"/)?.[1] ?? null;
    const importsSdk = /from\s+["'](ai|@ai-sdk\/[\w-]+)(\/[\w-]+)?["']/.test(code);
    // "Complete" means it imports the SDK and calls a generation or agent API, so it could run as-is.
    const complete =
      importsSdk &&
      /\b(generateText|streamText|generateObject|streamObject|embed|embedMany)\s*\(|\.(generate|stream)\s*\(/.test(
        code,
      );
    await writeFile(
      join(outDir, file),
      `// source: ${page}:${i + 1}${title ? ` (${title})` : ""}\n${code}\nexport {};\n`,
    );
    // Blocks that elide arguments ("// ...") are partial by design.
    const elided = /^\s*(\/\/\s*)?\.\.\.\s*$|\/\*\s*\.\.\.\s*\*\/|^\s*\/\/\s*\.\.\./m.test(code);
    manifest.push({ id, file, page, line: i + 1, ext, title, lines: body.length, importsSdk, complete, elided });
    i = j;
  }
}
await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
console.log(
  `${manifest.length} TypeScript blocks from ${new Set(manifest.map((m) => m.page)).size} pages; ${manifest.filter((m) => m.importsSdk).length} import the SDK; ${manifest.filter((m) => m.complete).length} look complete`,
);
