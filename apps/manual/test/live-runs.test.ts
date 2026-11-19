import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";
import { readableDate, verificationLine } from "../src/book/live-runs.js";
import { loadBook } from "../src/book/load.js";
import { MOCK_ONLY } from "../src/components/listing-html.js";
import {
  edit,
  fixtureInputs,
  mutatedFixture,
  removeFixture,
  renderLikeAstro,
  withInteractive,
} from "./book-fixture.js";

// The live run's marks on the book (book plan BK18): the page line with the last comparison's date, and the caption
// of a listing the live run leaves out. The build test checks the same marks on a built page.

const app = fileURLToPath(new URL("../", import.meta.url));
// The interactive listings add files the fixture's live list leaves out.
const dir = mutatedFixture(withInteractive);
afterAll(() => removeFixture(dir));

test("the page line gives the last comparison's date, or says that none has run", () => {
  assert.equal(
    verificationLine(null),
    "Listings on this page are verified against mock models; not yet compared with live APIs.",
  );
  assert.equal(
    verificationLine("2026-12-01"),
    "Listings on this page are verified against mock models; last compared with live APIs on 1 December 2026.",
  );
  assert.equal(readableDate("2027-01-09"), "9 January 2027");
});

test("the book reads the live list and the date, and refuses a date that is not YYYY-MM-DD", () => {
  const book = loadBook(fixtureInputs(dir));
  assert.deepEqual([...book.live.compared], ["verify/demo-sdk/examples/01-hello.ts"]);
  assert.equal(book.live.lastCompared, "2026-12-01");
  const bad = mutatedFixture((copy) => edit(copy, "live-comparison.json", () => '{ "lastCompared": "soon" }'));
  assert.throws(() => loadBook(fixtureInputs(bad)), /live-comparison\.json: lastCompared must be a YYYY-MM-DD date/);
  removeFixture(bad);
});

test("a listing of a file the live run compares has no mock-only caption, and any other listing has one", async () => {
  const book = loadBook(fixtureInputs(dir));
  const html = await renderLikeAstro(book, "second");
  const figures = [...html.matchAll(/<figure id="lst-[^"]+"[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  const listed = (figure: string) => figure.includes('listing__path">verify/demo-sdk/examples/01-hello.ts<');
  const compared = figures.filter(listed);
  const others = figures.filter((figure) => figure.includes("listing__path") && !listed(figure));
  assert.equal(compared.length, 2, "the chapter's greeting and the demo-sdk tab");
  assert.equal(others.length, 2, "the noted listing and the other-sdk tab");
  for (const figure of compared) assert.ok(!figure.includes(MOCK_ONLY));
  for (const figure of others) assert.ok(figure.includes(`<span class="listing__verified">${MOCK_ONLY}</span>`));
});

test("the book's live list covers no google-adk example, so every google-adk listing is mock-only", () => {
  const list = JSON.parse(readFileSync(join(app, "src/data/live-examples.json"), "utf8"));
  const files: string[] = list.examples.map((example: { file: string }) => example.file);
  assert.ok(files.length > 0);
  assert.ok(files.every((file) => !file.startsWith("verify/google-adk/")));
  const comparison = JSON.parse(readFileSync(join(app, "src/data/live-comparison.json"), "utf8"));
  assert.ok(comparison.lastCompared === null || /^\d{4}-\d{2}-\d{2}$/.test(comparison.lastCompared));
});
