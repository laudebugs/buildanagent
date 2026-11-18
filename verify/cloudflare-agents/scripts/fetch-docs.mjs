// Mirror the Cloudflare Agents docs from two sources:
//   1. github.com/cloudflare/agents (MIT) at the release tags of the pinned packages: docs/agents
//      and the root README from agents@0.33.0, docs/think from @cloudflare/think@0.23.0, the
//      package READMEs from their own tags, and the server-side sources (src/**/*.ts, no .tsx)
//      plus wrangler config of every example the docs link to.
//   2. github.com/cloudflare/cloudflare-docs (content CC-BY-4.0, code MIT), the source of
//      developers.cloudflare.com/agents/, at a recorded commit of its production branch. That site
//      renders a branch, not a release, so its pages may run ahead of the pinned packages.
// Records repos, tags, commits and the fetch date in source/_manifest.json.
// Usage: node scripts/fetch-docs.mjs
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const OUT = resolve("../../docs/reference/cloudflare-agents/source");
const AGENTS_REPO = "https://github.com/cloudflare/agents.git";
const DOCS_REPO = "https://github.com/cloudflare/cloudflare-docs.git";
const DOCS_COMMIT = "6897a9fa0c115280ad9cea7b3a7fab9580258083"; // production on 2026-11-18

// Paths copied from the agents repo, per release tag. Each tag's files land under agents/.
const AGENTS_TAGS = [
  {
    tag: "agents@0.33.0",
    paths: ["LICENSE", "README.md", "docs/index.md", "docs/agents/", "packages/agents/README.md"],
  },
  { tag: "@cloudflare/think@0.23.0", paths: ["docs/think/", "packages/think/README.md"] },
  { tag: "@cloudflare/ai-chat@0.12.2", paths: ["packages/ai-chat/README.md"] },
];
// Linked examples that are voice, payments, Next.js or React-only apps are outside the S6 scope.
const SKIP_EXAMPLES = new Set([
  "next",
  "playground",
  "voice-agent",
  "voice-input",
  "plivo-voice-agent",
  "telnyx-voice-agent",
  "vue-chat",
  "x402",
  "x402-mcp",
  "codemode-browser",
]);

const run = (cwd, ...args) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64e6 }).toString();
const copy = async (from, to) => {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
};
const files = async (dir) =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)));

async function sparse(repo, ref, patterns) {
  const dir = await mkdtemp(join(tmpdir(), "cf-docs-"));
  run(dir, "init", "-q");
  run(dir, "remote", "add", "origin", repo);
  run(dir, "sparse-checkout", "set", "--no-cone", ...patterns);
  run(dir, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", ref);
  run(dir, "checkout", "-q", "FETCH_HEAD");
  return {
    dir,
    commit: run(dir, "rev-parse", "HEAD").trim(),
    committedAt: run(dir, "log", "-1", "--format=%cI").trim(),
  };
}

await rm(OUT, { recursive: true, force: true });
const manifest = { fetchedAt: new Date().toISOString(), sources: [] };
const temps = [];
try {
  // 1. The agents repo, one sparse checkout per tag.
  const linked = new Set();
  for (const { tag, paths } of AGENTS_TAGS) {
    const repo = await sparse(
      AGENTS_REPO,
      `refs/tags/${tag}`,
      paths.map((p) => `/${p}`),
    );
    temps.push(repo.dir);
    for (const p of paths) await copy(join(repo.dir, p), join(OUT, "agents", p));
    manifest.sources.push({
      repo: AGENTS_REPO.replace(/\.git$/, ""),
      tag,
      commit: repo.commit,
      committedAt: repo.committedAt,
      paths,
    });
  }

  // 2. cloudflare-docs: the agents section, its partials and both licenses.
  const docsPaths = ["LICENSE", "LICENSE-CODE", "src/content/docs/agents/", "src/content/partials/agents/"];
  const docs = await sparse(
    DOCS_REPO,
    DOCS_COMMIT,
    docsPaths.map((p) => `/${p}`),
  );
  temps.push(docs.dir);
  for (const p of docsPaths) await copy(join(docs.dir, p), join(OUT, "cloudflare-docs", p));
  // CC-BY-4.0 asks for attribution and a note of changes; the copy is verbatim, only a subset.
  await writeFile(
    join(OUT, "cloudflare-docs", "ATTRIBUTION.md"),
    `# Attribution\n\nThese files are an unmodified subset (the Agents section and its partials) of the Cloudflare\n` +
      `Developer Documentation, https://github.com/cloudflare/cloudflare-docs, commit ${DOCS_COMMIT}\n` +
      `(${docs.committedAt}). © Cloudflare, Inc. and contributors. Content is licensed under CC-BY-4.0\n` +
      `(LICENSE) and code under the MIT License (LICENSE-CODE). Mirrored by verify/cloudflare-agents/scripts/fetch-docs.mjs.\n`,
  );
  manifest.sources.push({
    repo: DOCS_REPO.replace(/\.git$/, ""),
    branch: "production",
    commit: DOCS_COMMIT,
    committedAt: docs.committedAt,
    paths: docsPaths,
    license: "Content CC-BY-4.0 (LICENSE), code MIT (LICENSE-CODE). © Cloudflare, Inc. and contributors.",
    note: "Renders developers.cloudflare.com/agents/ from a branch, not a release tag; pages may run ahead of agents@0.33.0.",
  });

  // 3. Examples the mirrored docs link to, from the agents@0.33.0 tag (server-side sources only).
  for (const f of await files(OUT)) {
    if (!/\.mdx?$/.test(f)) continue;
    const text = await readFile(join(OUT, f), "utf8");
    for (const m of text.matchAll(
      /(?:github\.com\/cloudflare\/agents\/(?:tree|blob)\/main\/|\.\.\/)+examples\/([a-z0-9-]+)/g,
    ))
      linked.add(m[1]);
  }
  const wanted = [...linked].filter((e) => !SKIP_EXAMPLES.has(e)).sort();
  const ex = await sparse(
    AGENTS_REPO,
    "refs/tags/agents@0.33.0",
    wanted.flatMap((e) => [`/examples/${e}/src/`, `/examples/${e}/wrangler.jsonc`, `/examples/${e}/README.md`]),
  );
  temps.push(ex.dir);
  const examples = { present: [], missingAtTag: [], skipped: [...linked].filter((e) => SKIP_EXAMPLES.has(e)).sort() };
  for (const e of wanted) {
    let srcFiles = [];
    try {
      srcFiles = (await files(join(ex.dir, "examples", e))).filter(
        (f) =>
          /^(README\.md|wrangler\.jsonc)$/.test(f) ||
          (/\.ts$/.test(f) && !/\.(test|spec|d)\.ts$|(^|\/)tests?\//.test(f)),
      );
    } catch {
      examples.missingAtTag.push(e);
      continue;
    }
    if (!srcFiles.some((f) => f.endsWith(".ts"))) {
      examples.missingAtTag.push(e);
      continue;
    }
    for (const f of srcFiles) await copy(join(ex.dir, "examples", e, f), join(OUT, "agents/examples", e, f));
    examples.present.push(e);
  }
  manifest.examples = examples;
  await writeFile(join(OUT, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const all = await files(OUT);
  console.log(
    `mirrored ${all.filter((f) => /\.mdx?$/.test(f)).length} pages and ${examples.present.length} examples ` +
      `(${examples.missingAtTag.length} linked but missing at the tag: ${examples.missingAtTag.join(", ") || "none"})`,
  );
} finally {
  for (const t of temps) await rm(t, { recursive: true, force: true });
}
