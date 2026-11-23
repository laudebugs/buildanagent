import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterAll, test } from "vitest";
import { checkBook, paperNotes } from "../src/book/check-book.js";
import { loadBook } from "../src/book/load.js";
import { auditPapers, formatAudit, guessName } from "../src/book/paper-audit.js";
import { isPaperUrl, paperCitations, paperUses } from "../src/book/papers.js";
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
    /<a href="\/sources\/#gamma-paper" title="Gamma: a fixture paper" class="paper-ref" id="paper-gamma-paper">Gamma<\/a><span class="paper-ref__blurb"> \(a January 2026 arXiv paper by Gamma et al\. that measures the loop\)<\/span> measured the loop\./,
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

/** A fixture copy whose first chapter lists gamma-paper in its sources, then `change` applied; removed after `use`. */
async function withPaperChapter(change: (dir: string) => void, use: (dir: string) => Promise<void> | void) {
  const copy = mutatedFixture((d) => {
    edit(d, "chapters/first.md", (text) =>
      text.replace("sources: [alpha-docs, beta-paper]", "sources: [alpha-docs, beta-paper, gamma-paper]"),
    );
    change(d);
  });
  try {
    await use(copy);
  } finally {
    removeFixture(copy);
  }
}

const beforeExercises = (paragraph: string) => (d: string) =>
  edit(d, "chapters/first.md", (text) => text.replace("## Exercises", `${paragraph}\n\n## Exercises`));

test("a [[paper:id]] in a heading links the name alone, keeps the heading's slug, and the text's first mention carries the blurb", async () => {
  await withPaperChapter(
    beforeExercises("## What [[paper:gamma-paper]] measured\n\n[[paper:gamma-paper]] measured the loop."),
    async (copy) => {
      assert.deepEqual(await checkBook(fixtureInputs(copy)), []);
      const loaded = loadBook(fixtureInputs(copy));
      const html = await renderLikeAstro(loaded, "first");
      assert.match(
        html,
        /<h2 id="what-gamma-measured">What <a href="\/sources\/#gamma-paper" title="[^"]*" class="paper-ref">Gamma<\/a> measured<\/h2>/,
      );
      assert.match(
        html,
        /<p><a [^>]*class="paper-ref" id="paper-gamma-paper">Gamma<\/a><span class="paper-ref__blurb"> \(a January 2026/,
      );
      assert.deepEqual(paperCitations(loaded).get("gamma-paper")?.[0]?.href, "/first/#paper-gamma-paper");
    },
  );
});

test("a blurb is its own span: the glossary links no term inside it, and a tagged term only a blurb uses fails", async () => {
  const blurbWithTerm = (d: string) =>
    editJson(d, "sources.json", (s) =>
      s.map((e) => (e.id === "gamma-paper" ? { ...e, blurb: "a January 2026 arXiv paper on the agent loop" } : e)),
    );
  await withPaperChapter(
    (d) => {
      blurbWithTerm(d);
      beforeExercises("[[paper:gamma-paper]] measured it.")(d);
    },
    async (copy) => {
      const html = await renderLikeAstro(loadBook(fixtureInputs(copy)), "first");
      assert.match(html, /<span class="paper-ref__blurb"> \(a January 2026 arXiv paper on the agent loop\)<\/span>/);
    },
  );
  const copy = mutatedFixture((d) => {
    blurbWithTerm(d);
    edit(d, "chapters/second.md", (text) =>
      text
        .replace("sources: [alpha-docs]", "sources: [alpha-docs, gamma-paper]")
        .replace("glossary: []", "glossary: [agent-loop]")
        .replace("## Exercises", "[[paper:gamma-paper]] measured it.\n\n## Exercises"),
    );
  });
  try {
    const problems = await checkBook(fixtureInputs(copy));
    assert.equal(problems.length, 1);
    assert.match(problems[0]?.message ?? "", /glossary tags agent-loop, but the chapter's text never uses it/);
  } finally {
    removeFixture(copy);
  }
});

test("a name inside a bare URL is part of a link, as GFM renders it, so 'Cited in' and the audit skip it", async () => {
  await withPaperChapter(
    beforeExercises("See https://example.com/Gamma for the data; [[paper:gamma-paper]] measured it."),
    async (copy) => {
      assert.deepEqual(await checkBook(fixtureInputs(copy)), []);
      const loaded = loadBook(fixtureInputs(copy));
      assert.equal(paperCitations(loaded).get("gamma-paper")?.[0]?.href, "/first/#paper-gamma-paper");
      const gamma = auditPapers(loaded).papers.find((paper) => paper.id === "gamma-paper");
      assert.equal(gamma?.chapters[0]?.counts.bare, 0);
    },
  );
});

test("each id of a citation with several ids is a mention at its own place", async () => {
  await withPaperChapter(beforeExercises("[[paper:gamma-paper]] ran [@alpha-docs;  @gamma-paper]."), (copy) => {
    const loaded = loadBook(fixtureInputs(copy));
    const cite = paperUses(loaded.index.written.values(), loaded.papers, loaded.sources)
      .get("gamma-paper")?.[0]
      ?.mentions.find((mention) => mention.kind === "cite");
    assert.equal(cite?.text, "@gamma-paper");
    assert.equal(cite?.node.value.slice(cite.index, cite.index + cite.text.length), "@gamma-paper");
  });
});

test("check:book lists described mentions by file and then by line as a number", async () => {
  await withPaperChapter(
    (d) => {
      editJson(d, "sources.json", (s) => [...s, { ...s[2], id: "gamma-two", short: "Delta", aliases: undefined }]);
      edit(d, "chapters/first.md", (text) =>
        text
          .replace("gamma-paper]", "gamma-paper, gamma-two]")
          .replace("Lowercase mcp", "[[paper:gamma-two described]] ran. Lowercase mcp")
          .replace("## Exercises", `${"\n".repeat(1000)}[[paper:gamma-paper described]] ran.\n\n## Exercises`),
      );
    },
    (copy) => {
      const notes = paperNotes(loadBook(fixtureInputs(copy))).filter((note) => note.startsWith("  "));
      assert.deepEqual(
        notes.map((note) => note.replace(/^ {2}chapters\/first\.md:(\d+):.*$/, "$1")).map(Number),
        [12, 1036],
      );
    },
  );
});

test("the audit labels a paper by whether it has its name and blurb, not by the pending list alone", () => {
  const unnamed = { ...book, papers: { named: new Map(), pending: book.papers.pending } };
  const report = formatAudit(auditPapers(unnamed));
  assert.match(report, /^audit:papers: 2 papers in the register, 0 named, 1 pending$/m);
  assert.match(report, /^gamma-paper \(neither named nor pending;/m);
});

test("the audit matches an author with a non-ASCII initial to the paper whose publisher names them", async () => {
  await withPaperChapter(
    (d) => {
      editJson(d, "sources.json", (s) =>
        s.map((e) => (e.id === "gamma-paper" ? { ...e, publisher: "Ünal et al. (arXiv:2601.00001)" } : e)),
      );
      beforeExercises("[[paper:gamma-paper]] ran, as Ünal et al. report in their paper.")(d);
    },
    (copy) => {
      const candidate = auditPapers(loadBook(fixtureInputs(copy))).candidates.find((c) => c.name === "Ünal et al.");
      assert.equal(candidate?.probably, "gamma-paper");
    },
  );
});

test("the pending list only shrinks: every id on it was pending when the list started", () => {
  const STARTED_PENDING = new Set([
    "abc-agentic-benchmark-checklist",
    "cormack-rrf",
    "del-rosario-plan-then-execute",
    "dong-minja",
    "fireact",
    "full-duplex-bench",
    "gekhman-new-knowledge",
    "gepa",
    "ghosh-truthgate",
    "guirao-agent-cards",
    "hou-messy-middle",
    "kumar-name-collision",
    "liu-what-does-a-harness-buy",
    "map-measuring-agents",
    "medprompt",
    "modarressi-nolima",
    "ovadia-knowledge-injection",
    "qi-fine-tuning-safety",
    "robot-turn-taking",
    "santra-acam",
    "shinn-reflexion",
    "stivers-turn-taking",
    "swe-agent-observation-masking",
    "swe-rl",
    "tau-bench",
    "tau-voice",
    "thakur-beir",
    "weller-limit",
    "wong-governed-ml",
    "xue-badrag",
    "yao-react",
    "zou-poisonedrag",
  ]);
  const pending = JSON.parse(readFileSync(new URL("../src/data/papers-pending.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(pending));
  for (const id of pending)
    assert.ok(
      STARTED_PENDING.has(id),
      `${id} was not pending when the list started; fill in its short name and blurb instead`,
    );
});

test("paper URL shapes: arXiv old-style ids, ACL Anthology paper ids only", () => {
  assert.ok(isPaperUrl("https://arxiv.org/abs/cs/0603015"));
  assert.ok(isPaperUrl("https://arxiv.org/abs/math.GT/0309136"));
  assert.ok(!isPaperUrl("https://arxiv.org/abs/2305.16291v2"), "the abstract page, not one version");
  assert.ok(isPaperUrl("https://aclanthology.org/2023.acl-long.1/"));
  assert.ok(isPaperUrl("https://aclanthology.org/P19-1001"));
  assert.ok(!isPaperUrl("https://aclanthology.org/events/acl-2023/"));
  assert.ok(!isPaperUrl("https://aclanthology.org/volumes/2023.acl-long/"));
});
