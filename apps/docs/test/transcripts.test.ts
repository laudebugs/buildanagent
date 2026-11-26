import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { exampleSource, isTranscript, parseExampleRef, REPO_ROOT } from "../src/plugins/example-code.js";
import { readPages } from "../src/plugins/pages.js";
import { isTypedSession, namesTranscript } from "./typed-session.js";

// A terminal session on a docs page comes from a transcript that a test in the package re-runs (for the CLI,
// packages/cli/test/transcripts.test.ts), so the page never shows output that the command no longer prints. A session
// someone typed by hand has no such check, and these tests refuse it.

const fences = readPages().flatMap((page) => page.fences.map((fence) => ({ page: page.path, fence })));

test("no page shows a console fence or a `$ ` shell block that names no transcript", () => {
  const typed = fences.filter(({ fence }) => isTypedSession(fence)).map(({ page, fence }) => `${page}:${fence.line}`);
  assert.deepEqual(
    typed,
    [],
    'show a terminal session with ```console file="packages/<pkg>/transcripts/<name>.txt", a transcript that a test re-runs',
  );
});

test("a transcript fence is a console fence, and its file starts with the command after a prompt", () => {
  const shown = fences.filter(({ fence }) => namesTranscript(fence));
  assert.ok(shown.length > 0, "the pages show at least one transcript, so the rule is not vacuous");
  for (const { page, fence } of shown) {
    assert.equal(fence.lang, "console", `${page}:${fence.line} shows a transcript in a ${fence.lang} fence`);
    const ref = parseExampleRef(fence.meta);
    assert.ok(ref !== undefined && exampleSource(ref).startsWith("$ "), `${page}:${fence.line} has no prompt`);
  }
});

test("every committed transcript is shown on some page, so none is left behind", () => {
  const shown = new Set(fences.flatMap(({ fence }) => parseExampleRef(fence.meta)?.file ?? []));
  const committed = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "transcripts")))
    .flatMap((entry) =>
      readdirSync(join(REPO_ROOT, "packages", entry.name, "transcripts"), { withFileTypes: true }).map(
        (file) => `packages/${entry.name}/transcripts/${file.name}`,
      ),
    );
  assert.ok(committed.length > 0);
  for (const file of committed) assert.ok(isTranscript(file) && shown.has(file), `${file} is on no page`);
});

test("the rule finds a typed session however it is written, and spares an install line and a transcript", () => {
  const session = (lang: string, code: string, meta = "") => ({ lang, meta, code });
  for (const fence of [
    session("console", "buildanagent --help"),
    session("Console", "output only"),
    session("bash", "$ buildanagent --help\nUsage: buildanagent"),
    session("sh", "  $ pnpm add x"),
    session("", "$ buildanagent sessions list"),
    session("text", "ok\n$ buildanagent run"),
    session("console", "$ x", 'title="a.txt"'),
    session("console", "$ x", 'file="packages/cli/examples/run-json.ts"'),
  ]) {
    assert.ok(isTypedSession(fence), JSON.stringify(fence));
  }
  for (const fence of [
    session("bash", "pnpm add @buildanagent/cli@alpha"),
    session("bash", "echo $HOME"),
    session("json", "$ not a prompt"),
    session("console", "$ x", 'file="packages/cli/transcripts/help.txt"'),
  ]) {
    assert.ok(!isTypedSession(fence), JSON.stringify(fence));
  }
});
