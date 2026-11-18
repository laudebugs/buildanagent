// Mirror Pi's docs from the git tag that matches the pinned npm release.
// docs.pi.dev/latest renders the repo's main branch, which can run ahead of npm,
// so the tag is the source that matches the code we install.
// Pi is MIT-licensed, so the mirror (with LICENSE) is committed.
// Usage: node scripts/fetch-docs.mjs [version]
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = process.argv[2] ?? pkg.dependencies["@earendil-works/pi-coding-agent"];
const tag = `v${version}`;
const out = resolve("../../docs/reference/pi/source");
const work = await mkdtemp(join(tmpdir(), "pi-docs-"));
const paths = [
  "/LICENSE",
  "/packages/coding-agent/docs/",
  "/packages/coding-agent/README.md",
  "/packages/agent/README.md",
  "/packages/ai/README.md",
  "/packages/coding-agent/examples/",
];

execFileSync(
  "git",
  [
    "clone",
    "-q",
    "--depth",
    "1",
    "--branch",
    tag,
    "--filter=blob:none",
    "--sparse",
    "https://github.com/earendil-works/pi",
    work,
  ],
  { stdio: "inherit" },
);
execFileSync("git", ["-C", work, "sparse-checkout", "set", "--no-cone", ...paths], { stdio: "inherit" });
const commit = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(work, "packages/coding-agent/docs"), join(out, "coding-agent"), { recursive: true });
await cp(join(work, "packages/coding-agent/README.md"), join(out, "coding-agent/README.md"));
await cp(join(work, "packages/coding-agent/examples"), join(out, "examples"), { recursive: true });
await rm(join(out, "examples/extensions/doom-overlay/doom/build"), { recursive: true, force: true }); // compiled wasm, not docs
await cp(join(work, "packages/agent/README.md"), join(out, "agent-core-README.md"));
await cp(join(work, "packages/ai/README.md"), join(out, "pi-ai-README.md"));
await cp(join(work, "LICENSE"), join(out, "LICENSE"));
await writeFile(
  join(out, "_manifest.json"),
  JSON.stringify(
    { repo: "https://github.com/earendil-works/pi", tag, commit, fetchedAt: new Date().toISOString(), paths },
    null,
    2,
  ),
);
await rm(work, { recursive: true, force: true });
console.log(`Pi docs ${tag} (${commit.slice(0, 7)}) -> ${out}`);
