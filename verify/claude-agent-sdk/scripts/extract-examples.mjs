// Extract every TypeScript code block from the mirrored docs into one file per block.
// Usage: node scripts/extract-examples.mjs [sourceDir] [outDir]
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const sourceDir = resolve(process.argv[2] ?? "../../docs/reference/claude-agent-sdk/source");
const outDir = resolve(process.argv[3] ?? "extracted");
const LANGS = new Set(["typescript", "ts", "tsx"]);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const manifest = [];
for (const page of (await readdir(sourceDir)).filter((f) => f.endsWith(".md")).sort()) {
  const lines = (await readFile(join(sourceDir, page), "utf8")).split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(\S*)\s*(.*)$/);
    if (!open || !LANGS.has(open[3].toLowerCase())) continue;
    const [, indent, fence, lang, info] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, "") === "") break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    n++;
    const code = body.join("\n");
    const id = `${page.replace(/\.md$/, "")}__${String(n).padStart(2, "0")}`;
    const title = (info.match(/title="([^"]+)"/)?.[1] ?? info.replace(/theme=\{null\}/, "").trim()) || null;
    const importsSdk = /from\s+["']@anthropic-ai\/claude-agent-sdk(\/[\w-]+)?["']/.test(code);
    // A block is "complete" if it imports the SDK and calls query()/a session API, i.e. could run as-is.
    const complete = importsSdk && /\b(query|unstable_v2_\w+|startup|tool|createSdkMcpServer)\s*\(/.test(code);
    await writeFile(
      join(outDir, `${id}.ts`),
      `// source: ${page}:${i + 1}${title ? ` (${title})` : ""}\n${code}\nexport {};\n`,
    );
    manifest.push({ id, page, line: i + 1, lang, title, lines: body.length, importsSdk, complete });
    i = j;
  }
}
await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const c = manifest.filter((m) => m.complete).length;
console.log(`${manifest.length} TypeScript blocks from ${new Set(manifest.map((m) => m.page)).size} pages; ${manifest.filter((m) => m.importsSdk).length} import the SDK; ${c} look complete`);
