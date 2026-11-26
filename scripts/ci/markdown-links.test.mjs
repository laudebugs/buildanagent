// Offline tests for markdown-links.mjs; run with `node --test scripts/ci/*.test.mjs`. Most tests check a small
// in-memory set of tracked files; the last ones run the script on a real (uncommitted) git repo in a temp directory,
// since `trackedFiles()` shells out to `git ls-files` rather than reading the filesystem directly (see the script's
// header comment for why: a gitignored path must fail here exactly as it will in CI).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkLinks, headingAnchorsAtEveryLevel, skipReason, trackedFiles } from "./markdown-links.mjs";

const script = fileURLToPath(new URL("./markdown-links.mjs", import.meta.url));

/** `files.set` for every path, `.md` ones from their text, everything else as a tracked, contentless path. */
function tree(entries) {
  const files = new Map();
  for (const [path, text] of Object.entries(entries)) files.set(path, path.endsWith(".md") ? text : null);
  return files;
}

const messages = (problems) => problems.map((p) => `${p.file}:${p.line}: ${p.message}`);

test("a link to a tracked file and a heading it has passes", () => {
  const files = tree({
    "a.md": "See [b](b.md#section-two).\n",
    "b.md": "# B\n\n## Section one\n\n## Section two\n",
  });
  assert.deepEqual(checkLinks(files), []);
});

test("a link to a file no one tracks fails, naming the file and the line", () => {
  const files = tree({ "a.md": "First line.\n\nSee [missing](missing.md).\n" });
  const problems = checkLinks(files);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, "a.md");
  assert.equal(problems[0].line, 3);
  assert.match(problems[0].message, /missing\.md/);
});

test("a link to a tracked file but a heading it lacks fails", () => {
  const files = tree({
    "a.md": "See [b](b.md#nope).\n",
    "b.md": "## Has\n",
  });
  assert.deepEqual(messages(checkLinks(files)), [`a.md:1: b.md#nope: no heading in b.md is "#nope"`]);
});

test("a repeated heading gets GitHub's -1, -2 anchors, at every level", () => {
  const files = tree({
    "a.md": "# Same\n\n#### Same\n\nLinks to [first](#same) and [second](#same-1).\n",
  });
  assert.deepEqual(checkLinks(files), []);
  assert.deepEqual(
    headingAnchorsAtEveryLevel(files.get("a.md")).map((h) => h.anchor),
    ["same", "same-1"],
  );
});

test("a link to a tracked directory passes, with or without a trailing slash", () => {
  const files = tree({
    "docs/a.md": "See [done](../done) and [done again](../done/).\n",
    "done/b.md": "# B\n",
  });
  assert.deepEqual(checkLinks(files), []);
});

test("a link into an untracked path fails exactly like a link to a missing file, whether gitignored or absent", () => {
  // docs/reference/claude-agent-sdk/source/ is real and gitignored; this fixture only needs an untracked target, which
  // behaves the same whether CI never had the file or the file never existed at all.
  const files = tree({
    "docs/reference/claude-agent-sdk/README.md": "See [the guide](source/guide.md).\n",
  });
  assert.deepEqual(messages(checkLinks(files)), [
    "docs/reference/claude-agent-sdk/README.md:1: source/guide.md: no tracked file or directory at " +
      "docs/reference/claude-agent-sdk/source/guide.md",
  ]);
});

test("a link inside a fenced code block is not read as a link", () => {
  const files = tree({
    "a.md": ["Write a listing like this:", "", "```markdown", "[missing](missing.md)", "```", ""].join("\n"),
  });
  assert.deepEqual(checkLinks(files), []);
});

test("a link inside an inline code span is not read as a link", () => {
  const files = tree({ "a.md": "Write `[missing](missing.md)` in your chapter.\n" });
  assert.deepEqual(checkLinks(files), []);
});

test("an external link, a mailto: link and a site-absolute path are not checked", () => {
  const files = tree({
    "a.md": "[a](https://example.com), [b](mailto:a@example.com), [c](//example.com/x), [d](/concepts/approvals/).\n",
  });
  assert.deepEqual(checkLinks(files), []);
});

test("a file under a skipped directory is not scanned for outgoing links, even a broken one", () => {
  const files = tree({ "apps/manual/src/content/chapters/one.md": "See [missing](missing.md).\n" });
  assert.deepEqual(checkLinks(files), []);
  assert.match(skipReason("apps/manual/src/content/chapters/one.md") ?? "", /site routes/);
  assert.equal(skipReason("docs/plans/ci.md"), undefined);
});

test("skipReason covers every rule this check relies on", () => {
  assert.match(skipReason("docs/reference/vercel-ai-sdk/source/README.md") ?? "", /vendored mirror/);
  assert.match(skipReason(".agents/skills/anatomy/SKILL.md") ?? "", /vendored skill/);
  assert.match(skipReason("apps/docs/src/content/docs/index.md") ?? "", /site routes/);
});

// --- A real, uncommitted git repo in a temp directory, for trackedFiles() and the CLI's exit code. ---

function gitRepo(entries) {
  const dir = mkdtempSync(join(tmpdir(), "markdown-links-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const [path, text] of Object.entries(entries)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  spawnSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

test("trackedFiles() lists what git add staged, not an untracked extra file", () => {
  const dir = gitRepo({ "a.md": "# A\n", "b.md": "# B\n" });
  try {
    writeFileSync(join(dir, "c.md"), "# C, never added\n");
    assert.deepEqual(trackedFiles(dir).sort(), ["a.md", "b.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the script exits 0 and reports a count when every link resolves", () => {
  const dir = gitRepo({ "a.md": "See [b](b.md#section).\n", "b.md": "## Section\n" });
  try {
    const result = spawnSync("node", [script], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /2 files checked, no problems/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the script exits non-zero and names the file and line on a broken link", () => {
  const dir = gitRepo({ "a.md": "First.\n\nSee [b](missing.md).\n" });
  try {
    const result = spawnSync("node", [script], { cwd: dir, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^a\.md:3: missing\.md/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
