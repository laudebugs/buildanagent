import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "vitest";
import { loadBook } from "../src/book/load.js";
import { chapterSwitches, formatSwitches } from "../src/book/switch-report.js";
import { edit, fixtureInputs, mutatedFixture, removeFixture } from "./book-fixture.js";

// The fixture repository holds one done todo, B11. The first chapter waits on B11 and the second on B12.

test("the switch report lists each chapter's switchTo todos and which are done", () => {
  const switches = chapterSwitches(loadBook(fixtureInputs()));
  assert.deepEqual(switches, [
    { slug: "first", number: 1, switchTo: ["B11"], done: ["B11"] },
    { slug: "second", number: 2, switchTo: ["B12"], done: [] },
  ]);
  assert.deepEqual(formatSwitches(switches), [
    "Chapter 1 (first): B11 done; ready for tabs on our own packages.",
    "Chapter 2 (second): B12 not done; its verify/ listings wait for our own packages.",
  ]);
});

test("the switch report says so when no chapter is written or a chapter waits on nothing", () => {
  assert.deepEqual(formatSwitches([]), ["No chapter is written yet, so no chapter has listings that could gain tabs."]);
  assert.deepEqual(formatSwitches([{ slug: "tools", number: 3, switchTo: [], done: [] }]), [
    "Chapter 3 (tools): lists no switchTo todos.",
  ]);
});

// The script runs in a child process under tsx, which compiles it and then loads the whole real book, about 3 seconds on
// an idle machine. CI runs every package's tests at once, which pushed it past Vitest's 5-second default, so the test
// gets a longer limit.
test("book:switch-report runs on the real book and exits 0", { timeout: 60_000 }, async () => {
  const app = fileURLToPath(new URL("..", import.meta.url));
  const tsx = fileURLToPath(import.meta.resolve("tsx/cli"));
  const { stdout } = await promisify(execFile)(process.execPath, [tsx, "scripts/switch-report.ts"], {
    cwd: app,
    env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), TMPDIR: tmpdir(), LANG: "C.UTF-8" },
  });
  assert.match(stdout, /^book:switch-report: which chapters can add our own packages' listings as tabs\n/);
});

test("a chapter whose front matter fails the schema is reported, not read loosely", () => {
  const dir = mutatedFixture((copy) =>
    edit(copy, "chapters/second.md", (text) => text.replace("switchTo: [B12]", "switchTo: [loop-core]")),
  );
  try {
    const switches = chapterSwitches(loadBook(fixtureInputs(dir)));
    assert.deepEqual(switches[1], { slug: "second", number: 2, switchTo: [], done: [], invalid: true });
    assert.deepEqual(
      formatSwitches(switches).at(1),
      ["Chapter 2 (second): its front matter fails the schema, so its switchTo cannot be read; run check:book."][0],
    );
  } finally {
    removeFixture(dir);
  }
});
