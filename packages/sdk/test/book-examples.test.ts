// Runs each book example in examples/ (the numbered files, which the book's chapters list beside the third-party
// ones) as its own Node process, offline, and records its model exchange and checks as a transcript in
// results/transcripts/, which a chapter's replay shows. scripts/ci/results-drift.mjs fails when a run writes a
// transcript that differs from the committed one, so commit a changed transcript with the change that caused it.
//
// Each process gets an allowlisted environment, so no inherited credential reaches it, and examples/lib/check.ts
// installs the gateway's offline setup before anything else runs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
// @ts-expect-error: the transcript writer is plain JavaScript and ships no types.
import { transcriptRun } from "../../../scripts/transcripts/write.mjs";

const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
const EXAMPLES_DIR = join(PACKAGE_DIR, "examples");
const TSX = import.meta.resolve("tsx");
const SOURCE_CONDITION = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
/** How long one example may run before it is killed, shorter than the test's own 60-second limit. */
const EXAMPLE_TIMEOUT_MS = 45_000;

/** The book's examples: the numbered files, such as `01-one-call.ts`. The other files are imported modules. */
const BOOK_EXAMPLES = readdirSync(EXAMPLES_DIR)
  .filter((file) => /^\d{2}-[a-z0-9-]+\.ts$/.test(file))
  .sort();

/** Runs one example in a fresh temporary directory and returns its exit code and output. */
async function runExample(file: string): Promise<{ exit: number | null; out: string }> {
  const cwd = mkdtempSync(join(tmpdir(), "sdk-book-"));
  const home = mkdtempSync(join(tmpdir(), "sdk-book-home-"));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
  };
  const args = ["--import", TSX];
  const transcript = transcriptRun(args, env);
  args.push("--import", SOURCE_CONDITION, join(EXAMPLES_DIR, file));
  try {
    const result = await new Promise<{ exit: number | null; out: string }>((done) => {
      const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        out += chunk;
      });
      // An example that hangs is killed before the test's own time limit, so the cleanup below still runs.
      const timer = setTimeout(() => {
        out += `\nkilled after ${EXAMPLE_TIMEOUT_MS} ms`;
        child.kill("SIGKILL");
      }, EXAMPLE_TIMEOUT_MS);
      child.on("close", (exit) => {
        clearTimeout(timer);
        done({ exit, out });
      });
    });
    transcript.write({ harnessDir: PACKAGE_DIR, exampleFile: join(EXAMPLES_DIR, file), cwd });
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

test("the book's examples exist", () => {
  assert.ok(BOOK_EXAMPLES.length > 0, "no numbered example in examples/");
});

for (const file of BOOK_EXAMPLES) {
  // A process starts tsx and loads the packages from src/, which takes a few seconds under the parallel pnpm test.
  test(`the book example ${file} runs offline and its checks pass`, { timeout: 60_000 }, async () => {
    const { exit, out } = await runExample(file);
    assert.equal(exit, 0, out);
    assert.match(out, /^ok - /m, "the example ran no check");
  });
}
