// Mirror the GitHub Copilot SDK docs from the MIT-licensed github/copilot-sdk repo at the release tag.
// The npm package's repository field names github/copilot-agent-runtime, which is not public (as of
// November 2026); github/copilot-sdk is the public snapshot, tagged v<version> for each release.
// Copied: the license, the root README, docs/, the Node.js README, docs and examples, the TS/JS
// samples, and the other languages' READMEs (for the TS parity check). Compiled assets are skipped.
// Usage: node scripts/fetch-docs.mjs
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = "https://github.com/github/copilot-sdk.git";
const TAG = "v1.0.31"; // matches @github/copilot-sdk@1.0.31 in package.json
const OUT = resolve("../../docs/reference/copilot-sdk/source");
const KEEP = [
  /^LICENSE$/,
  /^README\.md$/,
  /^docs\/.+\.md$/,
  /^nodejs\/README\.md$/,
  /^nodejs\/docs\/.+\.md$/,
  /^nodejs\/examples\/.+\.(ts|mts|mjs)$/,
  /^samples\/.+\.(md|ts|mts|mjs|json)$/,
  /^(python|go|dotnet|java|rust)\/README\.md$/,
];

const tmp = await mkdtemp(join(tmpdir(), "copilot-docs-"));
// git runs with a minimal environment: no host credentials are needed for a public clone.
const env = { PATH: process.env.PATH, HOME: tmp, LANG: "C.UTF-8", GIT_LFS_SKIP_SMUDGE: "1" };
for (const k of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE"])
  if (process.env[k]) env[k] = process.env[k];
const git = (...args) => execFileSync("git", args, { cwd: tmp, env, stdio: ["ignore", "pipe", "inherit"] }).toString();
try {
  git("init", "-q");
  git("remote", "add", "origin", REPO);
  git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", `refs/tags/${TAG}:refs/tags/${TAG}`);
  git("checkout", "-q", TAG);
  const commit = git("rev-parse", "HEAD").trim();
  const committedAt = git("log", "-1", "--format=%cI").trim();
  const files = git("ls-files")
    .split("\n")
    .filter((f) => KEEP.some((re) => re.test(f)))
    .sort();

  await rm(OUT, { recursive: true, force: true });
  for (const f of files) {
    await mkdir(dirname(join(OUT, f)), { recursive: true });
    await cp(join(tmp, f), join(OUT, f));
  }
  const pkg = JSON.parse(await readFile(join(tmp, "nodejs/package.json"), "utf8"));
  const manifest = {
    repo: REPO.replace(/\.git$/, ""),
    tag: TAG,
    commit,
    committedAt,
    fetchedAt: new Date().toISOString(),
    copilotCliVersion: pkg.copilotCliVersion,
    note: "The npm tarball's README.md adds 17 lines on release packaging that nodejs/README.md at the tag lacks; its docs/*.md match nodejs/docs/ byte for byte.",
    files,
  };
  await writeFile(join(OUT, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`mirrored ${files.length} files from ${TAG} (${commit.slice(0, 7)}, ${committedAt})`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
