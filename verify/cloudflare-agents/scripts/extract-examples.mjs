// Extract every TypeScript block from the mirrored Cloudflare Agents docs, plus the linked examples.
// - Markdown (agents repo) and MDX (cloudflare-docs) pages: every ts/typescript/tsx/js fence,
//   including those wrapped in <TypeScriptExample> or indented inside <Steps>.
// - Wrangler config blocks (jsonc/json/toml, often inside <WranglerConfig>) are not sources, but
//   their Durable Object bindings are recorded per page so the runner can bind the same names.
// - Linked examples (source/agents/examples/<name>/) are copied whole, so relative imports work;
//   each .ts file is a source and the wrangler "main" file is the runnable entry.
// Usage: node scripts/extract-examples.mjs [sourceDir] [outDir]
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const sourceDir = resolve(process.argv[2] ?? "../../docs/reference/cloudflare-agents/source");
const outDir = resolve(process.argv[3] ?? "extracted");
const LANGS = { ts: "ts", typescript: "ts", tsx: "tsx", js: "ts", javascript: "ts" };
const CONFIG = new Set(["jsonc", "json", "toml"]);
const SDK = /from\s+["'](agents|@cloudflare\/(think|ai-chat))(\/[\w/.-]+)?["']/;

/** Strip // and /* comments and trailing commas from JSONC, leaving strings alone. */
export function parseJsonc(text) {
  const noComments = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, s) => s ?? "");
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1"));
}

/** Durable Object bindings ({ name, className }) declared in a wrangler config block. */
export function doBindings(lang, text) {
  if (lang === "toml") {
    return [...text.matchAll(/\[\[durable_objects\.bindings\]\]([\s\S]*?)(?=\n\[|$)/g)]
      .map((m) => ({
        name: m[1].match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1],
        className: m[1].match(/^\s*class_name\s*=\s*"([^"]+)"/m)?.[1],
      }))
      .filter((b) => b.name && b.className);
  }
  try {
    const cfg = parseJsonc(text);
    return (cfg.durable_objects?.bindings ?? [])
      .map((b) => ({ name: b.name, className: b.class_name }))
      .filter((b) => b.name && b.className);
  } catch {
    // Fragments such as `"durable_objects": { … }` without the outer braces.
    return [
      ...text.matchAll(
        /"name"\s*:\s*"([^"]+)"[^}]*?"class_name"\s*:\s*"([^"]+)"|"class_name"\s*:\s*"([^"]+)"[^}]*?"name"\s*:\s*"([^"]+)"/g,
      ),
    ].map((m) => ({ name: m[1] ?? m[4], className: m[2] ?? m[3] }));
  }
}

const classify = (code) => {
  const importsSdk = SDK.test(code) || /from\s+["']cloudflare:workers["']/.test(code);
  // Runnable as a Worker module: it imports the SDK and exports a class or a default handler.
  const complete = importsSdk && /^export\s+(default\b|(abstract\s+)?class\s+\w+\s+extends\b)/m.test(code);
  const elided =
    /^\s*(\/\/\s*)?\.\.\.\s*$|\/\*\s*\.\.\.\s*\*\/|^\s*\/\/\s*\.\.\.|\{\s*\.\.\.\s*\}|\(\s*\.\.\.\s*\)|\/\/.*\bas before\b/m.test(
      code,
    );
  return { importsSdk, complete, elided };
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const all = (await readdir(sourceDir, { recursive: true })).sort();
const pages = all.filter((f) => /\.mdx?$/.test(f) && !f.startsWith("agents/examples/"));
const manifest = [];
const bindingsByPage = {};
for (const page of pages) {
  const lines = (await readFile(join(sourceDir, page), "utf8")).split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(\S*)\s*(.*)$/);
    if (!open) continue;
    const [, indent, fence, langRaw, info] = open;
    const lang = langRaw.toLowerCase();
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, "") === "") break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    const code = body.join("\n");
    const ext = LANGS[lang];
    if (CONFIG.has(lang)) {
      const b = doBindings(lang, code);
      if (b.length) bindingsByPage[page] = [...(bindingsByPage[page] ?? []), ...b];
    }
    if (ext) {
      n++;
      const slug = page
        .replace(/\.mdx?$/, "")
        .replace(/^cloudflare-docs\/src\/content\/docs\/agents\//, "cf__")
        .replace(/^agents\/docs\//, "repo__")
        .replace(/^agents\/packages\/([\w-]+)\/README$/, "repo__pkg-$1")
        .replace(/^agents\/README$/, "repo__README")
        .replace(/\//g, "__");
      const id = `${slug}__${String(n).padStart(2, "0")}`;
      const file = `${id}.${ext}`;
      const title = info.match(/title="([^"]+)"/)?.[1] ?? (info.trim() || null);
      await writeFile(
        join(outDir, file),
        `// source: ${page}:${i + 1}${title ? ` (${title})` : ""}\n${code}\nexport {};\n`,
      );
      manifest.push({ id, file, page, line: i + 1, ext, title, lines: body.length, ...classify(code) });
    }
    i = j;
  }
}
for (const m of manifest) m.bindings = bindingsByPage[m.page] ?? [];

// Linked examples: copy whole, one source per .ts file.
const exRoot = join(sourceDir, "agents/examples");
for (const name of (await readdir(exRoot).catch(() => [])).sort()) {
  const dir = join(exRoot, name);
  await cp(dir, join(outDir, "examples", name), { recursive: true });
  let cfg = {};
  try {
    cfg = parseJsonc(await readFile(join(dir, "wrangler.jsonc"), "utf8"));
  } catch {}
  const bindings = (cfg.durable_objects?.bindings ?? []).map((b) => ({ name: b.name, className: b.class_name }));
  const tsFiles = all.filter((f) => f.startsWith(`agents/examples/${name}/`) && /\.ts$/.test(f));
  for (const f of tsFiles) {
    const rel = f.slice(`agents/examples/${name}/`.length);
    const code = await readFile(join(sourceDir, f), "utf8");
    const entry = rel === (cfg.main ?? "src/server.ts");
    manifest.push({
      id: `example__${name}__${rel.replace(/\.ts$/, "").replace(/\//g, "__")}`,
      file: `examples/${name}/${rel}`,
      page: f,
      line: 1,
      ext: "ts",
      title: null,
      lines: code.split("\n").length,
      example: name,
      ...classify(code),
      // Only the wrangler entry runs; other files are type-checked through it and on their own.
      complete: entry,
      elided: false,
      bindings,
      compatibilityFlags: cfg.compatibility_flags ?? [],
      vars: cfg.vars ?? {},
      configBindings: Object.keys(cfg).filter((k) =>
        [
          "ai",
          "browser",
          "worker_loaders",
          "kv_namespaces",
          "r2_buckets",
          "d1_databases",
          "workflows",
          "queues",
          "vectorize",
          "services",
          "send_email",
          "containers",
          "images",
        ].includes(k),
      ),
    });
  }
}

await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const docsBlocks = manifest.filter((m) => !m.example);
console.log(
  `${docsBlocks.length} TypeScript blocks from ${new Set(docsBlocks.map((m) => m.page)).size} pages; ` +
    `${docsBlocks.filter((m) => m.importsSdk).length} import the SDK; ${docsBlocks.filter((m) => m.complete).length} look complete; ` +
    `${manifest.length - docsBlocks.length} example files from ${new Set(manifest.filter((m) => m.example).map((m) => m.example)).size} examples`,
);
