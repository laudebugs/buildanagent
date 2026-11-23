import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import { checkBook, paperNotes } from "../src/book/check-book.js";
import { loadBook } from "../src/book/load.js";
import { auditPapers, formatAudit, guessName } from "../src/book/paper-audit.js";
import { isPaperUrl, paperCitations } from "../src/book/papers.js";
import { edit, editJson, fixtureInputs, mutatedFixture, removeFixture, renderLikeAstro } from "./book-fixture.js";

// How chapters name the register's research papers: `[[paper:id]]` renders and links, the sources page lists where
// each paper is cited, check:book prints the described mentions, and the audit counts every mention. check-book.test.ts
// holds one failing fixture per rule.

// The fixture's first chapter names its paper three ways, and its second chapter names it once, marked described.
// Every other spelling below is one the bare-name rule must leave alone.
const dir = mutatedFixture((d) => {
  edit(d, "chapters/first.md", (text) =>
    text
      .replace("sources: [alpha-docs, beta-paper]", "sources: [alpha-docs, beta-paper, gamma-paper]")
      .replace(
        "## Exercises",
        [
          "[[paper:gamma-paper]] measured the loop. A later run of [[paper:gamma-paper]] agreed [@gamma-paper].",
          "",
          "Code such as `Gamma`{checked=row-1}, a [link to Gamma](https://example.com/), lowercase gamma and the plural Gammas all stay as written.",
          "",
          "## Exercises",
        ].join("\n"),
      ),
  );
  edit(d, "chapters/second.md", (text) =>
    text
      .replace("sources: [alpha-docs]", "sources: [alpha-docs, gamma-paper]")
      .replace(
        "## Exercises",
        "The fixture paper [[paper:gamma-paper described]], from January 2026, measured it.\n\n## Exercises",
      ),
  );
});
afterAll(() => removeFixture(dir));
const book = loadBook(fixtureInputs(dir));

test("the fixture's papers pass check:book: names in code, links, lowercase and other words stay plain", async () => {
  assert.deepEqual(await checkBook(fixtureInputs(dir)), []);
});

test("a spelling inside a [[paper:id]] reference or a [@id] citation is not bare text", async () => {
  const aliased = mutatedFixture((d) => {
    editJson(d, "sources.json", (s) => s.map((e) => (e.id === "gamma-paper" ? { ...e, aliases: ["gamma"] } : e)));
    edit(d, "chapters/first.md", (text) =>
      text
        .replace("sources: [alpha-docs, beta-paper]", "sources: [alpha-docs, beta-paper, gamma-paper]")
        .replace("## Exercises", "[[paper:gamma-paper]] ran [@gamma-paper].\n\n## Exercises"),
    );
  });
  try {
    assert.match(String(loadBook(fixtureInputs(aliased)).sources.get("gamma-paper")?.aliases), /^gamma$/);
    assert.deepEqual(await checkBook(fixtureInputs(aliased)), []);
  } finally {
    removeFixture(aliased);
  }
});

test("a chapter's first [[paper:id]] links the short name and shows the blurb; a later one links the name alone", async () => {
  const html = await renderLikeAstro(book, "first");
  assert.match(
    html,
    /<a href="\/sources\/#gamma-paper" title="Gamma: a fixture paper" class="paper-ref" id="paper-gamma-paper">Gamma<\/a> \(a January 2026 arXiv paper by Gamma et al\. that measures the loop\) measured the loop\./,
  );
  assert.match(
    html,
    /A later run of <a href="\/sources\/#gamma-paper" title="Gamma: a fixture paper" class="paper-ref">Gamma<\/a> agreed \[<a href="\/sources\/#gamma-paper"[^>]*class="cite">3<\/a>\]/,
  );
  assert.equal(html.match(/a January 2026 arXiv paper/g)?.length, 1, "the blurb shows once in a chapter");
  assert.match(html, /<code[^>]*>Gamma<\/code>, a <a href="https:\/\/example\.com\/">link to Gamma<\/a>/);
});

test("[[paper:id described]] links the name with the first mention's anchor and shows no blurb", async () => {
  const html = await renderLikeAstro(book, "second");
  assert.match(
    html,
    /The fixture paper <a href="\/sources\/#gamma-paper" title="Gamma: a fixture paper" class="paper-ref" id="paper-gamma-paper">Gamma<\/a>, from January 2026, measured it\./,
  );
  assert.doesNotMatch(html, /a January 2026 arXiv paper/);
});

test("check:book's notes count the pending papers and list each described mention with its line", () => {
  assert.deepEqual(paperNotes(book), [
    "1 paper(s) pending a short name and blurb in papers-pending.json",
    "pending papers whose url is not a paper's own page yet: beta-paper",
    "1 paper mention(s) marked described, whose sentence must describe the paper:",
    "  chapters/second.md:20: [[paper:gamma-paper described]]",
  ]);
});

test("the sources page's 'Cited in' links each chapter to its first mention, or to the chapter for a citation alone", () => {
  const citations = paperCitations(book);
  assert.deepEqual(citations.get("gamma-paper"), [
    { number: 1, title: "The first chapter", href: "/first/#paper-gamma-paper" },
    { number: 2, title: "The second chapter", href: "/second/#paper-gamma-paper" },
  ]);
  assert.deepEqual(citations.get("beta-paper"), [{ number: 1, title: "The first chapter", href: "/first/" }]);
  assert.equal(citations.get("alpha-docs"), undefined, "only papers are listed");
});

test("a paper's url must be its arXiv abstract, its DOI or its page at a known venue", () => {
  assert.ok(isPaperUrl("https://arxiv.org/abs/2305.16291"));
  assert.ok(isPaperUrl("https://doi.org/10.1145/1571941.1572114"));
  assert.ok(isPaperUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/"));
  assert.ok(!isPaperUrl("https://arxiv.org/pdf/2305.16291"), "a PDF is not the abstract page");
  assert.ok(!isPaperUrl("http://arxiv.org/abs/2305.16291"), "only https");
  assert.ok(!isPaperUrl("https://example.org/beta/"));
});

test("the audit guesses a pending paper's name from a short title before its colon", () => {
  assert.equal(guessName("ReAct: Synergizing Reasoning and Acting in Language Models"), "ReAct");
  assert.equal(guessName("τ-bench: A Benchmark for Tool-Agent-User Interaction"), "τ-bench");
  assert.equal(guessName("Measuring Agents in Production"), undefined);
  assert.equal(guessName("Fine-Tuning or Retrieval? Comparing Knowledge Injection in LLMs"), undefined);
});

test("the audit counts each paper's mentions per chapter and finds research names the register lacks", () => {
  const audited = mutatedFixture((d) => {
    edit(d, "chapters/second.md", (text) =>
      text.replace(
        "## Exercises",
        "The Zeta paper by Omega et al. agrees, and the Beta paper too, as Beta showed again.\n\n## Exercises",
      ),
    );
  });
  try {
    const audit = auditPapers(loadBook(fixtureInputs(audited)));
    const beta = audit.papers.find((paper) => paper.id === "beta-paper");
    assert.deepEqual(beta?.names, [], "the fixture's title has no colon, so it gives no guess");
    const gamma = audit.papers.find((paper) => paper.id === "gamma-paper");
    assert.equal(gamma?.chapters.length, 0, "the committed fixture chapters do not name it");
    assert.deepEqual(
      audit.candidates.map(({ name }) => name),
      ["Omega et al."],
      "a name near 'paper' or 'et al.' that no register paper uses",
    );
  } finally {
    removeFixture(audited);
  }
});

test("the audit reports the fixture's mentions, described and not, and prints the totals", () => {
  const audit = auditPapers(book);
  const gamma = audit.papers.find((paper) => paper.id === "gamma-paper");
  assert.deepEqual(
    gamma?.chapters.map(({ slug, counts, first, firstDescribed, laterUnlinked }) => ({
      slug,
      counts,
      first,
      firstDescribed,
      laterUnlinked,
    })),
    [
      {
        slug: "first",
        counts: { ref: 2, described: 0, cite: 1, bare: 0 },
        first: "ref",
        firstDescribed: true,
        laterUnlinked: 0,
      },
      {
        slug: "second",
        counts: { ref: 0, described: 1, cite: 0, bare: 0 },
        first: "described",
        firstDescribed: true,
        laterUnlinked: 0,
      },
    ],
  );
  const beta = audit.papers.find((paper) => paper.id === "beta-paper");
  assert.equal(beta?.chapters[0]?.first, "cite");
  assert.equal(beta?.chapters[0]?.firstDescribed, false);
  const report = formatAudit(audit);
  assert.match(report, /^audit:papers: 2 papers in the register, 1 named, 1 pending$/m);
  assert.match(report, /^ {2}chapter 1 first: 4 \(ref 2, described 0, cite 2, bare 0\)$/m);
  assert.match(
    report,
    /^Totals: 5 mentions, 0 bare \(unlinked\), 1 chapter-paper pair\(s\) whose first mention is not described$/m,
  );
});
