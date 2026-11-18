// Extract every TypeScript source from the mirrored ADK docs and samples, TypeScript only.
//   - adk-docs pages: fences tagged typescript/ts/tsx/javascript/js (Python, Go, Java and Kotlin tabs use
//     their own fence languages, so they drop out). A fence whose body is only a `--8<--` include of a
//     TypeScript snippet file becomes a reference to that file; includes inside a larger fence are inlined.
//   - adk-docs examples/typescript: each snippet file whole, with the pages that include it.
//   - adk-js samples/ and dev/samples/ at main-v2.5.0: each agent file whole.
// A source that exports `rootAgent` but never runs it is marked `probe`, so the runner can drive it.
// Usage: node scripts/extract-examples.mjs [sourceDir] [outDir]
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const sourceDir = resolve(process.argv[2] ?? "../../docs/reference/google-adk/source");
const outDir = resolve(process.argv[3] ?? "extracted");
const DOCS = join(sourceDir, "adk-docs");
const LANGS = { ts: "ts", typescript: "ts", tsx: "tsx", js: "ts", javascript: "ts" };
const INCLUDE = /^\s*-{2}8<-{2}\s+"(examples\/typescript\/[^":]+)(?::([\w-]+))?"\s*$/;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const files = (root, re) => readdir(root, { recursive: true }).then((fs) => fs.filter((f) => re.test(f)).sort());
const section = (text, name) => {
  if (!name) return text;
  const m = text.match(new RegExp(`--8<-- \\[start:${name}\\]\\n([\\s\\S]*?)\\n.*--8<-- \\[end:${name}\\]`));
  return m ? m[1] : text;
};
const slugOf = (p) => p.replace(/\.(mdx?|ts)$/, "").replace(/[/.]/g, "__");

const describe = (code) => {
  const importsSdk = /from\s+["']@google\/adk(\/[\w/-]+)?["']/.test(code);
  const runs = /\.(runAsync|runEphemeral|runLive)\s*\(|\brunner\.run\s*\(/.test(code);
  const exportsRoot = /export\s+(const|let)\s+rootAgent\b|export\s*\{[^}]*\brootAgent\b/.test(code);
  const elided = /^\s*(\/\/\s*)?\.\.\.\s*$|\/\*\s*\.\.\.\s*\*\/|^\s*\/\/\s*\.\.\./m.test(code);
  return {
    importsSdk,
    complete: importsSdk && (runs || exportsRoot),
    probe: importsSdk && exportsRoot && !runs,
    elided,
  };
};

const manifest = [];
const snippetPages = {}; // snippet path -> [page:line, …]
const emit = async (entry, code) => {
  const file = `${entry.id}.${entry.ext}`;
  await writeFile(
    join(outDir, file),
    `// source: ${entry.source}\n${code}\n${/\bexport\b/.test(code) ? "" : "export {};\n"}`,
  );
  manifest.push({ ...entry, file, lines: code.split("\n").length, ...describe(code) });
};

// 1. Page fences.
for (const page of await files(join(DOCS, "docs"), /\.md$/)) {
  const lines = (await readFile(join(DOCS, "docs", page), "utf8")).split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,})(\S*)\s*(.*)$/);
    const ext = open && LANGS[open[3].toLowerCase()];
    if (!open) continue;
    const [, indent, fence] = open;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, "") === "") break;
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    const openLine = i + 1;
    const at = `docs/${page}:${openLine}`;
    i = j;
    if (!ext) continue;
    const includes = body.map((l) => l.match(INCLUDE)).filter(Boolean);
    const nonBlank = body.filter((l) => l.trim());
    if (includes.length && includes.length === nonBlank.length) {
      for (const [, path, name] of includes) {
        snippetPages[path] ??= [];
        snippetPages[path].push(`${at}${name ? ` [${name}]` : ""}`);
      }
      continue;
    }
    const resolved = [];
    for (const l of body) {
      const inc = l.match(INCLUDE);
      resolved.push(inc ? section(await readFile(join(DOCS, inc[1]), "utf8"), inc[2]) : l);
    }
    n++;
    const title = open[4].match(/title="([^"]+)"/)?.[1] ?? null;
    await emit(
      {
        id: `docs__${slugOf(page)}__${String(n).padStart(2, "0")}`,
        kind: "block",
        page: `docs/${page}`,
        line: openLine,
        source: at,
        ext,
        title,
      },
      resolved.join("\n"),
    );
  }
}

// 2. Snippet files, whole.
for (const f of await files(join(DOCS, "examples/typescript"), /\.tsx?$/)) {
  const path = `examples/typescript/${f}`;
  await emit(
    {
      id: `snippet__${slugOf(f)}`,
      kind: "snippet",
      page: path,
      line: 1,
      source: `adk-docs/${path}`,
      ext: "ts",
      pages: snippetPages[path] ?? [],
    },
    await readFile(join(DOCS, path), "utf8"),
  );
}
const unresolved = Object.keys(snippetPages).filter((p) => !manifest.some((m) => m.page === p));

// 3. adk-js samples, whole.
const JS = join(sourceDir, "adk-js");
for (const sub of ["samples", "dev/samples"]) {
  for (const f of await files(join(JS, sub), /\.ts$/)) {
    const path = `${sub}/${f}`;
    await emit(
      {
        id: `js__${slugOf(path)}`,
        kind: "sample",
        page: `adk-js/${path}`,
        line: 1,
        source: `adk-js/${path}`,
        ext: "ts",
      },
      await readFile(join(JS, path), "utf8"),
    );
  }
}

// Data files the samples read next to themselves (transcripts, specs, retrieval corpora), at the same
// relative paths, so `join(dirname(import.meta.url), "transcript.json")` still resolves.
const assets = [];
for (const sub of ["samples", "dev/samples"]) {
  const sampleDirs = (await files(join(JS, sub), /\.ts$/)).map((f) => dirname(f));
  for (const f of (await files(join(JS, sub), /\.(json|ya?ml|txt)$/)).filter(
    (f) => !/(^|\/)(tsconfig|package)\.json$/.test(f),
  )) {
    const home = sampleDirs.filter((d) => f.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0];
    const name = home ? f.slice(home.length + 1) : f;
    await mkdir(join(outDir, dirname(name)), { recursive: true });
    await writeFile(join(outDir, name), await readFile(join(JS, sub, f)));
    assets.push(name);
  }
}

await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const by = (k) => manifest.filter((m) => m.kind === k).length;
console.log(
  `${manifest.length} TypeScript sources: ${by("block")} page blocks, ${by("snippet")} snippet files, ${by("sample")} adk-js samples; ` +
    `${manifest.filter((m) => m.importsSdk).length} import @google/adk; ${manifest.filter((m) => m.complete).length} look complete ` +
    `(${manifest.filter((m) => m.probe).length} export rootAgent without running it)` +
    `; ${assets.length} sample data files` +
    (unresolved.length ? `\nunresolved includes: ${unresolved.join(", ")}` : ""),
);
