import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { API_PACKAGES } from "../src/api/packages.js";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { type Page, readPages } from "../src/plugins/pages.js";
import { type TopicItem, topics, WRITTEN_TOPICS } from "../src/topics.js";

// The rules of docs/guidelines/docs-writing.md that a program can check, run over every page.
const pages = readPages();
const MAX_OPENING_WORDS = 50;
const MAX_SENTENCE_WORDS = 40;
const MAX_PARAGRAPH_WORDS = 100;
const MAX_INLINE_CODE_LINES = 5;

const BANNED = /\b(simply|just|easy|easily|obviously|please|utilize|via|etc)\b|note that|!/i;
// A word that may start with a capital in the middle of a sentence-case heading.
const PROPER_NOUNS = new Set(["Node", "Zod", "JSON", "Standard", "TypeScript", "OpenTelemetry", "Anthropic", "OpenAI"]);

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
  // The topic list with stand-ins for the generated API groups, which hold no slugs.
  const topicList = topics(
    API_PACKAGES.map((pkg) => ({ label: pkg.label, output: pkg.output, group: { label: pkg.label, items: [] } })),
  );
  const slugsOf = (items: readonly TopicItem[]): string[] =>
    items.flatMap((item) => {
      if (typeof item === "string") return [item];
      if ("slug" in item) return [item.slug];
      return "items" in item ? slugsOf(item.items) : [];
    });
  const slugs = topicList.flatMap((topic) => slugsOf(topic.items));

  test("names every page except the home page in exactly one topic, and no page that is missing", () => {
    const expected = pages.map((page) => page.path.replace(/\.mdx?$/, "")).filter((slug) => slug !== "index");
    assert.deepEqual([...slugs].sort(), expected.sort());
  });

  test("rejects a misspelled item key at type-check time", () => {
    // @ts-expect-error `lable` is not a sidebar key, so this item must not type-check.
    const typo: TopicItem = { lable: "Install", slug: "start/install" };
    assert.ok(typo);
  });

  test("puts the written topics first, then one API topic for each package", () => {
    assert.deepEqual(
      topicList.map((topic) => topic.label),
      [...WRITTEN_TOPICS, ...API_PACKAGES.map((pkg) => pkg.label)],
    );
  });

  test("puts the sections in the order start, concepts, guides, testing, reference", () => {
    const sdk = topicList[0]?.items as { label: string }[];
    assert.deepEqual(
      sdk.map((group) => group.label),
      ["Start", "Concepts", "Guides", "Testing", "Reference"],
    );
  });

  test("links each topic to a page of its own: a listed page for the written docs, its package's index for an API tab", () => {
    const [written, protocol, cli, ...apiTopics] = topicList;
    for (const topic of [written, protocol, cli]) {
      assert.ok(topic && slugsOf(topic.items)[0] === topic.link, `${topic?.label} must link to its first page`);
    }
    assert.deepEqual(
      apiTopics.map((topic) => topic.link),
      API_PACKAGES.map((pkg) => pkg.output),
    );
  });

  test("ends every page with a link to the next page in its topic", () => {
    // The last page of a topic points back to where a reader starts, or on to the package's API reference.
    const lastTargets: Record<string, string> = {
      [WRITTEN_TOPICS[0]]: "start/first-agent",
      [WRITTEN_TOPICS[1]]: "reference/protocol",
      [WRITTEN_TOPICS[2]]: "reference/cli",
    };
    for (const topic of topicList.slice(0, WRITTEN_TOPICS.length)) {
      const order = slugsOf(topic.items);
      for (const slug of order) {
        const page = pages.find((candidate) => candidate.path.replace(/\.mdx?$/, "") === slug);
        const closer =
          page?.body
            .split("\n")
            .filter((line) => line.trim() !== "")
            .at(-1) ?? "";
        assert.match(closer, /^(?:Next|Start with)/, `${slug} must end with its next link`);
        const target = /\]\(\/([^)]+?)\/?\)/.exec(closer)?.[1];
        assert.ok(target, `${slug} has no next link`);
        const next = order[order.indexOf(slug) + 1] ?? lastTargets[topic.label];
        assert.equal(target, next, `${slug} should link to the next page, ${next}`);
      }
    }
  });
});
