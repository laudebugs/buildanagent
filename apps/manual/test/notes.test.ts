import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { afterEach, test, vi } from "vitest";
import {
  bestMatch,
  buildAnchor,
  buildIndex,
  CONTEXT,
  cleanNote,
  HIGHLIGHT_NAMES,
  KEY,
  locate,
  MAX_HIGHLIGHTS,
  MAX_NOTE,
  MAX_QUOTE,
  newId,
  parseStored,
  pointOffset,
  proseNodes,
  rawPoint,
  readChapter,
  sectionAt,
  serializeStored,
  start,
  supportsHighlights,
  textOffset,
  toMarkdown,
} from "../public/scripts/notes.js";

// public/scripts/notes.js keeps a reader's highlights and notes on a chapter. Its pure functions (the stored value, the
// joined text, anchors and re-anchoring, the Markdown export) are tested on plain strings, then on happy-dom's DOM for
// a selection across inline elements, then start() runs in a happy-dom window with a stand-in for CSS.highlights, with
// storage working, blocked and throwing, and with every network API set to fail the test.

type Anchor = { quote: string; prefix: string; suffix: string; section: string; offset: number };
type Item = Anchor & { id: string; note: string; at: number };

const stored = (chapters: Record<string, unknown>) => JSON.stringify({ v: 1, chapters });
const item = (fields: Partial<Item> = {}): Item => ({
  id: "abc",
  quote: "a passage",
  prefix: "",
  suffix: "",
  section: "",
  offset: 0,
  note: "",
  at: 1,
  ...fields,
});

test("a stored value that is missing, damaged or of another shape reads as no highlights at all", () => {
  for (const raw of [
    null,
    undefined,
    42,
    "",
    "{",
    "null",
    "[]",
    '"text"',
    '{"v":2,"chapters":{}}',
    '{"chapters":{"tools":[]}}',
    '{"v":1,"chapters":[]}',
    '{"v":1,"chapters":null}',
  ]) {
    assert.equal(parseStored(raw).size, 0, String(raw));
  }
});

test("each malformed chapter or highlight is dropped and the well-formed ones are kept", () => {
  const good = item();
  const chapters = parseStored(
    stored({
      tools: [
        good,
        null,
        "text",
        [],
        { ...good, id: "Bad Id" },
        { ...good, id: "x".repeat(41) },
        { ...good, id: "other", quote: "" },
        { ...good, id: "other", quote: "q".repeat(MAX_QUOTE + 1) },
        { ...good, id: "other", quote: 7 },
        { ...good, id: "other", prefix: null },
        { ...good, id: "other", note: { text: "x" } },
        { ...good, id: "other", section: "has space" },
        { ...good, id: "other", offset: -1 },
        { ...good, id: "other", offset: 1.5 },
        { ...good, id: "other", at: "1" },
        { ...good, quote: "the same id again" },
      ],
      "Not-A-Slug": [good],
      "../evil": [good],
      "memory-and-sessions": { 0: good },
      "call-workflow-loop": [],
    }),
  );
  assert.deepEqual([...chapters.keys()], ["tools"]);
  assert.deepEqual(chapters.get("tools"), [good]);
  const proto = parseStored(stored({ ["__proto__"]: [good] }));
  assert.equal(parseStored('{"v":1,"chapters":{"__proto__":[{"id":"a"}]}}').size, 0, "a __proto__ key is no chapter");
  assert.equal(proto.size, 0);
  assert.equal(({} as Record<string, unknown>).quote, undefined, "and it changes no prototype");
});

test("a stored note, prefix and suffix are cut to their limits, and serializing reads back the same highlights", () => {
  const long = item({
    note: "n".repeat(MAX_NOTE + 50),
    prefix: `${"p".repeat(40)}END`,
    suffix: `START${"s".repeat(40)}`,
  });
  const chapters = parseStored(stored({ tools: [long] }));
  const kept = chapters.get("tools")?.[0];
  assert.equal(kept?.note.length, MAX_NOTE);
  assert.equal(kept?.prefix.length, CONTEXT);
  assert.ok(kept?.prefix.endsWith("END"), "the prefix keeps the characters next to the quote");
  assert.ok(kept?.suffix.startsWith("START"), "the suffix keeps the characters next to the quote");
  assert.deepEqual([...parseStored(serializeStored(chapters))], [...chapters]);
  assert.equal(serializeStored(new Map([["tools", []]])), '{"v":1,"chapters":{}}', "an empty chapter is not written");
});

test("a chapter keeps at most 200 highlights when read", () => {
  const many = Array.from({ length: MAX_HIGHLIGHTS + 5 }, (_, n) => item({ id: `h${n}` }));
  const kept = parseStored(stored({ tools: many })).get("tools") ?? [];
  assert.equal(kept.length, MAX_HIGHLIGHTS);
  assert.equal(kept.at(-1)?.id, `h${MAX_HIGHLIGHTS - 1}`);
});

test("the joined text collapses white space across text nodes and maps every point back", () => {
  const index = buildIndex(["  Tools  ", "\n are ", "contracts.\n", "", "   ", "End"]);
  assert.equal(index.text, "Tools are contracts. End");
  assert.equal(textOffset(index, 0, 0), 0, "leading white space is dropped");
  assert.equal(textOffset(index, 0, 2), 0);
  assert.equal(textOffset(index, 1, 2), 6, "'are' starts after one space");
  assert.equal(textOffset(index, 2, 10), 20);
  assert.equal(textOffset(index, 5, 3), index.text.length);
  assert.equal(textOffset(index, 5, 99), index.text.length, "an offset past a text's end is its end");
  assert.deepEqual(rawPoint(index, 6, "start"), { seg: 1, off: 2 });
  assert.deepEqual(rawPoint(index, 9, "end"), { seg: 1, off: 5 });
  assert.deepEqual(rawPoint(index, index.text.length, "end"), { seg: 5, off: 3 });
  assert.deepEqual(rawPoint(index, index.text.length, "start"), { seg: 5, off: 3 }, "the end of the text");
  assert.deepEqual(rawPoint(index, 0, "end"), { seg: 0, off: 2 });
  assert.equal(rawPoint(buildIndex(["  ", ""]), 0, "start"), undefined);
  assert.equal(buildIndex([]).text, "");
});

const TEXT =
  "Opening words. A tool is a contract. The model reads it. " +
  "Schemas section text: a tool is a contract between your code and a model. " +
  "Errors section text: a tool is a contract, again, said at the end.";
const SECTIONS = [
  { id: "schemas", start: TEXT.indexOf("Schemas") },
  { id: "errors", start: TEXT.indexOf("Errors") },
];

test("a section is the last one starting at or before a position, and none comes before the first heading", () => {
  assert.equal(sectionAt(SECTIONS, 0), -1);
  assert.equal(sectionAt(SECTIONS, SECTIONS[0]?.start ?? 0), 0);
  assert.equal(sectionAt(SECTIONS, TEXT.length), 1);
  assert.equal(sectionAt([], 10), -1);
});

test("an anchor holds the trimmed quote, 32 characters each side, its section and its offset there", () => {
  const start = TEXT.indexOf("a tool is a contract between") - 1;
  const end = TEXT.indexOf(" between") + 1;
  const built = buildAnchor(TEXT, start, end, SECTIONS);
  assert.ok("anchor" in built);
  assert.equal(built.anchor.quote, "a tool is a contract");
  assert.equal(built.anchor.prefix, TEXT.slice(built.start - CONTEXT, built.start));
  assert.equal(built.anchor.suffix, TEXT.slice(built.end, built.end + CONTEXT));
  assert.equal(built.anchor.section, "schemas");
  assert.equal(built.anchor.offset, built.start - (SECTIONS[0]?.start ?? 0));
  const first = buildAnchor(TEXT, 0, 7, SECTIONS);
  assert.ok("anchor" in first);
  assert.deepEqual(first.anchor, { quote: "Opening", prefix: "", suffix: TEXT.slice(7, 39), section: "", offset: 0 });
  assert.deepEqual(buildAnchor(TEXT, 9, 9, SECTIONS), { reason: "empty" });
  assert.deepEqual(buildAnchor("a    b", 1, 5, []), { reason: "empty" }, "a selection of spaces is empty");
  assert.deepEqual(buildAnchor("x".repeat(MAX_QUOTE + 1), 0, MAX_QUOTE + 1, []), { reason: "long" });
  const reversed = buildAnchor(TEXT, 7, 0, SECTIONS);
  assert.ok("anchor" in reversed && reversed.anchor.quote === "Opening", "a backwards selection reads forwards");
});

function anchorAt(text: string, quote: string, from: number, sections = SECTIONS): Anchor {
  const start = text.indexOf(quote, from);
  const built = buildAnchor(text, start, start + quote.length, sections);
  assert.ok("anchor" in built, quote);
  return built.anchor;
}

test("an unchanged chapter finds each repeat of a quote where it was made, by its context", () => {
  const quote = "a tool is a contract";
  for (const from of [0, SECTIONS[0]?.start ?? 0, SECTIONS[1]?.start ?? 0]) {
    const anchor = anchorAt(TEXT, quote, from);
    const found = locate(TEXT, anchor, SECTIONS);
    assert.deepEqual(found, {
      start: TEXT.indexOf(quote, from),
      end: TEXT.indexOf(quote, from) + quote.length,
      status: "found",
    });
  }
  // "A tool" at the start differs in case, so the first repeat of the lower-case quote is in the schemas section.
  assert.notEqual(TEXT.indexOf(quote), TEXT.indexOf("A tool"));
});

test("among repeats with the same context, the one nearest the stored offset wins", () => {
  const text = "x. same same same. y";
  const anchor = { quote: "same", prefix: "", suffix: "", section: "", offset: 8 };
  assert.deepEqual(bestMatch(text, [3, 8, 13], anchor, 0), { start: 8, exact: true, preferred: true });
  assert.deepEqual(
    bestMatch(text, [3, 8, 13], anchor, 0, (start) => start === 13),
    { start: 13, exact: true, preferred: true },
    "on equal context the preferred section wins before the offset",
  );
  assert.equal(bestMatch(text, [], anchor, 0), undefined);
});

test("a paragraph moved to another section is found there by its context, though a similar sentence stays behind", () => {
  const quote = "the model reads it";
  const before =
    "Intro. Schemas: first the model reads it slowly and then acts. Errors: nothing here yet about the topic.";
  const sectionsBefore = [
    { id: "schemas", start: before.indexOf("Schemas") },
    { id: "errors", start: before.indexOf("Errors") },
  ];
  const anchor = anchorAt(before, quote, 0, sectionsBefore);
  assert.equal(anchor.section, "schemas");
  // The paragraph moved under Errors; Schemas keeps a sentence with the same words in other context.
  const after =
    "Intro. Schemas: here too the model reads it, briefly. Errors: first the model reads it slowly and then acts.";
  const sectionsAfter = [
    { id: "schemas", start: after.indexOf("Schemas") },
    { id: "errors", start: after.indexOf("Errors") },
  ];
  const found = locate(after, anchor, sectionsAfter);
  assert.equal(found.status, "moved", "the winner sits outside the stored section");
  assert.equal(found.start, after.lastIndexOf(quote), "the exact context in Errors beats the repeat in Schemas");
  const unchanged = locate(before, anchor, sectionsBefore);
  assert.deepEqual(unchanged, {
    start: before.indexOf(quote),
    end: before.indexOf(quote) + quote.length,
    status: "found",
  });
});

test("text edited around a quote, in front of its section or across sections marks the highlight moved", () => {
  const quote = "a tool is a contract between your code";
  const anchor = anchorAt(TEXT, quote, 0);
  const edited = TEXT.replace("Schemas section text:", "The schemas section, reworded:");
  const sections = [
    { id: "schemas", start: edited.indexOf("The schemas") },
    { id: "errors", start: edited.indexOf("Errors") },
  ];
  const moved = locate(edited, anchor, sections);
  assert.equal(moved.status, "moved");
  assert.ok("start" in moved && edited.slice(moved.start, moved.end) === quote);
  const added = `A new opening paragraph. ${TEXT}`;
  const shifted = locate(
    added,
    anchor,
    SECTIONS.map((section) => ({ ...section, start: section.start + 25 })),
  );
  assert.equal(shifted.status, "found", "text added before the section leaves the anchor intact");
  const renamed = locate(TEXT, { ...anchor, section: "a-renamed-heading" }, [{ id: "other", start: 0 }]);
  assert.equal(renamed.status, "moved", "a heading id the chapter lost sends the search to the whole article");
  assert.ok("start" in renamed && TEXT.slice(renamed.start, renamed.end) === quote);
});

test("a quote whose own words changed is found by its context, and one the chapter lost is lost", () => {
  const quote = "between your code and a model";
  const anchor = anchorAt(TEXT, quote, 0);
  const reworded = TEXT.replace("between your code and a model", "between your program and a model");
  const found = locate(reworded, anchor, SECTIONS);
  assert.equal(found.status, "moved");
  assert.equal(reworded.slice(found.start, found.end), "between your program and a model");
  const removed = TEXT.replace("Schemas section text: a tool is a contract between your code and a model. ", "");
  assert.deepEqual(locate(removed, anchor, SECTIONS), { status: "lost" });
  assert.deepEqual(locate("", anchor, []), { status: "lost" });
});

test("hostile anchors and text are searched as plain text and never throw", () => {
  const text = "Use .*+?^$" + "{}()|[]\\ literally, and <img src=x onerror=alert(1)> as text.";
  const quote = ".*+?^$" + "{}()|[]\\";
  const anchor = anchorAt(text, quote, 0, []);
  assert.equal(locate(text, anchor, []).status, "found");
  assert.deepEqual(locate(text, { ...anchor, quote: "" }, []), { status: "lost" });
  assert.deepEqual(locate(text, { ...anchor, quote: "not here at all" }, []), { status: "lost" });
  const huge = "word ".repeat(40_000);
  const repeated = { quote: "word", prefix: "word ".repeat(7), suffix: " word", section: "", offset: 100_000 };
  assert.equal(locate(huge, repeated, []).status, "found", "a quote repeated 40,000 times is still placed");
});

test("a note is trimmed and cut to 500 characters, and a new id is short, lower-case and base 36", () => {
  assert.equal(cleanNote("  hello \n"), "hello");
  assert.equal(cleanNote("x".repeat(600)).length, MAX_NOTE);
  const id = newId(1_795_337_471_468, 0.123456);
  assert.match(id, /^[a-z0-9]{1,40}$/);
  assert.notEqual(newId(1, 0.1), newId(1, 0.2));
});

test("the Markdown export quotes each passage with its note and says which passages the chapter lost", () => {
  const markdown = toMarkdown("Tools:\n schemas", "https://manual.buildanagent.fyi/tools/", [
    { quote: "a tool\nis a contract", note: "Remember this.\nTwo lines.", status: "found" },
    { quote: "an old sentence", note: "", status: "lost" },
  ]);
  assert.equal(
    markdown,
    [
      "# Notes on Tools: schemas",
      "",
      "From <https://manual.buildanagent.fyi/tools/>, exported from this browser.",
      "",
      "> a tool is a contract",
      "",
      "Note:",
      "",
      "> Remember this.",
      "> Two lines.",
      "",
      "---",
      "",
      "> an old sentence",
      "",
      "_This passage is no longer in the chapter._",
      "",
      "---",
      "",
    ].join("\n"),
  );
  assert.match(toMarkdown("T", "u", []), /No highlights yet\.\n$/);
});

test("a note's lines stay text in the export: no heading, list, rule, fence, table or HTML block, and blank lines kept", () => {
  const note = [
    "# not a heading",
    "---",
    "===",
    "- not a list",
    "+ nor this",
    "* nor this",
    "1. nor this",
    "2) nor this",
    "> not a quote",
    "```js",
    "~~~",
    "| a | b |",
    "<img src=x onerror=alert(1)>",
    "    indented code",
    "",
    "back\\slash and *stars* stay",
  ].join("\n");
  const markdown = toMarkdown("T", "u", [{ quote: "# a quote", note, status: "found" }]);
  const body = markdown.split("Note:\n\n")[1]?.split("\n\n---")[0];
  assert.equal(
    body,
    [
      "> \\# not a heading",
      "> \\---",
      "> \\===",
      "> \\- not a list",
      "> \\+ nor this",
      "> \\* nor this",
      "> 1\\. nor this",
      "> 2\\) nor this",
      "> \\> not a quote",
      "> \\```js",
      "> \\~~~",
      "> \\| a | b |",
      "> \\<img src=x onerror=alert(1)>",
      "> indented code",
      ">",
      "> back\\\\slash and *stars* stay",
    ].join("\n"),
  );
  assert.match(markdown, /\n> \\# a quote\n/, "the quote is escaped the same way");
});

test("a CommonMark parser reads the hostile note as two paragraphs of text inside one quotation", () => {
  const note = "# h\n---\n- l\n1. n\n> q\n```\n<b>x</b>\n| a | b |\n\nafter the blank line";
  const tree = unified()
    .use(remarkParse)
    .parse(toMarkdown("T", "u", [{ quote: "q", note, status: "found" }]));
  const types = (node: { type: string; children?: unknown[] }): string[] => [
    node.type,
    ...((node.children ?? []) as { type: string; children?: unknown[] }[]).flatMap(types),
  ];
  const quotes = (tree.children as { type: string; children?: unknown[] }[]).filter(
    (node) => node.type === "blockquote",
  );
  assert.equal(quotes.length, 2, "the passage and the note");
  const noteQuote = quotes[1] as { type: string; children: { type: string }[] };
  assert.deepEqual(
    noteQuote.children.map((child) => child.type),
    ["paragraph", "paragraph"],
  );
  assert.deepEqual(
    types(noteQuote).filter((type) => !["blockquote", "paragraph", "text"].includes(type)),
    [],
    "no heading, list, rule, code, HTML or table",
  );
});

const CHAPTER = `
  <h1>Tools</h1>
  <article class="article" data-pagefind-body data-reading-chapter="tools">
    <p>Opening paragraph.</p>
    <h2 id="schemas">Schemas</h2>
    <p>A tool <em>is</em> a <code>contract</code> with a
       <span class="glossary-term"><a href="/glossary/#tool">model</a><span class="glossary-card" aria-hidden="true" data-pagefind-ignore>A hidden definition.</span></span>
       that reads <a href="/x/">the schema</a> only.</p>
    <figure class="listing"><pre><code>const tool = 1;</code></pre></figure>
    <div class="tabs"><div role="tablist"><button>pi</button></div><h3 class="tabs__heading" id="lst-a-heading">pi</h3></div>
    <h2 id="errors">Errors</h2>
    <p>A failed call comes back as a message. A failed call comes back again.</p>
  </article>`;

test("the chapter's prose leaves out figures, controls and hidden glossary cards, and sections start at headings", () => {
  const win = track(new Window());
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = CHAPTER;
  const article = doc.querySelector("article") as Element;
  const text = buildIndex(proseNodes(article).map((node) => node.data)).text;
  assert.equal(
    text,
    "Opening paragraph. Schemas A tool is a contract with a model that reads the schema only. pi Errors A failed call comes back as a message. A failed call comes back again. ",
    "white space collapses to one space, the last one included",
  );
  const chapter = readChapter(article);
  assert.deepEqual(chapter.sections, [
    { id: "schemas", start: text.indexOf("Schemas") },
    { id: "errors", start: text.indexOf("Errors") },
  ]);
});

test("a selection across em, code and links maps to the text a reader sees, and element points map to the next text", () => {
  const win = track(new Window());
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = CHAPTER;
  const article = doc.querySelector("article") as Element;
  const chapter = readChapter(article);
  const em = doc.querySelector("em")?.firstChild as Node;
  const link = doc.querySelector('a[href="/x/"]')?.firstChild as Node;
  const start = chapter.position(em, 0);
  const end = chapter.position(link, 3);
  const built = buildAnchor(chapter.index.text, start, end, chapter.sections);
  assert.ok("anchor" in built);
  assert.equal(built.anchor.quote, "is a contract with a model that reads the");
  assert.equal(built.anchor.section, "schemas");
  const paragraph = doc.querySelectorAll("article p")[1] as Element;
  assert.equal(pointOffset(chapter.index, chapter.nodes, paragraph, 0), chapter.index.text.indexOf("A tool"));
  const card = doc.querySelector(".glossary-card")?.firstChild as Node;
  assert.equal(chapter.position(card, 4), chapter.index.text.indexOf(" that reads"), "a point in a hidden card");
  assert.equal(chapter.position(article, article.childNodes.length), chapter.index.text.length);
  const range = doc.createRange();
  const from = rawPoint(chapter.index, built.start, "start");
  const to = rawPoint(chapter.index, built.end, "end");
  assert.ok(from && to);
  range.setStart(chapter.nodes[from.seg] as Node, from.off);
  range.setEnd(chapter.nodes[to.seg] as Node, to.off);
  assert.equal(range.startContainer, em);
  assert.equal(range.endContainer, link);
  assert.equal(range.endOffset, 3);
});

let requests: string[] = [];
const windows: Window[] = [];

/** A happy-dom window that afterEach closes, whichever test made it. */
function track(win: Window): Window {
  windows.push(win);
  return win;
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((win) => win.happyDOM.close()));
  vi.restoreAllMocks();
});

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

function page(options: { highlights?: boolean; storage?: "blocked"; items?: unknown[] } = {}): Window {
  requests = [];
  const win = track(new Window({ url: "https://manual.buildanagent.fyi/tools/" }));
  win.document.body.innerHTML = CHAPTER;
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      requests.push(`${name} ${String(args[0])}`);
      throw new Error(`${name} is not allowed`);
    };
  for (const name of ["fetch", "WebSocket", "EventSource"]) {
    Object.defineProperty(win, name, { configurable: true, value: record(name) });
  }
  Object.defineProperty(win.navigator, "sendBeacon", { configurable: true, value: record("sendBeacon") });
  vi.spyOn(win.XMLHttpRequest.prototype, "open").mockImplementation(record("XMLHttpRequest"));
  if (options.highlights !== false) {
    Object.defineProperty(win, "CSS", { configurable: true, value: { highlights: new Map() } });
    Object.defineProperty(win, "Highlight", { configurable: true, value: FakeHighlight });
  }
  if (options.items) win.localStorage.setItem(KEY, stored({ tools: options.items }));
  if (options.storage === "blocked") {
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      get() {
        throw new win.DOMException("The operation is insecure.", "SecurityError");
      },
    });
  }
  return win;
}

const q = <T extends Element>(win: Window, selector: string) =>
  (win.document as unknown as Document).querySelector<T>(selector);
const painted = (win: Window, name: string) =>
  ((win as unknown as { CSS: { highlights: Map<string, FakeHighlight> } }).CSS.highlights.get(name)?.ranges ?? []).map(
    (range) => range.toString().replace(/\s+/g, " "),
  );

test("without CSS.highlights or with storage blocked, the page gains nothing and nothing throws", () => {
  for (const win of [page({ highlights: false }), page({ storage: "blocked" })]) {
    const before = win.document.body.innerHTML;
    assert.doesNotThrow(() => start(win as unknown as globalThis.Window));
    assert.equal(win.document.body.innerHTML, before);
  }
  assert.equal(supportsHighlights(page({ highlights: false }) as unknown as globalThis.Window), false);
  assert.equal(supportsHighlights(page() as unknown as globalThis.Window), true);
  const other = page();
  other.document.querySelector("article")?.removeAttribute("data-reading-chapter");
  const before = other.document.body.innerHTML;
  start(other as unknown as globalThis.Window);
  assert.equal(other.document.body.innerHTML, before, "a page that is no chapter gains nothing");
});

const ITEMS = [
  item({ id: "one", quote: "a contract with a model", section: "schemas", offset: 13 }),
  item({
    id: "two",
    quote: "A failed call comes back again",
    section: "errors",
    note: '<img src=x onerror="alert(1)">',
  }),
  item({ id: "gone", quote: "a sentence the chapter lost", note: "Still mine." }),
];

test("a chapter draws its stored highlights and lists every one, a lost one with its text, writing notes as text", () => {
  const win = page({ items: ITEMS });
  start(win as unknown as globalThis.Window);
  assert.deepEqual(painted(win, HIGHLIGHT_NAMES.plain), ["a contract with a model"]);
  assert.deepEqual(painted(win, HIGHLIGHT_NAMES.noted), ["A failed call comes back again"]);
  const open = q<HTMLButtonElement>(win, ".notes-open");
  assert.equal(open?.getAttribute("aria-label"), "Notes, 3 saved");
  assert.ok(open?.closest("[data-pagefind-ignore]"), "the button is outside the search index");
  assert.equal(q(win, "article [data-notes-ui]"), null, "nothing is added inside the article");
  open?.click();
  const rows = [...(win.document as unknown as Document).querySelectorAll(".notes-dialog__item")];
  assert.deepEqual(
    rows.map((row) => row.getAttribute("data-id")),
    ["one", "two", "gone"],
    "in chapter order, the lost one last",
  );
  assert.equal(q(win, ".notes-dialog img"), null, "a note's markup stays text");
  assert.equal(rows[1]?.querySelector(".notes-dialog__note")?.textContent, '<img src=x onerror="alert(1)">');
  assert.match(rows[2]?.textContent ?? "", /a sentence the chapter lost.*Not found.*Still mine\./s);
  assert.equal(rows[2]?.querySelector("button")?.textContent, "Edit note", "a lost passage has no Go to button");
  assert.deepEqual(requests, []);
});

test("deleting and editing in the panel write the chapter's list and keep other chapters", () => {
  const win = page();
  win.localStorage.setItem(KEY, stored({ tools: ITEMS, "call-workflow-loop": [item({ id: "kept" })] }));
  start(win as unknown as globalThis.Window);
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  const row = (id: string) =>
    [...(win.document as unknown as Document).querySelectorAll(".notes-dialog__item")].find(
      (found) => found.getAttribute("data-id") === id,
    );
  const button = (id: string, label: string) =>
    [...(row(id)?.querySelectorAll("button") ?? [])].find((found) => found.textContent === label) as HTMLButtonElement;
  button("one", "Delete").click();
  const afterDelete = parseStored(win.localStorage.getItem(KEY));
  assert.deepEqual(
    afterDelete.get("tools")?.map((found) => found.id),
    ["two", "gone"],
  );
  assert.equal(afterDelete.get("call-workflow-loop")?.[0]?.id, "kept");
  assert.deepEqual(painted(win, HIGHLIGHT_NAMES.plain), []);
  button("gone", "Edit note").click();
  const field = q<HTMLTextAreaElement>(win, ".notes-dialog__form textarea");
  assert.ok(field);
  field.value = `  A new note.\n${"y".repeat(400)}  `;
  q<HTMLButtonElement>(win, ".notes-dialog__form button[type='submit']")?.click();
  assert.equal(parseStored(win.localStorage.getItem(KEY)).get("tools")?.[1]?.note, `A new note.\n${"y".repeat(400)}`);
  assert.equal(win.document.activeElement?.textContent, "Edit note", "focus returns to the edited note's row");
  assert.deepEqual(requests, []);
});

test("export writes the chapter's Markdown into a visible field when the clipboard is missing", () => {
  const win = page({ items: ITEMS });
  Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: undefined });
  start(win as unknown as globalThis.Window);
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  const exportButton = [...(win.document as unknown as Document).querySelectorAll(".notes-dialog button")].find(
    (found) => found.textContent === "Export as Markdown",
  ) as HTMLButtonElement;
  exportButton.click();
  const field = q<HTMLTextAreaElement>(win, "#notes-export");
  assert.equal(field?.closest("[hidden]"), null);
  assert.match(field?.value ?? "", /^# Notes on Tools\n\nFrom <https:\/\/manual\.buildanagent\.fyi\/tools\/>/);
  assert.match(field?.value ?? "", /> a contract with a model\n/);
  assert.match(q(win, ".notes-dialog__export")?.textContent ?? "", /Select the Markdown below and copy it\./);
  assert.deepEqual(requests, []);
});

function select(win: Window, from: Node, fromOffset: number, to: Node, toOffset: number) {
  const doc = win.document as unknown as Document;
  const range = doc.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const selection = (win as unknown as globalThis.Window).getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

test("the shortcut shows the toolbar on a selection in the article, and Highlight stores and draws it", () => {
  const win = page();
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  win.document.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, bubbles: true }),
  );
  const toolbar = q<HTMLElement>(win, ".notes-toolbar");
  assert.equal(toolbar?.hidden, false);
  assert.equal(win.document.activeElement?.textContent, "Highlight", "the shortcut moves focus into the toolbar");
  (win.document.activeElement as unknown as HTMLButtonElement).click();
  const items = parseStored(win.localStorage.getItem(KEY)).get("tools") ?? [];
  assert.equal(items[0]?.quote, "failed call");
  assert.equal(items[0]?.section, "errors");
  assert.deepEqual(painted(win, HIGHLIGHT_NAMES.plain), ["failed call"]);
  assert.equal(toolbar?.hidden, true);
  assert.deepEqual(requests, []);
});

test("a full chapter and a selection past 1,000 characters explain why the toolbar's buttons are off", () => {
  const full = Array.from({ length: MAX_HIGHLIGHTS }, (_, n) => item({ id: `h${n}` }));
  const win = page({ items: full });
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  win.document.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, bubbles: true }),
  );
  assert.equal(q<HTMLButtonElement>(win, ".notes-toolbar button")?.disabled, true);
  assert.match(q(win, ".notes-toolbar__message")?.textContent ?? "", /already holds 200 highlights/);
  const long = page();
  const article = q(long, "article");
  const p = long.document.createElement("p");
  p.textContent = "word ".repeat(300);
  article?.append(p as unknown as Node);
  start(long as unknown as globalThis.Window);
  select(long, p.firstChild as unknown as Node, 0, p.firstChild as unknown as Node, 1400);
  long.document.dispatchEvent(
    new long.KeyboardEvent("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, bubbles: true }),
  );
  assert.match(q(long, ".notes-toolbar__message")?.textContent ?? "", /Select a shorter passage/);
});

test("a chapter page reads as usual when storage throws on every write, and says the note was not kept", () => {
  const win = page();
  vi.spyOn(win.localStorage, "setItem").mockImplementation(() => {
    throw new win.DOMException("full", "QuotaExceededError");
  });
  assert.doesNotThrow(() => start(win as unknown as globalThis.Window));
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  win.document.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, bubbles: true }),
  );
  assert.doesNotThrow(() => (win.document.activeElement as unknown as HTMLButtonElement).click());
  assert.match(q(win, "[role='status'].visually-hidden")?.textContent ?? "", /would not save the change/);
  assert.equal(q<HTMLElement>(win, ".notes-toolbar")?.hidden, false, "the toolbar stays open");
  assert.match(visibleMessage(win), /would not save the change/, "and shows why");
  assert.deepEqual(painted(win, HIGHLIGHT_NAMES.plain), []);
});

/** The toolbar's message, when the reader can see it. */
function visibleMessage(win: Window): string {
  const message = q<HTMLElement>(win, ".notes-toolbar__message");
  return message && !message.hidden && message.closest("[hidden]") === null ? (message.textContent ?? "") : "";
}

function shortcut(win: Window) {
  win.document.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, bubbles: true }),
  );
}

const toolbarButton = (win: Window, label: string) =>
  [...(win.document as unknown as Document).querySelectorAll<HTMLButtonElement>(".notes-toolbar button")].find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement;

test("highlighting a passage twice keeps the toolbar open and says so in view, with the panel closed", () => {
  const win = page();
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Highlight").click();
  assert.equal(q<HTMLElement>(win, ".notes-toolbar")?.hidden, true, "a saved highlight closes the toolbar");
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Highlight").click();
  assert.equal(q<HTMLElement>(win, ".notes-toolbar")?.hidden, false);
  assert.equal(visibleMessage(win), "That passage is already highlighted.");
  assert.equal(parseStored(win.localStorage.getItem(KEY)).get("tools")?.length, 1);
});

test("at the cap a passage already highlighted still takes a note, and only a new highlight is refused", () => {
  const first = page();
  start(first as unknown as globalThis.Window);
  const firstParagraph = q(first, "article p:last-of-type")?.firstChild as Node;
  select(first, firstParagraph, 2, firstParagraph, 13);
  shortcut(first);
  toolbarButton(first, "Highlight").click();
  const made = parseStored(first.localStorage.getItem(KEY)).get("tools")?.[0];
  assert.ok(made);
  const fillers = Array.from({ length: MAX_HIGHLIGHTS - 1 }, (_, n) => item({ id: `f${n}`, quote: `gone ${n}` }));
  const win = page({ items: [made, ...fillers] });
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  assert.equal(toolbarButton(win, "Add note").disabled, false, "the highlighted passage can take a note");
  assert.equal(visibleMessage(win), "");
  toolbarButton(win, "Add note").click();
  const field = q<HTMLTextAreaElement>(win, "#notes-field");
  assert.ok(field);
  field.value = "A note at the cap.";
  q<HTMLButtonElement>(win, ".notes-dialog__form button[type='submit']")?.click();
  const items = parseStored(win.localStorage.getItem(KEY)).get("tools") ?? [];
  assert.equal(items.length, MAX_HIGHLIGHTS);
  assert.equal(items.find((found) => found.id === made.id)?.note, "A note at the cap.");
  q<HTMLButtonElement>(win, ".notes-dialog__head button")?.click();
  select(win, paragraph, 40, paragraph, 51);
  shortcut(win);
  assert.equal(toolbarButton(win, "Highlight").disabled, true, "a new passage is refused");
  assert.match(visibleMessage(win), /already holds 200 highlights/);
});

test("the chapter's text model is built once per page state and again after the article changes", () => {
  const win = page({ items: ITEMS });
  const walkers = vi.spyOn(win.document, "createTreeWalker");
  start(win as unknown as globalThis.Window);
  assert.equal(walkers.mock.calls.length, 1, "drawing the stored highlights builds it");
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  for (const end of [13, 20, 30]) {
    select(win, paragraph, 2, paragraph, end);
    shortcut(win);
    (win.document.activeElement as unknown as HTMLElement | null)?.blur?.();
  }
  toolbarButton(win, "Highlight").click();
  assert.equal(walkers.mock.calls.length, 1, "selections and a saved highlight reuse it");
  q(win, "article p")?.append(win.document.createTextNode(" More words.") as unknown as Node);
  select(win, paragraph, 2, paragraph, 9);
  shortcut(win);
  assert.equal(walkers.mock.calls.length, 2, "a changed article is read again");
  assert.equal(q<HTMLElement>(win, ".notes-toolbar")?.hidden, false);
});

test("a change from another tab redraws the panel and keeps focus on the same control of the same row", () => {
  const win = page({ items: ITEMS });
  start(win as unknown as globalThis.Window);
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  const deleteOf = (id: string) =>
    (win.document as unknown as Document).querySelector<HTMLButtonElement>(
      `.notes-dialog__item[data-id="${id}"] [data-action="delete"]`,
    );
  deleteOf("two")?.focus();
  const before = deleteOf("two");
  // Another tab deleted "one".
  win.localStorage.setItem(KEY, stored({ tools: ITEMS.filter((found) => found.id !== "one") }));
  const event = new win.Event("storage");
  Object.defineProperty(event, "key", { value: KEY });
  win.dispatchEvent(event);
  assert.equal(q(win, '.notes-dialog__item[data-id="one"]'), null, "the list shows the stored notes");
  assert.notEqual(deleteOf("two"), before, "the row was rendered again");
  assert.equal(win.document.activeElement, deleteOf("two"));
});

test("the script names no API that can reach the network and writes no markup", () => {
  const source = readFileSync(new URL("../public/scripts/notes.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(|new Image|\.src\s*=|document\.cookie|analytics/,
  );
  assert.deepEqual(source.match(/navigator\.\w+/g), ["navigator.clipboard"], "the clipboard is its only navigator API");
  assert.doesNotMatch(
    source,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.style\s*=|setAttribute\("style"/,
  );
});
