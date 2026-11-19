import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, test, vi } from "vitest";
import { checkBook } from "../src/book/check-book.js";
import type { Outline } from "../src/book/outline-types.js";
import { formatProblem } from "../src/book/problems.js";
import {
  buildError,
  edit,
  editJson,
  FIXTURE_DIR,
  FIXTURE_OUTLINE,
  fixtureInputs,
  removeFixture,
  resetFixture,
  withInteractive,
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
// The second chapter's ::listing, on line 18, shows the region "greet" of the fixture harness's example.
const LISTING = `${SECOND}:18`;
const EXAMPLE = "verify/demo-sdk/examples/01-hello.ts";
const HARNESS_MANIFEST = "verify/demo-sdk/package.json";
const listingLine = (change: (text: string) => string) => (dir: string) =>
  edit(dir, SECOND, (text) => text.replace(/^::listing.*$/m, (line) => change(line)));
const example = (change: (text: string) => string) => (dir: string) => edit(dir, EXAMPLE, change);
// withInteractive adds a listing with notes and a replay on line 20, its notes on lines 21-23, and tabs on line 26
// whose listings are on lines 27 and 28, all after the file listing on line 18.
const NOTED = "verify/demo-sdk/examples/02-notes.ts";
const TRANSCRIPT = "verify/demo-sdk/results/transcripts/02-notes.json";
const interactive = (change: (dir: string) => void) => (dir: string) => {
  withInteractive(dir);
  change(dir);
};
const noted = (change: (text: string) => string) => (dir: string) => edit(dir, NOTED, change);
const interactiveChapter = (change: (text: string) => string) => interactive((dir) => edit(dir, SECOND, change));
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
    rule: "a figure whose caption is only spaces fails",
    change: firstChapter((t) => t.replace(/:::figure\[[^\]]*\]/, ":::figure[ ]")),
    file: `${FIRST}:14`,
    message: /a figure needs a caption/,
  },
  {
    rule: "a table whose caption is only spaces fails",
    change: firstChapter((t) => t.replace(":::table[How the loop stops]", ":::table[   ]")),
    file: `${FIRST}:18`,
    message: /a table needs a caption/,
  },
  {
    rule: "a chapter-code listing whose caption is only spaces fails",
    change: (dir) => edit(dir, SECOND, (t) => t.replace(":::listing[Saying hello]", ":::listing[ ]")),
    file: `${SECOND}:10`,
    message: /a listing needs a caption, written :::listing\[Caption\]/,
  },
  {
    rule: "a figure without a caption fails",
    change: firstChapter((t) => t.replace(/:::figure\[[^\]]*\]/, ":::figure")),
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
  // Generated figures and analogy illustrations (BK11, BK22).
  {
    rule: "a figure whose drawing has no alt text fails with its line",
    change: firstChapter((t) => t.replace(/::svg\{alt="[^"]*"\}/, "::svg")),
    file: `${FIRST}:15`,
    message: /figure "ticket-rail" needs alt text that says what its drawing shows/,
  },
  {
    rule: "a figure that holds prose beside its drawing fails",
    change: firstChapter((t) => t.replace("::svg{", "A drawing of the rail.\n\n::svg{")),
    file: `${FIRST}:14`,
    message: /figure "ticket-rail" must hold one generated drawing, written ::svg\{alt="…"\}, and nothing else/,
  },
  {
    rule: "a figure whose generated drawing is missing fails, naming the script to write",
    change: (dir) => rmSync(join(dir, "figures/first/ticket-rail.svg")),
    file: `${FIRST}:15`,
    message: /has no drawing at figures\/first\/ticket-rail\.svg; write figures\/first\/ticket-rail\.ts and run/,
  },
  {
    rule: "a drawing made for another figure fails",
    change: (dir) =>
      edit(dir, "figures/first/ticket-rail.svg", (t) => t.replace('data-figure="ticket-rail"', 'data-figure="rail"')),
    file: `${FIRST}:15`,
    message: /figures\/first\/ticket-rail\.svg cannot be inlined: it was drawn for figure "rail", not "ticket-rail"/,
  },
  {
    rule: "a drawing outside a figure fails",
    change: firstChapter((t) => t.replace("## Exercises", '::svg{alt="A loose drawing."}\n\n## Exercises')),
    file: `${FIRST}:26`,
    message: /::svg must sit inside a :::figure block/,
  },
  {
    rule: "a figure with an attribute the book does not know fails",
    change: firstChapter((t) => t.replace("{#ticket-rail analogy=", '{#ticket-rail width="300" analogy=')),
    file: `${FIRST}:14`,
    message: /a figure takes only the attributes id and analogy, not "width"/,
  },
  {
    rule: "a drawing with an attribute other than alt fails",
    change: firstChapter((t) => t.replace("::svg{alt=", '::svg{src="rail.svg" alt=')),
    file: `${FIRST}:15`,
    message: /::svg takes only the attribute alt, not "src"/,
  },
  {
    rule: "an analogy figure whose register entry is missing fails",
    change: firstChapter((t) => t.replace('analogy="kitchen-ticket-rail"', 'analogy="order-spike"')),
    file: `${FIRST}:14`,
    message: /figure "ticket-rail" names the analogy "order-spike", which is not in analogies\.json/,
  },
  {
    rule: "an analogy figure whose register entry names another figure fails",
    change: (dir) => {
      const svg = (t: string) => t.replace(/ticket-rail/g, "rail-detail");
      writeFileSync(
        join(dir, "figures/first/rail-detail.svg"),
        svg(readFileSync(join(dir, "figures/first/ticket-rail.svg"), "utf8")),
      );
      edit(dir, FIRST, (t) =>
        t.replace(
          "## Exercises",
          ':::figure[The rail up close]{#rail-detail}\n::svg{alt="The rail."}\n:::\n\n## Exercises',
        ),
      );
      editJson(dir, "analogies.json", (a) => [{ ...a[0], illustration: "rail-detail" }]);
    },
    file: `${FIRST}:14`,
    message: /gives that analogy "rail-detail" as its illustration; set its illustration to "ticket-rail"/,
  },
  {
    rule: "an analogy figure whose register entry has no illustration fails",
    change: (dir) => editJson(dir, "analogies.json", (a) => [{ ...a[0], illustration: null }]),
    file: `${FIRST}:14`,
    message: /gives that analogy no illustration; set its illustration to "ticket-rail"/,
  },
  {
    rule: "an analogy figure whose caption does not start with the analogy's name fails",
    change: firstChapter((t) => t.replace("[A kitchen ticket rail:", "[The rail:")),
    file: `${FIRST}:14`,
    message: /the caption of figure "ticket-rail" must start with the analogy's name, "a kitchen ticket rail"/,
  },
  {
    rule: "a figure that a later chapter's analogy names as its illustration must carry the mark",
    change: (dir) => {
      const svg = readFileSync(join(dir, "figures/first/ticket-rail.svg"), "utf8").replace(
        /ticket-rail/g,
        "rail-detail",
      );
      mkdirSync(join(dir, "figures/second"), { recursive: true });
      writeFileSync(join(dir, "figures/second/rail-detail.svg"), svg);
      edit(dir, SECOND, (t) =>
        t.replace(
          "## Exercises",
          ':::figure[The rail up close]{#rail-detail}\n::svg{alt="The rail."}\n:::\n\n## Exercises',
        ),
      );
      editJson(dir, "analogies.json", (a) => [
        ...a,
        {
          id: "order-spike",
          concept: "a work queue",
          analogy: "a waiter's order spike",
          chapter: "third",
          illustration: "rail-detail",
          breaks: "A spike holds paper; a queue holds messages.",
        },
      ]);
    },
    file: `${SECOND}:20`,
    message: /figure "rail-detail" illustrates the analogy order-spike in analogies\.json; mark it/,
  },
  {
    rule: "a figure that illustrates a registered analogy without saying so fails",
    change: firstChapter((t) => t.replace(' analogy="kitchen-ticket-rail"', "")),
    file: `${FIRST}:14`,
    message: /figure "ticket-rail" illustrates the analogy kitchen-ticket-rail in analogies\.json; mark it/,
  },
  // Listings from real files (BK9).
  {
    rule: "a listing whose file was deleted fails with its line",
    change: (dir) => rmSync(join(dir, EXAMPLE)),
    file: LISTING,
    message: /listing "greet": verify\/demo-sdk\/examples\/01-hello\.ts is not a file/,
  },
  {
    rule: "a listing whose region was renamed in the file fails",
    change: example((t) => t.replace("// #region greet", "// #region greeting")),
    file: LISTING,
    message: /01-hello\.ts has no region "greet"; its regions are call, greeting, message/,
  },
  {
    rule: "a listing of a file outside every checked tsconfig.json fails",
    change: listingLine((l) => l.replace(EXAMPLE, "verify/demo-sdk/scripts/tool.ts").replace('"greet"', '"tool"')),
    file: LISTING,
    message:
      /scripts\/tool\.ts is outside every tsconfig\.json .*: verify\/demo-sdk\/tsconfig\.json does not include it/,
  },
  {
    rule: "a listing of a file that a base tsconfig's exclude removes fails, as tsc inherits the exclude",
    change: (dir) => {
      writeFileSync(join(dir, "verify/demo-sdk/tsconfig.base.json"), '{ "exclude": ["examples/01-hello.ts"] }\n');
      writeFileSync(
        join(dir, "verify/demo-sdk/tsconfig.json"),
        '{ "extends": "./tsconfig.base.json", "include": ["examples/**/*.ts"] }\n',
      );
    },
    file: LISTING,
    message: /01-hello\.ts is outside every tsconfig\.json .*: verify\/demo-sdk\/tsconfig\.json does not include it/,
  },
  {
    rule: "a listing of a package that a ! glob removes from the pnpm workspace fails",
    change: (dir) => edit(dir, "pnpm-workspace.yaml", (t) => `${t}  - "!verify/demo-sdk"\n`),
    file: LISTING,
    message: /outside every tsconfig\.json .*: verify\/demo-sdk is not a package of pnpm-workspace\.yaml/,
  },
  {
    rule: "a listing of a symbolic link to a file outside the repository fails",
    change: (dir) => {
      symlinkSync(join(FIXTURE_DIR, EXAMPLE), join(dir, "verify/demo-sdk/examples/02-linked.ts"));
      listingLine((l) => l.replace("01-hello.ts", "02-linked.ts"))(dir);
    },
    file: LISTING,
    message: /02-linked\.ts resolves through a symbolic link to a file outside the repository/,
  },
  {
    rule: "a listing through a symbolic link to a directory outside the repository fails",
    change: (dir) => {
      symlinkSync(join(FIXTURE_DIR, "verify/demo-sdk/examples"), join(dir, "verify/demo-sdk/examples/outside"));
      listingLine((l) => l.replace("examples/01-hello.ts", "examples/outside/01-hello.ts"))(dir);
    },
    file: LISTING,
    message: /examples\/outside\/01-hello\.ts resolves through a symbolic link to a file outside the repository/,
  },
  {
    rule: "a listing whose path starts with ./ fails",
    change: listingLine((l) => l.replace(EXAMPLE, `./${EXAMPLE}`)),
    file: LISTING,
    message: /must be a path from the repository root, without \.\/, \.\., \/\/ or a leading \//,
  },
  {
    rule: "a listing of a package outside the pnpm workspace fails",
    change: (dir) => edit(dir, "pnpm-workspace.yaml", (t) => t.replace('"verify/*"', '"apps/*"')),
    file: LISTING,
    message: /outside every tsconfig\.json .*: verify\/demo-sdk is not a package of pnpm-workspace\.yaml/,
  },
  {
    rule: "a listing of a package whose typecheck script runs no tsc fails",
    change: (dir) =>
      edit(dir, HARNESS_MANIFEST, (t) => t.replace('"typecheck": "tsc -p tsconfig.json"', '"typecheck": "true"')),
    file: LISTING,
    message: /verify\/demo-sdk\/package\.json has no typecheck script that runs tsc/,
  },
  {
    rule: "a listing of a file that is not TypeScript fails",
    change: (dir) => {
      writeFileSync(
        join(dir, "verify/demo-sdk/examples/02-plain.mjs"),
        "// #region greet\nexport {};\n// #endregion\n",
      );
      listingLine((l) => l.replace("01-hello.ts", "02-plain.mjs"))(dir);
    },
    file: LISTING,
    message: /02-plain\.mjs is not TypeScript, so no typecheck checks it/,
  },
  {
    rule: "a listing outside every harness in the harness table fails",
    change: (dir) => writeFileSync(join(dir, "harnesses.json"), "{}\n"),
    file: LISTING,
    message: /01-hello\.ts is in no harness that harnesses\.json lists/,
  },
  {
    rule: "a listing whose harness lacks its main package fails",
    change: (dir) => edit(dir, HARNESS_MANIFEST, (t) => t.replace('"demo-sdk": "1.2.3"', '"other-sdk": "1.2.3"')),
    file: LISTING,
    message: /verify\/demo-sdk\/package\.json does not depend on demo-sdk, the main package harnesses\.json names/,
  },
  {
    rule: "a listing whose main package is not pinned exactly fails",
    change: (dir) => edit(dir, HARNESS_MANIFEST, (t) => t.replace('"1.2.3"', '"^1.2.3"')),
    file: LISTING,
    message: /pins demo-sdk as "\^1\.2\.3", not an exact version/,
  },
  {
    rule: "a harness table entry without a package fails",
    change: (dir) =>
      writeFileSync(join(dir, "harnesses.json"), '{ "verify/demo-sdk": "demo-sdk", "verify/other": "" }'),
    file: "harnesses.json",
    message: /verify\/other: a harness needs its main package's name/,
  },
  {
    rule: "a listing without a file fails",
    change: listingLine((l) => l.replace(/ file="[^"]*"/, "")),
    file: LISTING,
    message: /::listing needs the file it shows/,
  },
  {
    rule: "a listing with an unknown attribute fails",
    change: listingLine((l) => l.replace("region=", "regoin=")),
    file: LISTING,
    message: /::listing does not take "regoin"; it takes id, file, region and replay/,
  },
  {
    rule: "a listing whose path leaves the repository fails",
    change: listingLine((l) => l.replace(EXAMPLE, `../${EXAMPLE}`)),
    file: LISTING,
    message: /must be a path from the repository root, without \.\/, \.\., \/\/ or a leading \//,
  },
  {
    rule: "a region without its #endregion fails with the file's line",
    change: example((t) => t.replace("// #endregion\n\n{", "\n{")),
    file: LISTING,
    message: /01-hello\.ts:2: #region greet has no #endregion/,
  },
  {
    rule: "a region name used twice in one file fails",
    change: example((t) => t.replace("// #region call", "// #region greet")),
    file: LISTING,
    message: /01-hello\.ts:11: #region greet appears twice/,
  },
  {
    rule: "an #endregion without its #region fails",
    change: example((t) => `${t}// #endregion\n`),
    file: LISTING,
    message: /01-hello\.ts:16: #endregion has no #region before it/,
  },
  {
    rule: "an #endregion that names another region fails",
    change: example((t) => t.replace("// #endregion message", "// #endregion greet")),
    file: LISTING,
    message: /01-hello\.ts:6: #endregion greet closes #region message/,
  },
  {
    rule: "a region that is not kebab-case fails",
    change: example((t) => t.replace("// #region call", "// #region Call_Site")),
    file: LISTING,
    message: /01-hello\.ts:11: #region needs a kebab-case name, as in \/\/ #region tool-loop; got "Call_Site"/,
  },
  {
    rule: "an empty region fails",
    change: (dir) => {
      example((t) => `${t}// #region empty\n\n// #endregion\n`)(dir);
      listingLine((l) => l.replace('"greet"', '"empty"'))(dir);
    },
    file: LISTING,
    message: /01-hello\.ts has an empty region "empty"/,
  },
  {
    rule: "a listing whose caption is only spaces fails",
    change: listingLine((l) => l.replace("[Greeting the reader]", "[  ]")),
    file: LISTING,
    message: /a listing needs a caption, written ::listing\[Caption\]\{#greet file="…"\}/,
  },
  {
    rule: "a listing without a caption fails",
    change: listingLine((l) => l.replace("[Greeting the reader]", "")),
    file: LISTING,
    message: /a listing needs a caption, written ::listing\[Caption\]\{#greet file="…"\}/,
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
  // Notes, tabs and replays (BK9, T5).
  {
    rule: "a note whose id no marker in the listed lines carries fails",
    change: interactiveChapter((t) => t.replace("{#print}", "{#printed}")),
    file: `${SECOND}:23`,
    message:
      /note "printed" has no \/\/ book:note printed marker in the lines listing "noted" shows; their markers are name, greet, print/,
  },
  {
    rule: "a marker in the listed lines without its note fails, once the listing gives notes",
    change: interactiveChapter((t) => t.replace(/^::note\[The third.*\n/m, "")),
    file: `${SECOND}:20`,
    message:
      /listing "noted" gives no note for the marker \/\/ book:note print at verify\/demo-sdk\/examples\/02-notes\.ts:7/,
  },
  {
    rule: "a note given twice fails",
    change: interactiveChapter((t) => t.replace("{#print}", "{#greet}")),
    file: `${SECOND}:23`,
    message: /listing "noted" gives note "greet" twice/,
  },
  {
    rule: "a note without text fails",
    change: interactiveChapter((t) => t.replace("::note[The third prints the greeting.]{#print}", "::note{#print}")),
    file: `${SECOND}:23`,
    message: /note "print" needs its text, written ::note\[Text\]\{#print\}/,
  },
  {
    rule: "a file listing that holds anything but notes fails",
    change: interactiveChapter((t) => t.replace(/^(::note\[The third.*)$/m, "$1\nA stray paragraph.")),
    file: `${SECOND}:24`,
    message: /listing "noted" may hold only notes/,
  },
  {
    rule: "a note marker whose id is not kebab-case fails with the file's line",
    change: interactive(noted((t) => t.replace("book:note print", "book:note Print"))),
    file: `${SECOND}:20`,
    message: /listing "noted": verify\/demo-sdk\/examples\/02-notes\.ts:7: book:note needs a kebab-case id/,
  },
  {
    rule: "a note marker on a line of its own fails",
    change: interactive(noted((t) => t.replace("// #region steps\n", "// #region steps\n// book:note alone\n"))),
    file: `${SECOND}:20`,
    message: /02-notes\.ts:5: book:note alone must end the line of code it annotates/,
  },
  {
    rule: "a note marker used twice in one file fails",
    change: interactive(noted((t) => t.replace("book:note print", "book:note name"))),
    file: `${SECOND}:20`,
    message: /02-notes\.ts:7: book:note name appears twice; it is already on line 5/,
  },
  {
    rule: "a replay whose transcript does not exist fails",
    change: interactive((dir) => rmSync(join(dir, TRANSCRIPT))),
    file: `${SECOND}:20`,
    message: /replay needs verify\/demo-sdk\/results\/transcripts\/02-notes\.json, which does not exist/,
  },
  {
    rule: "a replay whose transcript was recorded at another pin fails",
    change: interactive((dir) => edit(dir, TRANSCRIPT, (t) => t.replace("demo-sdk@1.2.3", "demo-sdk@1.2.2"))),
    file: `${SECOND}:20`,
    message:
      /was recorded with demo-sdk@1\.2\.2 and demo-sdk@1\.2\.3, but the harness pins demo-sdk@1\.2\.3 and demo-sdk@1\.2\.3; run verify\/demo-sdk's pnpm test/,
  },
  {
    rule: "a replay whose transcript was recorded with another version of the mock layer's package fails",
    change: interactive((dir) =>
      edit(dir, TRANSCRIPT, (t) => t.replace('"mock": "demo-sdk@1.2.3"', '"mock": "demo-sdk@1.2.0"')),
    ),
    file: `${SECOND}:20`,
    message:
      /was recorded with demo-sdk@1\.2\.3 and demo-sdk@1\.2\.0, but the harness pins demo-sdk@1\.2\.3 and demo-sdk@1\.2\.3/,
  },
  {
    rule: "a replay whose transcript records another file fails",
    change: interactive((dir) =>
      edit(dir, TRANSCRIPT, (t) => t.replace(`"file": "${NOTED}"`, '"file": "verify/demo-sdk/examples/01-hello.ts"')),
    ),
    file: `${SECOND}:20`,
    message:
      /02-notes\.json records verify\/demo-sdk\/examples\/01-hello\.ts, not verify\/demo-sdk\/examples\/02-notes\.ts/,
  },
  {
    rule: "a replay whose transcript is malformed fails",
    change: interactive((dir) => edit(dir, TRANSCRIPT, (t) => JSON.stringify({ ...JSON.parse(t), events: [] }))),
    file: `${SECOND}:20`,
    message: /02-notes\.json is not a transcript: events: /,
  },
  {
    rule: "a replay given a value fails",
    change: interactiveChapter((t) => t.replace('region="steps" replay}', 'region="steps" replay="yes"}')),
    file: `${SECOND}:20`,
    message: /replay takes no value; write \{… replay\}, not replay="yes"/,
  },
  {
    rule: "a tabs block that holds anything but file listings fails",
    change: interactiveChapter((t) => t.replace(/^(::listing\[other-sdk.*)$/m, "$1\nA stray paragraph.")),
    file: `${SECOND}:29`,
    message: /:::tabs may hold only listings of files/,
  },
  {
    rule: "a tabs block with one listing fails",
    change: interactiveChapter((t) => t.replace(/^::listing\[other-sdk.*\n/m, "")),
    file: `${SECOND}:26`,
    message: /:::tabs needs two or more listings, one for each tab/,
  },
  {
    rule: "a tabs block with a caption fails",
    change: interactiveChapter((t) => t.replace(":::tabs\n", ":::tabs[SDKs]\n")),
    file: `${SECOND}:26`,
    message: /:::tabs takes no caption/,
  },
];

const caseDir = mkdtempSync(join(tmpdir(), "book-cases-"));
const dirs: string[] = [caseDir];
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

test("the fixture book with notes, tabs and a replay passes check:book and the build", async () => {
  const dir = resetFixture(caseDir, withInteractive);
  assert.deepEqual(await checkBook(fixtureInputs(dir)), []);
  assert.equal(await buildError(fixtureInputs(dir)), undefined);
});

test("the real book passes check:book", async () => {
  assert.deepEqual((await checkBook()).map(formatProblem), []);
});

for (const { rule, change, outline, file, message } of cases) {
  test(rule, async () => {
    // The cases run one after another in one directory, reset to the fixture before each.
    const dir = resetFixture(caseDir, change ?? (() => undefined));
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
