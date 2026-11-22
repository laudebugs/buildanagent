import assert from "node:assert/strict";
import { test } from "vitest";
import { CITE_LIKE } from "../src/book/citations.js";
import { loadBook, renderDependencies } from "../src/book/load.js";
import { isFactCheckLog, normalizeUrl, urlsIn } from "../src/book/sources.js";
import { REF_LIKE } from "../src/markdown/rehype-numbering.js";
import {
  edit,
  editJson,
  FIXTURE_OUTLINE,
  fixtureInputs,
  mutatedFixture,
  prose,
  removeFixture,
  renderLikeAstro,
} from "./book-fixture.js";

// The fixture book's two chapters use every feature the content model renders. These tests read the HTML the build's
// pipeline makes from them; check-book.test.ts holds one failing fixture per rule.

const book = loadBook(fixtureInputs());
const first = await renderLikeAstro(book, "first");
const second = await renderLikeAstro(book, "second");

test("an analogy figure inlines its drawing, names its analogy and links its caption to where the analogy breaks", () => {
  assert.match(
    first,
    /<figure id="fig-ticket-rail" class="numbered figure"[^>]*data-analogy="kitchen-ticket-rail"><div class="panel figure__panel"><div class="figure__stage figure__stage--scroll panel--grid" tabindex="0" role="group" aria-labelledby="fig-ticket-rail--caption"><svg [^>]*data-figure="ticket-rail" role="img" aria-label="Three order tickets hang from a rail\./,
  );
  assert.doesNotMatch(first, /<style|data:font/);
  assert.match(
    first,
    / \(<a href="#fig-ticket-rail--breaks" class="figure__breaks-link">where the analogy breaks<\/a>\)<\/figcaption>/,
  );
  assert.match(
    first,
    /<p id="fig-ticket-rail--breaks" class="figure__breaks"><span class="label">Where it breaks<\/span> A cook remembers yesterday's orders; a model sees only its context\.<\/p><\/figure>/,
  );
});

test("figures, tables and listings are numbered from the chapter's place in the outline", () => {
  assert.match(
    first,
    /<figure id="fig-ticket-rail"[^>]*>[\s\S]*<figcaption class="figure__caption" id="fig-ticket-rail--caption"><span class="number figure__number label">Figure 1\.1<\/span> A kitchen ticket rail/,
  );
  assert.match(
    first,
    /<figcaption id="tbl-stop-reasons--caption"><span class="number">Table 1\.1<\/span> How the loop stops<\/figcaption><div class="table__scroll"/,
  );
  assert.match(
    second,
    /<figcaption class="listing__caption" id="lst-hello-caption"><span class="listing__number number">Listing 2\.1<\/span><span class="listing__title">Saying hello<\/span><\/figcaption><pre/,
  );
});

test("a table scrolls inside a region that takes focus and is named by the table's caption", () => {
  assert.match(
    first,
    /<figure id="tbl-stop-reasons" class="numbered table" data-numbered="table" data-numbered-id="stop-reasons" aria-labelledby="tbl-stop-reasons--caption">/,
  );
  assert.match(
    first,
    /<div class="table__scroll" tabindex="0" role="group" aria-labelledby="tbl-stop-reasons--caption"><table>/,
  );
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
  assert.match(movedFirst, /<span class="number figure__number label">Figure 2\.1<\/span> A kitchen ticket rail/);
  assert.match(movedFirst, /<span class="number">Table 2\.1<\/span>/);
  assert.match(
    movedFirst,
    /class="xref">Listing 3\.1<\/a> in <a href="\/second\/" class="xref">Chapter 3<\/a>; Chapter 1 is/,
  );
  assert.match(
    movedSecond,
    /<span class="listing__number number">Listing 3\.1<\/span><span class="listing__title">Saying hello<\/span>/,
  );
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

test("a tagged term links to the glossary with its card, and screen readers get its definition through aria-describedby", () => {
  assert.match(
    first,
    /An <span class="glossary-term"><a href="\/glossary\/#agent-loop" class="glossary-term__link" aria-describedby="termdef-agent-loop">agent loop<\/a><span class="glossary-card glossary-term__card" aria-hidden="true" data-pagefind-ignore=""><span class="glossary-card__term">agent loop<\/span><span class="glossary-card__definition">The cycle that calls a model and runs its tools until it stops\.<\/span><\/span><\/span> calls/,
  );
  assert.match(
    first,
    /<div hidden class="term-defs" data-pagefind-ignore=""><span id="termdef-agent-loop">The cycle that calls a model and runs its tools until it stops\.<\/span>/,
  );
});

test("a term links once in each block: again in a later caption, but not twice in one paragraph", () => {
  assert.match(first, /\. The agent loop then ends/);
  assert.match(first, /<figcaption[^>]*>.*?The <span class="glossary-term"><a href="\/glossary\/#agent-loop"/);
  assert.equal(first.match(/href="\/glossary\/#agent-loop"/g)?.length, 2);
});

test("an abbreviation links in its exact case only, wrapped in abbr, with its expansion in the card", () => {
  assert.match(first, /aria-describedby="termdef-mcp"><abbr>MCP<\/abbr><\/a><span class="glossary-card/);
  assert.match(
    first,
    /<span class="glossary-card__term">MCP<\/span><span class="glossary-card__definition">Model Context Protocol\. An open/,
  );
  assert.match(first, /<span id="termdef-mcp">MCP: Model Context Protocol\. An open standard/);
  assert.match(first, /Lowercase mcp is not the abbreviation/);
});

/** Tags the agent loop in the second chapter and adds `BLOCKS` to it. */
function withBlocks(dir: string): void {
  edit(dir, "chapters/second.md", (text) => text.replace("glossary: []", "glossary: [agent-loop]"));
  prose(dir, BLOCKS);
}

// Every place a term can appear, in one chapter: the term links in each block that is prose, once, and nowhere else.
const BLOCKS = `
The agent loop starts here. A second agent loop in the same paragraph stays plain.

A later paragraph names the agent loop again, so it links again.

- A list item names the agent loop.
- So does the next item: agent loop.

> A quoted agent loop links too.

| Part | Role |
| --- | --- |
| agent loop | the agent loop runs the steps |

:::box[The agent loop in a box title]{#loop-box}
Inside the box, the agent loop links.
:::

### The agent loop in a heading

A [link about the agent loop](https://example.com/) and \`agent loop\` in code stay plain, and so does a fenced block:

\`\`\`text
agent loop
\`\`\`

<div>agent loop in HTML</div>
`;

test("a term links in every prose block but never in a heading, a box title, a link, code or HTML", async () => {
  const dir = mutatedFixture(withBlocks);
  try {
    const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
    const links = html.match(/href="\/glossary\/#agent-loop"/g)?.length;
    // Eight blocks link: two paragraphs, two list items, the quote, both table cells and the box's paragraph.
    assert.equal(links, 8);
    assert.match(html, /A second agent loop in the same paragraph stays plain/);
    assert.match(
      html,
      /<td><span class="glossary-term"><a[^>]*>agent loop<\/a>.*?<\/td>\s*<td>the <span class="glossary-term">/,
    );
    assert.doesNotMatch(html, /<h\d[^>]*>[^<]*<span class="glossary-term"/);
    assert.match(html, />The agent loop in a box title</);
    assert.match(html, />The agent loop in a heading</);
    assert.match(html, /link about the agent loop<\/a>/);
    assert.match(html, /<code>agent loop<\/code>/);
    assert.match(html, /<div>agent loop in HTML<\/div>/);
  } finally {
    removeFixture(dir);
  }
});

test("a term linked many times keeps one hidden definition, so every aria-describedby names a unique id", async () => {
  const dir = mutatedFixture(withBlocks);
  try {
    const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      ids.filter((id, index) => ids.indexOf(id) !== index),
      [],
    );
    assert.equal(ids.filter((id) => id === "termdef-agent-loop").length, 1);
    for (const [, target] of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.equal(target, "termdef-agent-loop");
    assert.doesNotMatch(html, /class="glossary-card[^"]*" id=/);
  } finally {
    removeFixture(dir);
  }
});

test("a term inside a listing caption's generated line leaves the line whole", async () => {
  // The listing in the second chapter is left out of the live run, so its caption ends "Verified against mock models
  // only", a generated span whose text holds the tagged "mock model".
  const dir = mutatedFixture((copy) => {
    editJson(copy, "glossary.json", (entries) => [
      ...entries,
      { id: "mock-model", term: "mock model", definition: "A stand-in for a model.", sources: ["alpha-docs"] },
    ]);
    edit(copy, "live-examples.json", () => JSON.stringify({ examples: [] }));
    edit(copy, "chapters/second.md", (text) => text.replace("glossary: []", "glossary: [mock-model]"));
    prose(copy, "A mock model answers here.");
  });
  try {
    const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
    assert.match(html, /<span class="listing__verified">Verified against mock models only<\/span><\/figcaption>/);
    assert.match(html, /A <span class="glossary-term"><a href="\/glossary\/#mock-model"/);
    assert.equal(html.match(/href="\/glossary\/#mock-model"/g)?.length, 1);
  } finally {
    removeFixture(dir);
  }
});

test("an analogy caption that names a tagged term passes the analogy check, which reads past the term's card", async () => {
  const dir = mutatedFixture((copy) => {
    editJson(copy, "analogies.json", (entries) =>
      entries.map((entry) =>
        entry.id === "tally-counter" ? { ...entry, analogy: "an agent loop tally counter" } : entry,
      ),
    );
    edit(copy, "chapters/first.md", (text) =>
      text
        .replace(":analogy[a tally counter]{#tally-counter}", ":analogy[an agent loop tally counter]{#tally-counter}")
        .replace("A tally counter: one click", "An agent loop tally counter: one click"),
    );
  });
  try {
    const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "first");
    assert.match(
      html,
      /<figcaption[^>]*><span class="number figure__number label">Figure 1\.2<\/span> An <span class="glossary-term"><a href="\/glossary\/#agent-loop"[^>]*>agent loop<\/a>.*? tally counter: one click/,
    );
  } finally {
    removeFixture(dir);
  }
});

test("a chapter with no tagged terms links none", () => {
  assert.doesNotMatch(second, /glossary-term/);
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
