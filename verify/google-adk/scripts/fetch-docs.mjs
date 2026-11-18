// Mirror the Google ADK docs and the TypeScript samples. Both repos are Apache-2.0, so the mirror is committed.
//   - google/adk-docs (renders google.github.io/adk-docs from main; no release tags): every Markdown page
//     under docs/ plus the TypeScript snippet files the pages include with `--8<--`, at a pinned commit.
//     Pages mix Python, TypeScript, Go, Java and Kotlin tabs; the extractor keeps only TypeScript. The
//     Python-only pages are mirrored too, because their "Supported in ADK" tags are the parity evidence.
//   - google/adk-js at tag main-v2.5.0 (the gitHead of @google/adk@2.5.0): samples/, dev/samples/,
//     docs/ (the repo's own guides), the READMEs, core/CHANGELOG.md and the license.
// Usage: node scripts/fetch-docs.mjs
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DOCS_REPO = "https://github.com/google/adk-docs.git";
const DOCS_COMMIT = "ff7a5f56469a81f3e43a8fc54668d8dc84300192"; // main on 2026-11-18 (committed 2026-11-17)
const JS_REPO = "https://github.com/google/adk-js.git";
const JS_TAG = "main-v2.5.0"; // b1b94c0d, the gitHead npm records for @google/adk@2.5.0
const OUT = resolve("../../docs/reference/google-adk/source");
// Text files only: no images, binaries or archives.
const TEXT = /\.(md|ts|mts|mjs|js|json|ya?ml|txt)$/;

const tmp = await mkdtemp(join(tmpdir(), "adk-docs-"));
const clone = async (name, repo, ref, paths) => {
  const dir = join(tmp, name);
  await mkdir(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "inherit"] }).toString();
  git("init", "-q");
  git("remote", "add", "origin", repo);
  git("sparse-checkout", "set", "--no-cone", ...paths);
  git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", ref);
  git("checkout", "-q", "FETCH_HEAD");
  return { dir, commit: git("rev-parse", "HEAD").trim(), committedAt: git("log", "-1", "--format=%cI").trim() };
};
const walk = async (root, sub) =>
  (await readdir(join(root, sub), { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile() && TEXT.test(d.name))
    .map((d) => join(d.parentPath ?? d.path, d.name).slice(root.length + 1))
    .sort();
const copy = async (from, to, files) => {
  for (const f of files) {
    await mkdir(dirname(join(to, f)), { recursive: true });
    await cp(join(from, f), join(to, f));
  }
};

try {
  const docs = await clone("adk-docs", DOCS_REPO, DOCS_COMMIT, ["/LICENSE", "/docs/**/*.md", "/examples/typescript/"]);
  const js = await clone("adk-js", JS_REPO, `refs/tags/${JS_TAG}`, [
    "/LICENSE",
    "/README.md",
    "/core/README.md",
    "/core/CHANGELOG.md",
    "/docs/",
    "/samples/",
    "/dev/samples/",
  ]);
  await rm(OUT, { recursive: true, force: true });

  const pages = (await walk(docs.dir, "docs")).filter((f) => f.endsWith(".md"));
  const snippets = await walk(docs.dir, "examples/typescript");
  // A page is a TypeScript page when it has a TypeScript fence, tab or snippet include.
  const tsPages = [];
  for (const p of pages) {
    const text = await readFile(join(docs.dir, p), "utf8");
    if (/```(typescript|ts|tsx|javascript|js)\b|=== "TypeScript|examples\/typescript\//.test(text)) tsPages.push(p);
  }
  await copy(docs.dir, join(OUT, "adk-docs"), ["LICENSE", ...pages, ...snippets]);

  const jsFiles = [
    "LICENSE",
    "README.md",
    "core/README.md",
    "core/CHANGELOG.md",
    ...(await walk(js.dir, "docs")),
    ...(await walk(js.dir, "samples")),
    ...(await walk(js.dir, "dev/samples")),
  ];
  await copy(js.dir, join(OUT, "adk-js"), jsFiles);

  const manifest = {
    fetchedAt: new Date().toISOString(),
    "adk-docs": {
      repo: DOCS_REPO.replace(/\.git$/, ""),
      site: "https://google.github.io/adk-docs/",
      commit: docs.commit,
      committedAt: docs.committedAt,
      license: "Apache-2.0",
      note: "No docs tag matches @google/adk releases; the site renders main, so pages may describe releases after 2.5.0.",
      pages: pages.length,
      typescriptPages: tsPages,
      snippets,
    },
    "adk-js": {
      repo: JS_REPO.replace(/\.git$/, ""),
      tag: JS_TAG,
      commit: js.commit,
      committedAt: js.committedAt,
      license: "Apache-2.0",
      files: jsFiles,
    },
  };
  await writeFile(join(OUT, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `adk-docs ${docs.commit.slice(0, 7)}: ${pages.length} pages (${tsPages.length} with TypeScript), ${snippets.length} snippet files; adk-js ${JS_TAG} (${js.commit.slice(0, 7)}): ${jsFiles.length} files`,
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}
