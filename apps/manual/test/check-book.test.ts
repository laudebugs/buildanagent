import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, test, vi } from "vitest";
import { checkBook } from "../src/book/check-book.js";
import type { Outline } from "../src/book/outline-types.js";
import { formatProblem } from "../src/book/problems.js";
import {
  buildError,
  edit,
  editJson,
  FIXTURE_OUTLINE,
  fixtureInputs,
  mutatedFixture,
  removeFixture,
} from "./book-fixture.js";

// Every rule check:book applies has a failing fixture here: a copy of the fixture book with one thing broken. Each
// fixture must fail check:book and the build's own path (load the book, then render each chapter as Astro does), with
// a message that names the file to fix, so the check and the build cannot disagree.

interface Case {
  readonly rule: string;
  readonly change?: (dir: string) => void;
  readonly outline?: Outline;
  /** The file the problem must name, relative to the fixture root. */
  readonly file: string;
  readonly message: RegExp;
}

const FIRST = "chapters/first.md";
const SECOND = "chapters/second.md";
const firstChapter = (change: (text: string) => string) => (dir: string) => edit(dir, FIRST, change);
const withOpenings = (...openings: Outline[number]["chapters"][number]["opening"][]): Outline => [
  {
    title: "Part A",
    chapters: openings.map((opening, i) => ({
      slug: ["first", "second", "third", "fourth", "fifth"][i] ?? `extra-${i}`,
      title: `Chapter ${i + 1}`,
      opening,
    })),
  },
];

const cases: readonly Case[] = [
  // The source register (BK6).
  {
    rule: "a register entry whose verifiedIn file lacks its URL fails",
    change: (dir) => editJson(dir, "sources.json", (s) => [{ ...s[0], url: "https://example.com/unchecked" }, s[1]]),
    file: "sources.json",
    message: /alpha-docs: apps\/manual\/fact-checks\/first\.md does not mention https:\/\/example\.com\/unchecked/,
  },
  {
    rule: "a register entry whose verifiedIn file does not exist fails",
    change: (dir) =>
      editJson(dir, "sources.json", (s) => [{ ...s[0], verifiedIn: "apps/manual/fact-checks/missing.md" }, s[1]]),
    file: "sources.json",
    message: /alpha-docs: verifiedIn names apps\/manual\/fact-checks\/missing\.md, which is not a file/,
  },
  {
    rule: "a register entry whose verifiedIn is not a fact-check log fails",
    change: (dir) => editJson(dir, "sources.json", (s) => [{ ...s[0], verifiedIn: "chapters/first.md" }, s[1]]),
    file: "sources.json",
    message: /alpha-docs: verifiedIn names chapters\/first\.md, which is not a fact-check log/,
  },
  {
    rule: "a written chapter without its fact-check log fails",
    change: (dir) => rmSync(join(dir, "apps/manual/fact-checks/second.md")),
    file: SECOND,
    message: /the chapter has no fact-check log; add apps\/manual\/fact-checks\/second\.md/,
  },
  {
    rule: "a source id used twice fails",
    change: (dir) => editJson(dir, "sources.json", (s) => [...s, s[0]]),
    file: "sources.json",
    message: /alpha-docs: the id appears twice/,
  },
  {
    rule: "a register entry that breaks the schema fails",
    change: (dir) => editJson(dir, "sources.json", (s) => [...s, { ...s[0], id: "gamma-docs", asOf: "2026" }]),
    file: "sources.json",
    message: /entry 3: asOf: asOf must be a month and year/,
  },
  // The glossary (BK7).
  {
    rule: "a glossary definition that cites an unknown source fails",
    change: (dir) => editJson(dir, "glossary.json", (g) => [{ ...g[0], sources: ["nowhere"] }, ...g.slice(1)]),
    file: "glossary.json",
    message: /agent-loop: source "nowhere" is not in the register/,
  },
  {
    rule: "a spelling two glossary entries match fails",
    change: (dir) => editJson(dir, "glossary.json", (g) => [...g, { ...g[1], id: "harness-again" }]),
    file: "glossary.json",
    message: /harness-again: "harness" is already matched by harness/,
  },
  {
    rule: "a glossary id used twice fails",
    change: (dir) => editJson(dir, "glossary.json", (g) => [...g, { ...g[1], term: "harnessing" }]),
    file: "glossary.json",
    message: /harness: the id appears twice/,
  },
  {
    rule: "a glossary definition with Markdown in it fails",
    change: (dir) => editJson(dir, "glossary.json", (g) => [{ ...g[0], definition: "A `loop`." }, ...g.slice(1)]),
    file: "glossary.json",
    message: /entry 1: definition: the definition must be plain text/,
  },
  {
    rule: "an abbreviation without its expansion fails",
    change: (dir) => editJson(dir, "glossary.json", (g) => [...g.slice(0, 2), { ...g[2], expansion: undefined }]),
    file: "glossary.json",
    message: /entry 3: expansion: an abbreviation needs its expansion/,
  },
  // The analogy register (BK22).
  {
    rule: "two entries with the same analogy for the same concept fail as a duplicate",
    change: (dir) => editJson(dir, "analogies.json", (a) => [...a, { ...a[0], id: "rail-again", illustration: null }]),
    file: "analogies.json",
    message: /rail-again: duplicates kitchen-ticket-rail, the same analogy for the same concept/,
  },
  {
    rule: "one analogy used for a second concept fails",
    change: (dir) =>
      editJson(dir, "analogies.json", (a) => [
        ...a,
        { ...a[0], id: "rail-for-queues", concept: "a work queue", analogy: "The kitchen ticket-rail!" },
      ]),
    file: "analogies.json",
    message: /rail-for-queues: "The kitchen ticket-rail!" already explains "agent loop" \(kitchen-ticket-rail\)/,
  },
  {
    rule: "a concept given a second analogy fails",
    change: (dir) =>
      editJson(dir, "analogies.json", (a) => [...a, { ...a[0], id: "loop-as-carousel", analogy: "a carousel" }]),
    file: "analogies.json",
    message: /loop-as-carousel: "agent loop" already has an analogy \(kitchen-ticket-rail\)/,
  },
  {
    rule: "an analogy whose chapter is not in the outline fails",
    change: (dir) => editJson(dir, "analogies.json", (a) => [{ ...a[0], chapter: "nowhere" }]),
    file: "analogies.json",
    message: /kitchen-ticket-rail: chapter "nowhere" is not in outline\.ts/,
  },
  {
    rule: "an illustration that is not a figure in its written chapter fails",
    change: (dir) => editJson(dir, "analogies.json", (a) => [{ ...a[0], illustration: "no-such-figure" }]),
    file: "analogies.json",
    message: /illustration "no-such-figure" is not a figure in first\.md/,
  },
  {
    rule: "a chapter that uses an analogy missing from the register fails",
    change: firstChapter((t) => t.replace("{#kitchen-ticket-rail}", "{#a-conveyor-belt}")),
    file: FIRST,
    message: /:analogy\{#a-conveyor-belt\} is not in the analogy register/,
  },
  {
    rule: "a chapter that names a later chapter's analogy fails",
    change: (dir) => editJson(dir, "analogies.json", (a) => [{ ...a[0], chapter: "second", illustration: null }]),
    file: FIRST,
    message: /analogy "kitchen-ticket-rail" belongs to second, which comes later/,
  },
  {
    rule: "an analogy named without a label fails",
    change: firstChapter((t) => t.replace(":analogy[A ticket rail]", ":analogy")),
    file: FIRST,
    message: /:analogy\{#kitchen-ticket-rail\} needs a label/,
  },
  // The outline and its opening rotation (BK5, BK22).
  {
    rule: "an outline where two consecutive chapters share an opening type fails",
    outline: withOpenings("scenario", "code", "code", "question", "fact", "analogy", "incident", "scenario"),
    file: "outline.ts",
    message: /chapters 2 \(second\) and 3 \(third\) both open with "code"/,
  },
  {
    rule: "an outline where one type opens more than a quarter of the chapters fails",
    outline: withOpenings("scenario", "code", "scenario", "question", "scenario"),
    file: "outline.ts",
    message: /"scenario" opens 3 of 5 chapters; no type may open more than 2/,
  },
  {
    rule: "a slug listed twice in the outline fails",
    outline: [...FIXTURE_OUTLINE, { title: "Part C", chapters: [{ slug: "first", title: "Again", opening: "fact" }] }],
    file: "outline.ts",
    message: /chapter slug "first" appears twice/,
  },
  {
    rule: "a slug that is not kebab-case fails",
    outline: [...FIXTURE_OUTLINE, { title: "Part C", chapters: [{ slug: "Ch_4", title: "Four", opening: "fact" }] }],
    file: "outline.ts",
    message: /chapter slug "Ch_4" is not kebab-case/,
  },
  // Numbering and references (BK5).
  {
    rule: "a chapter file the outline does not name fails",
    outline: [{ title: "Part A", chapters: [{ slug: "first", title: "One", opening: "scenario" }] }],
    file: SECOND,
    message: /this chapter is not in the outline/,
  },
  {
    rule: "a numbered block without an id fails with its line",
    change: firstChapter((t) => t.replace("{#stop-reasons}", "")),
    file: `${FIRST}:18`,
    message: /a table needs a kebab-case id/,
  },
  {
    rule: "an id used for two figures fails with both places",
    change: firstChapter((t) => t.replace("{#stop-reasons}", "{#ticket-rail}").replace(":::table", ":::figure")),
    file: `${FIRST}:18`,
    message: /the figure id "ticket-rail" is already used at chapters\/first\.md:14/,
  },
  {
    rule: "a reference to an unknown figure fails with its line",
    change: firstChapter((t) => t.replace("[[fig:ticket-rail]]", "[[fig:missing]]")),
    file: `${FIRST}:24`,
    message: /\[\[fig:missing\]\] names no figure in the book/,
  },
  {
    rule: "a reference error keeps its line in a paragraph that also links a glossary term",
    change: firstChapter((t) =>
      t
        .replace("glossary: [agent-loop, mcp]", "glossary: [agent-loop, mcp, harness]")
        .replace("See [[fig:ticket-rail]],", "The harness and [[fig:missing]]. See [[fig:ticket-rail]],"),
    ),
    file: `${FIRST}:24`,
    message: /\[\[fig:missing\]\] names no figure in the book/,
  },
  {
    rule: "a reference error names its own line inside a paragraph with a term and a citation",
    change: firstChapter((t) =>
      t
        .replace("glossary: [agent-loop, mcp]", "glossary: [agent-loop, mcp, harness]")
        .replace(
          "See [[fig:ticket-rail]],",
          "The harness runs [@alpha-docs].\nIt names [[fig:missing]]. See [[fig:ticket-rail]],",
        ),
    ),
    file: `${FIRST}:25`,
    message: /\[\[fig:missing\]\] names no figure in the book/,
  },
  {
    rule: "a reference to a chapter not in the outline fails",
    change: firstChapter((t) => t.replace("[[ch:third]]", "[[ch:fourth]]")),
    file: `${FIRST}:24`,
    message: /\[\[ch:fourth\]\] names no chapter in outline\.ts/,
  },
  {
    rule: "a malformed reference fails",
    change: firstChapter((t) => t.replace("[[ch:third]]", "[[chapter three]]")),
    file: `${FIRST}:24`,
    message: /\[\[chapter three\]\] is not a reference/,
  },
  {
    rule: "a figure without a caption fails",
    change: firstChapter((t) => t.replace(":::figure[The ticket rail]", ":::figure")),
    file: `${FIRST}:14`,
    message: /a figure needs a caption/,
  },
  {
    rule: "a table directive that holds no table fails",
    change: firstChapter((t) => t.replace(/\| Stop[\s\S]*?tool call \|\n/, "No table here.\n")),
    file: `${FIRST}:18`,
    message: /a table must hold a table block/,
  },
  {
    rule: "an unknown directive fails",
    change: firstChapter((t) => t.replace("## Exercises", ":::aside\nA note.\n:::\n\n## Exercises")),
    file: `${FIRST}:26`,
    message: /unknown directive :::aside/,
  },
  // Citations (BK6).
  {
    rule: "a citation of an unknown id fails with its line",
    change: firstChapter((t) => t.replace("[@alpha-docs]", "[@gamma-site]")),
    file: `${FIRST}:10`,
    message: /\[@gamma-site\] is not in the source register/,
  },
  {
    rule: "a citation of a source missing from the chapter's sources fails",
    change: (dir) => edit(dir, SECOND, (t) => t.replace("Back to", "Back [@beta-paper] to")),
    file: `${SECOND}:16`,
    message: /\[@beta-paper\] is not in this chapter's `sources`/,
  },
  {
    rule: "a malformed citation fails",
    change: firstChapter((t) => t.replace("[@alpha-docs]", "[@Alpha_Docs]")),
    file: `${FIRST}:10`,
    message: /\[@Alpha_Docs\] is not a citation/,
  },
  {
    rule: "a malformed citation that crosses a line break fails",
    change: firstChapter((t) => t.replace("[@alpha-docs; @beta-paper]", "[@alpha-docs;\n@Beta]")),
    file: `${FIRST}:12`,
    message: /\[@alpha-docs;\n@Beta\] is not a citation/,
  },
  {
    rule: "a citation id broken by a line break fails",
    change: firstChapter((t) => t.replace("[@alpha-docs]", "[@Bad\nthing]")),
    file: `${FIRST}:10`,
    message: /\[@Bad\nthing\] is not a citation/,
  },
  {
    rule: "a reference broken by a line break fails",
    change: firstChapter((t) => t.replace("See [[fig:ticket-rail]],", "See [[fig:ticket\nrail]],")),
    file: `${FIRST}:24`,
    message: /\[\[fig:ticket\nrail\]\] is not a reference/,
  },
  // The chapter contract: the front matter schema and the chapter's shape (BK5).
  {
    rule: "a front matter key the schema does not know fails",
    change: firstChapter((t) => t.replace("switchTo: [B11]", "switchTo: [B11]\nglosary: [harness]")),
    file: FIRST,
    message: /front matter: Unrecognized key: "glosary"/,
  },
  {
    rule: "front matter without a summary fails",
    change: firstChapter((t) => t.replace(/^summary: .*\n/m, "")),
    file: FIRST,
    message: /front matter: summary:/,
  },
  {
    rule: "an opening that differs from the outline's plan fails",
    change: firstChapter((t) => t.replace("opening: scenario", "opening: incident")),
    file: FIRST,
    message: /opening is "incident", but outline\.ts plans "scenario"/,
  },
  {
    rule: "front matter sources that name an unknown id fail",
    change: firstChapter((t) => t.replace("sources: [alpha-docs, beta-paper]", "sources: [alpha-docs, nope]")),
    file: FIRST,
    message: /sources lists "nope", which is not in sources\.json/,
  },
  {
    rule: "front matter sources that list an id twice fail",
    change: (dir) => edit(dir, SECOND, (t) => t.replace("sources: [alpha-docs]", "sources: [alpha-docs, alpha-docs]")),
    file: SECOND,
    message: /sources lists "alpha-docs" twice/,
  },
  {
    rule: "a chapter tagging an unknown glossary term fails",
    change: firstChapter((t) => t.replace("glossary: [agent-loop, mcp]", "glossary: [agent-loop, mcp, toolbox]")),
    file: FIRST,
    message: /glossary lists "toolbox", which is not in glossary\.json/,
  },
  {
    rule: "a chapter tagging a glossary term its text never uses fails",
    change: firstChapter((t) => t.replace("glossary: [agent-loop, mcp]", "glossary: [agent-loop, mcp, harness]")),
    file: FIRST,
    message: /glossary tags harness, but the chapter's text never uses it$/,
  },
  {
    rule: "a chapter that does not end with Exercises fails",
    change: firstChapter((t) => `${t}\n## Further reading\n\nMore.\n`),
    file: `${FIRST}:30`,
    message: /the chapter must end with an "## Exercises" section/,
  },
  {
    rule: "an Exercises section without a list fails",
    change: firstChapter((t) => t.replace("1. Run the loop and count its steps.", "Run the loop.")),
    file: `${FIRST}:26`,
    message: /the "Exercises" section needs a list of exercises/,
  },
];

const dirs: string[] = [];
beforeAll(() => {
  // Astro's renderer logs each failed render before rethrowing it; the assertions below read the errors instead.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  for (const dir of dirs) removeFixture(dir);
  vi.restoreAllMocks();
});

test("the fixture book passes check:book and the build", async () => {
  assert.deepEqual(await checkBook(fixtureInputs()), []);
  assert.equal(await buildError(fixtureInputs()), undefined);
});

test("the real book passes check:book", async () => {
  assert.deepEqual((await checkBook()).map(formatProblem), []);
});

for (const { rule, change, outline, file, message } of cases) {
  test(rule, async () => {
    const dir = mutatedFixture(change ?? (() => undefined));
    dirs.push(dir);
    const inputs = fixtureInputs(dir, outline);
    const problems = (await checkBook(inputs)).map(formatProblem);
    // One rule broken, one problem: the fixture must not trip any other rule.
    assert.equal(problems.length, 1, `check:book should report exactly one problem, got:\n${problems.join("\n")}`);
    assert.ok(
      problems[0]?.startsWith(file) && message.test(problems[0]),
      `check:book should report ${file}: ${message}, got:\n${problems.join("\n")}`,
    );
    const error = await buildError(inputs);
    assert.ok(error !== undefined, "the build should fail too");
    assert.match(error, message);
    // The build names the file, and the line when the check does: a book-load problem by the file's path, a render
    // failure by the chapter's full path and its line in the file.
    assert.ok(error.includes(file), `the build's error should name ${file}:\n${error}`);
  });
}
