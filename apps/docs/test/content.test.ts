import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { type Page, readPages } from "../src/plugins/pages.js";

// The rules of docs/guidelines/docs-writing.md that a program can check, run over every page.
const pages = readPages();
const MAX_OPENING_WORDS = 50;
const MAX_SENTENCE_WORDS = 40;
const MAX_PARAGRAPH_WORDS = 100;
const MAX_INLINE_CODE_LINES = 5;

const BANNED = /\b(simply|just|easy|easily|obviously|please|utilize|via|etc)\b|note that|!/i;
// A word that may start with a capital in the middle of a sentence-case heading.
const PROPER_NOUNS = new Set(["Node", "Zod", "JSON", "Standard", "TypeScript", "OpenTelemetry", "Anthropic", "OpenAI"]);
const SITE = fileURLToPath(new URL("..", import.meta.url));

/** Every todo id, from the file names of the todo board, so a page that names one is caught. */
function todoIds(): string[] {
  const root = fileURLToPath(new URL("../../../docs/todos/", import.meta.url));
  return readdirSync(root, { recursive: true })
    .map((name) => /^(?:\w+\/)?([A-Z]+\d+[a-z]?)-/.exec(String(name))?.[1])
    .filter((id): id is string => id !== undefined);
}

const IDS = new RegExp(`\\b(?:${[...new Set(todoIds())].join("|")})\\b|\\bADR\\b|\\b(?:D|HD|BK|DS|PB)\\d+\\b`);
const LEAKS = /\b(?:packages|apps|docs|scripts)\/|\bCI\b/;

const words = (text: string) => text.split(/\s+/).filter((word) => word !== "");
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

/** The paragraphs of a page's prose: blocks separated by blank lines, and each list item on its own. */
function paragraphs(page: Page): string[] {
  return page.body
    .split(/\n\s*\n/)
    .flatMap((block) => (/^\s*(?:[-*]|\d+\.)\s/.test(block) ? block.split(/\n(?=\s*(?:[-*]|\d+\.)\s)/) : [block]))
    .map((block) => plain(block.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\n/g, " ")).trim())
    .filter((block) => block !== "" && !block.startsWith("#"));
}

const sentencesOf = (paragraph: string) => paragraph.split(/(?<=[.?!])\s+(?=[A-Z`*])/);

describe.each(pages.map((page) => [page.path, page] as const))("%s", (_path, page) => {
  test("has a title and a description", () => {
    assert.ok(page.frontmatter.title, "title");
    assert.ok(page.frontmatter.description, "description");
  });

  test("opens with a paragraph of 50 words or fewer", () => {
    const [opening] = paragraphs(page);
    assert.ok(opening !== undefined, "the page has a paragraph");
    assert.ok(words(opening).length <= MAX_OPENING_WORDS, `${words(opening).length} words: ${opening}`);
  });

  test("keeps every front matter text, such as a hero tagline, to 40 words", () => {
    for (const text of page.texts) assert.ok(words(text).length <= MAX_SENTENCE_WORDS, text);
  });

  test("keeps sentences to 40 words and paragraphs to 100", () => {
    for (const paragraph of paragraphs(page)) {
      assert.ok(words(paragraph).length <= MAX_PARAGRAPH_WORDS, `a paragraph of ${words(paragraph).length} words`);
      for (const sentence of sentencesOf(paragraph)) {
        assert.ok(words(sentence).length <= MAX_SENTENCE_WORDS, `${words(sentence).length} words: ${sentence}`);
      }
    }
  });

  test("names no todo, decision or round id, and no repository path", () => {
    // A link's address is a site path, not reader text, so only the link's words count.
    const text = plain(`${page.frontmatter.title} ${page.texts.join(" ")} ${page.body}`);
    assert.equal(IDS.exec(text)?.[0], undefined, "an id leaked into reader text");
    assert.equal(LEAKS.exec(text)?.[0], undefined, "a path or CI leaked into reader text");
  });

  test("uses none of the banned words", () => {
    const text = `${page.frontmatter.title} ${page.texts.join(" ")} ${page.body}`;
    assert.equal(BANNED.exec(text)?.[0], undefined);
  });

  test("writes headings in sentence case", () => {
    for (const heading of page.body.split("\n").filter((line) => /^#{2,}\s/.test(line))) {
      const rest = heading.replace(/^#+\s+/, "").replace(/`[^`]*`/g, "x");
      const wrong = words(rest)
        .slice(1)
        .filter((word) => /^[A-Z][a-z]/.test(word) && !PROPER_NOUNS.has(word));
      assert.deepEqual(wrong, [], heading);
    }
  });

  test("shows a long code block only from a tested example file, after a sentence that introduces it", () => {
    for (const fence of page.fences) {
      const ref = parseExampleRef(fence.meta);
      if (ref === undefined) {
        const lines = fence.code.split("\n").length;
        assert.ok(
          lines <= MAX_INLINE_CODE_LINES,
          `line ${fence.line}: ${lines} lines of code need a file under an examples folder`,
        );
      } else {
        assert.ok(exampleSource(ref).length > 0, `line ${fence.line}: ${ref.file} is empty`);
      }
      assert.match(fence.before, /[.:]$/, `line ${fence.line}: a sentence must introduce the code`);
      assert.ok(!fence.before.startsWith("#"), `line ${fence.line}: a heading can't introduce code`);
    }
  });
});

describe("the sidebar", () => {
  const config = readFileSync(`${SITE}astro.config.mjs`, "utf8");
  const slugs = [...config.matchAll(/slug: "([^"]+)"/g)].map((match) => match[1]);

  test("names every page except the home page, once, and no page that is missing", () => {
    const expected = pages.map((page) => page.path.replace(/\.mdx?$/, "")).filter((slug) => slug !== "index");
    assert.deepEqual([...slugs].sort(), expected.sort());
  });

  test("puts the sections in the order start, concepts, guides, testing, reference", () => {
    const labels = [...config.matchAll(/label: "([^"]+)",\s*items:/g)].map((match) => match[1]);
    assert.deepEqual(labels, ["Start", "Concepts", "Guides", "Testing", "Reference"]);
  });

  test("ends every page with a link to the next page in the sidebar", () => {
    const order = [...slugs];
    for (const page of pages.filter((candidate) => candidate.path !== "index.md")) {
      const slug = page.path.replace(/\.mdx?$/, "");
      const closer =
        page.body
          .split("\n")
          .filter((line) => line.trim() !== "")
          .at(-1) ?? "";
      assert.match(closer, /^(?:Next|Start with)/, `${page.path} must end with its next link`);
      const target = /\]\(\/([^)]+?)\/?\)/.exec(closer)?.[1];
      assert.ok(target, `${page.path} has no next link`);
      const next = order[order.indexOf(slug) + 1];
      // The last page points back to where a reader starts.
      assert.equal(target, next ?? "start/first-agent", `${page.path} should link to the next page, ${next}`);
    }
  });
});
