import assert from "node:assert/strict";
import { test } from "vitest";
import { CITE_LIKE } from "../src/book/citations.js";
import { loadBook, renderDependencies } from "../src/book/load.js";
import { isFactCheckLog, normalizeUrl, urlsIn } from "../src/book/sources.js";
import { REF_LIKE } from "../src/markdown/rehype-numbering.js";
import {
  edit,
  FIXTURE_OUTLINE,
  fixtureInputs,
  mutatedFixture,
  removeFixture,
  renderLikeAstro,
} from "./book-fixture.js";

// The fixture book's two chapters use every feature the content model renders. These tests read the HTML the build's
// pipeline makes from them; check-book.test.ts holds one failing fixture per rule.

const book = loadBook(fixtureInputs());
const first = await renderLikeAstro(book, "first");
const second = await renderLikeAstro(book, "second");

test("figures, tables and listings are numbered from the chapter's place in the outline", () => {
  assert.match(
    first,
    /<figure id="fig-ticket-rail"[^>]*>[\s\S]*<figcaption><span class="number">Figure 1\.1<\/span> The ticket rail<\/figcaption><\/figure>/,
  );
  assert.match(first, /<figcaption><span class="number">Table 1\.1<\/span> How the loop stops<\/figcaption><table>/);
  assert.match(second, /<figcaption><span class="number">Listing 2\.1<\/span> Saying hello<\/figcaption><pre/);
});

test("references become numbered links, within a chapter and across chapters", () => {
  assert.match(first, /<a href="\/first\/#fig-ticket-rail" class="xref">Figure 1\.1<\/a>/);
  assert.match(first, /<a href="\/first\/#tbl-stop-reasons" class="xref">Table 1\.1<\/a>/);
  assert.match(
    first,
    /<a href="\/second\/#lst-hello" class="xref">Listing 2\.1<\/a> in <a href="\/second\/" class="xref">Chapter 2<\/a>/,
  );
  assert.match(second, /Back to <a href="\/first\/#fig-ticket-rail" class="xref">Figure 1\.1<\/a>/);
});

test("a reference to a planned chapter shows its number without a link", () => {
  assert.match(first, /; Chapter 3 is not written yet\./);
});

test("moving a chapter in the outline renumbers its blocks and every reference to them, with no other edit", async () => {
  const [partA, partB] = FIXTURE_OUTLINE;
  const [one, two] = partA?.chapters ?? [];
  const [three] = partB?.chapters ?? [];
  assert.ok(partA && partB && one && two && three);
  // The planned third chapter moves to the front and `second` to Part B, so `first` becomes 2 and `second` 3.
  const moved = loadBook(
    fixtureInputs(undefined, [
      { ...partA, chapters: [three, one] },
      { ...partB, chapters: [two] },
    ]),
  );
  const movedFirst = await renderLikeAstro(moved, "first");
  const movedSecond = await renderLikeAstro(moved, "second");
  assert.match(movedFirst, /<span class="number">Figure 2\.1<\/span> The ticket rail/);
  assert.match(movedFirst, /<span class="number">Table 2\.1<\/span>/);
  assert.match(
    movedFirst,
    /class="xref">Listing 3\.1<\/a> in <a href="\/second\/" class="xref">Chapter 3<\/a>; Chapter 1 is/,
  );
  assert.match(movedSecond, /<span class="number">Listing 3\.1<\/span> Saying hello/);
  assert.match(
    movedSecond,
    /Back to <a href="\/first\/#fig-ticket-rail" class="xref">Figure 2\.1<\/a> in <a href="\/first\/" class="xref">Chapter 2<\/a>/,
  );
});

test("a citation links to the sources page and shows the source's place in the chapter's sources", () => {
  assert.match(first, /orders \[<a href="\/sources\/#alpha-docs" title="Alpha docs" class="cite">1<\/a>\]/);
  assert.match(
    first,
    /stops \[<a href="\/sources\/#alpha-docs"[^>]*>1<\/a>, <a href="\/sources\/#beta-paper" title="Beta paper" class="cite">2<\/a>\]/,
  );
});

test("the first use of each tagged term links to the glossary with its definition in aria-describedby text", () => {
  assert.match(
    first,
    /An <a href="\/glossary\/#agent-loop" class="term" data-def="The cycle that calls a model and runs its tools until it stops\." aria-describedby="termdef-agent-loop">agent loop<\/a> calls/,
  );
  assert.match(
    first,
    /<div hidden class="term-defs" data-pagefind-ignore=""><span id="termdef-agent-loop">The cycle that calls a model and runs its tools until it stops\.<\/span>/,
  );
});

test("later uses of a term stay plain", () => {
  assert.match(first, /\. The agent loop then ends/);
  assert.equal(first.match(/href="\/glossary\/#agent-loop"/g)?.length, 1);
});

test("an abbreviation links in its exact case only, wrapped in abbr, with its expansion in the card", () => {
  assert.match(first, /aria-describedby="termdef-mcp"><abbr>MCP<\/abbr><\/a> connects/);
  assert.match(first, /<span id="termdef-mcp">MCP: Model Context Protocol\. An open standard/);
  assert.match(first, /Lowercase mcp is not the abbreviation/);
});

test("a chapter with no tagged terms links none", () => {
  assert.doesNotMatch(second, /class="term"/);
  assert.doesNotMatch(second, /term-defs/);
});

test("an analogy is marked with its register id, in its own chapter and when a later chapter refers back", () => {
  assert.match(first, /<span class="analogy" data-analogy="kitchen-ticket-rail">A ticket rail<\/span>/);
  assert.match(second, /<span class="analogy" data-analogy="kitchen-ticket-rail">the ticket rail<\/span>/);
});

test("code keeps reference and citation syntax as written, and a stray colon stays text", () => {
  assert.match(second, /<code>\[\[fig:nope\]\]<\/code> and <code>\[@nope\]<\/code>/);
  assert.match(first, /At re:Invent the colon stays text\./);
});

test("the register keeps the secondary flag the sources page notes", () => {
  assert.equal(book.sources.get("beta-paper")?.secondary, true);
  assert.equal(book.sources.get("alpha-docs")?.secondary, undefined);
});

test("a verifiedIn file's URLs are read from inline links, reference definitions and bare text alike", () => {
  const urls = urlsIn("See [a](https://a.example/x). [b]: https://b.example/y/\nAnd https://c.example/z, too.");
  assert.deepEqual([...urls], ["https://a.example/x", "https://b.example/y", "https://c.example/z"]);
  assert.equal(normalizeUrl("https://a.example/x/"), "https://a.example/x");
  assert.ok(!urlsIn("https://vercel.com/docs/sandbox/pricing.md").has("https://vercel.com/docs/sandbox"));
});

test("a long run of unclosed citation or reference brackets is scanned in linear time", () => {
  // Unbounded, each "[[" or "[@" would scan to the end of the text, so 100,000 of them would take minutes.
  for (const [pattern, text] of [
    [REF_LIKE, "[[".repeat(100_000)],
    [CITE_LIKE, "[@".repeat(100_000)],
  ] as const) {
    const started = performance.now();
    assert.equal([...text.matchAll(pattern)].length, 0);
    assert.ok(performance.now() - started < 1000, `${pattern} took ${performance.now() - started} ms`);
  }
});

test("only fact-check logs count as verifiedIn targets", () => {
  for (const path of [
    "docs/research/fact-check-2026-11-18.md",
    "docs/research/agent/fact-check.md",
    "docs/research/memory/fact-check-retrieval-and-memory.md",
    "docs/plans/reviews/fact-check-build-book.md",
    "docs/reference/pi/fact-check.md",
    "apps/manual/fact-checks/call-workflow-loop.md",
  ]) {
    assert.ok(isFactCheckLog(path), path);
  }
  for (const path of [
    "docs/research/agent-sdks-and-harness-design.md",
    "docs/reference/pi/guide.md",
    "apps/manual/fact-checks/README.md",
    "README.md",
  ]) {
    assert.ok(!isFactCheckLog(path), path);
  }
});

test("a longer front matter changes the render dependencies, so astro dev restarts with current error lines", () => {
  const dir = mutatedFixture((copy) =>
    edit(copy, "chapters/first.md", (text) => text.replace("switchTo: [B11]", "switchTo: [B11, B12]\n# a comment")),
  );
  try {
    const longer = loadBook(fixtureInputs(dir));
    assert.equal(
      longer.index.written.get("first")?.bodyLineOffset,
      (book.index.written.get("first")?.bodyLineOffset ?? 0) + 1,
    );
    assert.notEqual(renderDependencies(longer), renderDependencies(book));
  } finally {
    removeFixture(dir);
  }
});
