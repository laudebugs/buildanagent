// Mirror the Claude Agent SDK docs (code.claude.com) as Markdown.
// Output is gitignored: the docs are (c) Anthropic and not openly licensed.
// Usage: node scripts/fetch-docs.mjs [outDir]
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const INDEX = "https://code.claude.com/docs/llms.txt";
const PREFIX = "https://code.claude.com/docs/en/agent-sdk/";
const outDir = resolve(process.argv[2] ?? "../../docs/reference/claude-agent-sdk/source");

const index = await (await fetch(INDEX)).text();
const urls = [...new Set(index.match(/https:\/\/code\.claude\.com\/docs\/en\/agent-sdk\/[\w.-]+\.md/g) ?? [])].sort();
if (urls.length === 0) throw new Error("No agent-sdk pages found in llms.txt");

await mkdir(outDir, { recursive: true });
const fetchedAt = new Date().toISOString();
const manifest = [];
for (const url of urls) {
  const res = await fetch(url);
  if (!res.ok) { manifest.push({ url, status: res.status }); console.error(`FAIL ${res.status} ${url}`); continue; }
  const body = await res.text();
  const file = url.slice(PREFIX.length);
  await writeFile(join(outDir, file), `<!-- source: ${url} | fetched: ${fetchedAt} -->\n\n${body}`);
  manifest.push({ url, file, status: res.status, bytes: body.length });
  console.log(`ok ${file} (${body.length} bytes)`);
}
await writeFile(join(outDir, "_manifest.json"), JSON.stringify({ index: INDEX, fetchedAt, pages: manifest }, null, 2));
console.log(`${manifest.filter(p => p.file).length}/${urls.length} pages -> ${outDir}`);
