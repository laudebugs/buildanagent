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
  highlightName,
  KEY,
  locate,
  MAX_HIGHLIGHTS,
  MAX_NOTE,
  MAX_QUOTE,
  newId,
  parseStored,
  pointOffset,
  proseNodes,
  REPAINT_MS,
  rawPoint,
  readChapter,
  sectionAt,
  serializeStored,
  shareLink,
  shareText,
  start,
  storedKind,
  supportsHighlights,
  textDirective,
  textOffset,
  toMarkdown,
} from "../public/scripts/notes.js";

// public/scripts/notes.js keeps a reader's highlights and notes on a chapter. Its pure functions (the stored value, the
// joined text, anchors and re-anchoring, the Markdown export) are tested on plain strings, then on happy-dom's DOM for
// a selection across inline elements, then start() runs in a happy-dom window with a stand-in for CSS.highlights, with
// storage working, blocked and throwing, and with every network API set to fail the test.

type Anchor = { quote: string; prefix: string; suffix: string; section: string; offset: number };
type Item = Anchor & { id: string; note: string; at: number; color: string };

/** The names an amber highlight takes, with and without a note: the colour a highlight has before a reader picks one. */
const PLAIN = highlightName("amber", false);
const NOTED = highlightName("amber", true);

const stored = (chapters: Record<string, unknown>, v = 2) => JSON.stringify({ v, chapters });
const item = (fields: Partial<Item> = {}): Item => ({
  id: "abc",
  quote: "a passage",
  prefix: "",
  suffix: "",
  section: "",
  offset: 0,
  note: "",
  at: 1,
  color: "amber",
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
    '{"v":3,"chapters":{"tools":[]}}',
    '{"v":0,"chapters":{}}',
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
  assert.equal(serializeStored(new Map([["tools", []]])), '{"v":2,"chapters":{}}', "an empty chapter is not written");
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

test("a note's lines stay text in the export: every marker that could start a block or an inline is escaped", () => {
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
    "back\\slash, *stars*, _under_, `code`, [t](u), ![i](u), &amp; and a-b stay",
    "[ref]: http://example.com",
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
      "> \\`\\`\\`js",
      "> \\~\\~\\~",
      "> \\| a \\| b \\|",
      "> \\<img src=x onerror=alert(1)>",
      "> indented code",
      ">",
      "> back\\\\slash, \\*stars\\*, \\_under\\_, \\`code\\`, \\[t\\](u), \\!\\[i\\](u), \\&amp; and a-b stay",
      "> \\[ref\\]: http://example.com",
    ].join("\n"),
  );
  assert.match(markdown, /\n> \\# a quote\n/, "the quote is escaped the same way");
});

test("a CommonMark parser reads a hostile note as plain text inside one quotation, with no link, code or emphasis", () => {
  const note = [
    "# h",
    "---",
    "- l",
    "1. n",
    "> q",
    "```",
    "<b>x</b>",
    "| a | b |",
    "[t](http://x) ![i](http://x) <http://x> `c` *e* **s** _u_ &amp; &#65;",
    "[ref]: http://example.com",
    "[ref]",
    "",
    "after the blank line",
  ].join("\n");
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
    "no heading, list, rule, code, HTML, link, image, definition, emphasis or strong",
  );
  assert.deepEqual(
    (tree.children as { type: string }[]).filter((node) => node.type === "definition"),
    [],
  );
  const text = JSON.stringify(noteQuote);
  assert.match(text, /&amp; &#65;/, "entities stay as written");
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
  // happy-dom shares element classes between windows, so a popover method defined for one test must go.
  for (const win of popoverWindows.splice(0)) {
    for (const name of ["showPopover", "hidePopover"]) {
      Reflect.deleteProperty(win.HTMLElement.prototype, name);
    }
  }
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
  assert.deepEqual(painted(win, PLAIN), ["a contract with a model"]);
  assert.deepEqual(painted(win, NOTED), ["A failed call comes back again"]);
  const open = q<HTMLButtonElement>(win, ".notes-open");
  assert.equal(open?.getAttribute("aria-label"), "Notes, 3 saved");
  assert.ok(open?.closest("[data-pagefind-ignore]"), "the button is outside the search index");
  assert.equal(
    q(win, "article [data-notes-ui]:not(.notes-dot)"),
    null,
    "only a note\u2019s dot is added inside the article",
  );
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
  assert.deepEqual(painted(win, PLAIN), []);
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
  assert.equal(win.document.activeElement?.textContent, "Amber", "the shortcut moves focus into the toolbar");
  (win.document.activeElement as unknown as HTMLButtonElement).click();
  const items = parseStored(win.localStorage.getItem(KEY)).get("tools") ?? [];
  assert.equal(items[0]?.quote, "failed call");
  assert.equal(items[0]?.section, "errors");
  assert.deepEqual(painted(win, PLAIN), ["failed call"]);
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
  assert.deepEqual(painted(win, PLAIN), []);
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

test("a colour button on a passage already highlighted recolours it and adds no second highlight", () => {
  const win = page();
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Amber").click();
  assert.equal(q<HTMLElement>(win, ".notes-toolbar")?.hidden, true, "a saved highlight closes the toolbar");
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Green").click();
  const saved = parseStored(win.localStorage.getItem(KEY)).get("tools");
  assert.equal(saved?.length, 1);
  assert.equal(saved?.[0]?.color, "green");
  assert.equal(q<HTMLElement>(win, ".notes-toolbar")?.hidden, true);
});

test("at the cap a passage already highlighted still takes a note, and only a new highlight is refused", () => {
  const first = page();
  start(first as unknown as globalThis.Window);
  const firstParagraph = q(first, "article p:last-of-type")?.firstChild as Node;
  select(first, firstParagraph, 2, firstParagraph, 13);
  shortcut(first);
  toolbarButton(first, "Amber").click();
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
  // The note's dot split the paragraph's text after offset 13, so the later words are in the node after the dot.
  const rest = q(win, "article p:last-of-type")?.lastChild as Node;
  select(win, rest, 27, rest, 38);
  shortcut(win);
  assert.equal(toolbarButton(win, "Amber").disabled, true, "a new passage is refused");
  assert.match(visibleMessage(win), /already holds 200 highlights/);
});

test("the chapter's text model is built once per page state and again after the article changes", () => {
  const win = page({ items: ITEMS });
  const walkers = vi.spyOn(win.document, "createTreeWalker");
  start(win as unknown as globalThis.Window);
  assert.equal(walkers.mock.calls.length, 1, "drawing the stored highlights builds it");
  // A wide window draws margin markers and changes no node, so the model stays as it was read.
  const afterStart = walkers.mock.calls.length;
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  for (const end of [13, 20, 30]) {
    select(win, paragraph, 2, paragraph, end);
    shortcut(win);
    (win.document.activeElement as unknown as HTMLElement | null)?.blur?.();
  }
  assert.equal(walkers.mock.calls.length, afterStart, "selections reuse the reading of the article");
  const beforeEdit = walkers.mock.calls.length;
  q(win, "article p")?.append(win.document.createTextNode(" More words.") as unknown as Node);
  select(win, paragraph, 2, paragraph, 9);
  shortcut(win);
  assert.equal(walkers.mock.calls.length, beforeEdit + 1, "a changed article is read again");
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
  assert.ok(
    (source.match(/navigator\.\w+/g) ?? []).every((found) => found === "navigator.clipboard"),
    "the clipboard is its only navigator API",
  );
  assert.doesNotMatch(
    source,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.style\s*=|setAttribute\("style"/,
  );
});

/** Tells the page another tab changed the stored notes, as a browser's storage event does. */
function fromAnotherTab(win: Window, chapters: Record<string, unknown>) {
  win.localStorage.setItem(KEY, stored(chapters));
  const event = new win.Event("storage");
  Object.defineProperty(event, "key", { value: KEY });
  win.dispatchEvent(event);
}

const noteForm = (win: Window) => ({
  field: q<HTMLTextAreaElement>(win, "#notes-field") as HTMLTextAreaElement,
  save: () => q<HTMLButtonElement>(win, ".notes-dialog__form button[type='submit']")?.click(),
  open: () => q<HTMLElement>(win, ".notes-dialog__form")?.hidden === false,
});
const panelStatus = (win: Window) => q(win, ".notes-dialog__status")?.textContent ?? "";
const rowButton = (win: Window, id: string, action: string) =>
  q<HTMLButtonElement>(win, `.notes-dialog__item[data-id="${id}"] [data-action="${action}"]`) as HTMLButtonElement;

test("a note on a highlight another tab deleted keeps the typed text, says so, and the next save adds it back", () => {
  const win = page({ items: ITEMS });
  start(win as unknown as globalThis.Window);
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  rowButton(win, "two", "edit").click();
  const form = noteForm(win);
  form.field.value = "Typed before the other tab deleted it.";
  fromAnotherTab(win, { tools: ITEMS.filter((found) => found.id !== "two") });
  assert.equal(form.open(), true, "the form stays open");
  assert.match(panelStatus(win), /That highlight was deleted/);
  assert.equal(form.field.value, "Typed before the other tab deleted it.");
  form.save();
  const items = parseStored(win.localStorage.getItem(KEY)).get("tools") ?? [];
  const back = items.find((found) => found.quote === "A failed call comes back again");
  assert.equal(back?.note, "Typed before the other tab deleted it.", "the second save adds the highlight back");
  assert.notEqual(back?.id, "two");
  assert.equal(form.open(), false);
});

test("a note saved while the stored value is one this script cannot read says so, not that the highlight was deleted", () => {
  const win = page({ items: ITEMS });
  start(win as unknown as globalThis.Window);
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  rowButton(win, "two", "edit").click();
  noteForm(win).field.value = "Mine.";
  const newer = '{"v":3,"chapters":{"tools":{"new":"shape"}}}';
  win.localStorage.setItem(KEY, newer);
  noteForm(win).save();
  assert.match(panelStatus(win), /Nothing was changed/);
  assert.doesNotMatch(panelStatus(win), /deleted/);
  assert.equal(win.localStorage.getItem(KEY), newer);
});

test("a note on a highlight deleted without a storage event is caught at save, and deleting the edited row closes the form", () => {
  const win = page({ items: ITEMS });
  start(win as unknown as globalThis.Window);
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  rowButton(win, "two", "edit").click();
  noteForm(win).field.value = "Mine.";
  // The other tab's write has landed in storage, but its event has not reached this page yet.
  win.localStorage.setItem(KEY, stored({ tools: ITEMS.filter((found) => found.id !== "two") }));
  noteForm(win).save();
  assert.match(panelStatus(win), /That highlight was deleted/);
  assert.equal(noteForm(win).field.value, "Mine.");
  const again = page({ items: ITEMS });
  start(again as unknown as globalThis.Window);
  q<HTMLButtonElement>(again, ".notes-open")?.click();
  rowButton(again, "two", "edit").click();
  rowButton(again, "two", "delete").click();
  assert.equal(noteForm(again).open(), false, "the reader deleted what the form edited");
});

test("a new note on a passage another tab highlighted meanwhile goes on that highlight, not a second one", () => {
  const first = page();
  start(first as unknown as globalThis.Window);
  const paragraph = q(first, "article p:last-of-type")?.firstChild as Node;
  select(first, paragraph, 2, paragraph, 13);
  shortcut(first);
  toolbarButton(first, "Add note").click();
  noteForm(first).field.value = "From this tab.";
  // Another tab highlights the same passage, with the same anchor, before this tab saves.
  const otherTab = page();
  start(otherTab as unknown as globalThis.Window);
  const otherParagraph = q(otherTab, "article p:last-of-type")?.firstChild as Node;
  select(otherTab, otherParagraph, 2, otherParagraph, 13);
  shortcut(otherTab);
  toolbarButton(otherTab, "Amber").click();
  const theirs = parseStored(otherTab.localStorage.getItem(KEY)).get("tools") ?? [];
  assert.equal(theirs.length, 1);
  first.localStorage.setItem(KEY, stored({ tools: theirs }));
  noteForm(first).save();
  const items = parseStored(first.localStorage.getItem(KEY)).get("tools") ?? [];
  assert.equal(items.length, 1, "no second highlight on the same passage");
  assert.equal(items[0]?.id, theirs[0]?.id);
  assert.equal(items[0]?.note, "From this tab.");
});

test("a stored value from a newer version or damaged text is never overwritten, and export gives it back as stored", () => {
  for (const raw of ['{"v":3,"chapters":{"tools":{"new":"shape"}}}', "{not json"]) {
    const win = page();
    win.localStorage.setItem(KEY, raw);
    Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: undefined });
    start(win as unknown as globalThis.Window);
    assert.deepEqual(painted(win, PLAIN), [], "reads tolerate it as no notes");
    const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
    select(win, paragraph, 2, paragraph, 13);
    shortcut(win);
    toolbarButton(win, "Amber").click();
    assert.equal(win.localStorage.getItem(KEY), raw, `${raw} is left as it was`);
    assert.match(visibleMessage(win), /Nothing was changed/);
    q<HTMLButtonElement>(win, ".notes-open")?.click();
    assert.equal(q<HTMLElement>(win, ".notes-dialog__flag")?.hidden, false, "the panel says why");
    const exportButton = [...(win.document as unknown as Document).querySelectorAll(".notes-dialog button")].find(
      (found) => found.textContent === "Export as Markdown",
    ) as HTMLButtonElement;
    exportButton.click();
    assert.equal(q<HTMLTextAreaElement>(win, "#notes-export")?.value, raw);
    assert.equal(q(win, ".notes-dialog__download")?.getAttribute("download"), "notes-as-stored.txt");
  }
  assert.equal(storedKind(null), "empty");
  assert.equal(storedKind(""), "empty");
  assert.equal(storedKind(stored({})), "ours");
  assert.equal(storedKind('{"v":1,"chapters":[]}'), "foreign");
  assert.equal(storedKind("[]"), "foreign");
});

test("when another script changes the article's text, the highlights are found and drawn again", async () => {
  const win = page({ items: ITEMS });
  start(win as unknown as globalThis.Window);
  const before = painted(win, NOTED);
  assert.deepEqual(before, ["A failed call comes back again"]);
  const paragraph = q(win, "article p:last-of-type") as Element;
  paragraph.prepend(win.document.createTextNode("Inserted by a script. ") as unknown as Node);
  const last = paragraph.lastChild as unknown as Text;
  last.data = last.data.replace("comes back again", "comes back again, reworded");
  await new Promise((resolve) => setTimeout(resolve, REPAINT_MS + 50));
  const ranges = (win as unknown as { CSS: { highlights: Map<string, FakeHighlight> } }).CSS.highlights.get(
    NOTED,
  )?.ranges;
  assert.equal(ranges?.[0]?.toString(), "A failed call comes back again", "the range covers the passage again");
  assert.notEqual(ranges?.[0]?.startOffset, 0);
});

// Colours, the popover, the note markers and Share (BK24, designed in docs/research/book/). happy-dom has no layout, so
// each test gives the ranges rectangles by the text they cover, as a browser's layout would.
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

function layout(win: Window, rects: Record<string, Rect[]>) {
  vi.spyOn(win.Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    return (rects[this.toString().replace(/\s+/g, " ")] ?? []) as never;
  } as never);
  const article = q(win, "article");
  vi.spyOn(article as Element, "getBoundingClientRect").mockReturnValue(rect(0, 0, 400, 2000) as unknown as DOMRect);
  // The text column is the first paragraph, which ends at 400 here, so the page leaves a wide gutter beside it.
  vi.spyOn(q(win, "article p") as Element, "getBoundingClientRect").mockReturnValue(
    rect(0, 0, 400, 100) as unknown as DOMRect,
  );
}

const popoverWindows: Window[] = [];

/** Gives the page the native popover methods, which happy-dom lacks, and records which element was shown or hidden. */
function withPopover(win: Window) {
  const calls: string[] = [];
  popoverWindows.push(win);
  Object.defineProperty(win.HTMLElement.prototype, "showPopover", {
    configurable: true,
    value() {
      calls.push("show");
    },
  });
  Object.defineProperty(win.HTMLElement.prototype, "hidePopover", {
    configurable: true,
    value() {
      calls.push("hide");
    },
  });
  return calls;
}

function click(win: Window, target: Element | null, x: number, y: number) {
  target?.dispatchEvent(
    new win.MouseEvent("click", { clientX: x, clientY: y, bubbles: true, cancelable: true }) as unknown as Event,
  );
}

const CONTRACT = item({ id: "one", quote: "a contract with a model", section: "schemas", offset: 13 });
const FAILED = item({
  id: "two",
  quote: "A failed call comes back again",
  section: "errors",
  note: "Remember the retry.",
});
const RECTS = {
  "a contract with a model": [rect(10, 100, 200, 120)],
  "A failed call comes back again": [rect(10, 300, 150, 320), rect(10, 320, 250, 340)],
};
/** A window with no free gutter beside the article, so a note gets its inline dot and not a margin marker. */
function narrow(win: Window) {
  Object.defineProperty(win.document.documentElement, "clientWidth", { configurable: true, value: 420 });
  vi.spyOn(q(win, "article p") as Element, "getBoundingClientRect").mockReturnValue(
    rect(0, 0, 400, 100) as unknown as DOMRect,
  );
}

const stage = (items: Item[], options: { popover?: boolean; narrow?: boolean } = {}) => {
  const win = page({ items });
  layout(win, RECTS);
  if (options.narrow) narrow(win);
  if (options.popover === false) {
    for (const name of ["showPopover", "hidePopover"]) Reflect.deleteProperty(win.HTMLElement.prototype, name);
  }
  const calls = options.popover === false ? [] : withPopover(win);
  start(win as unknown as globalThis.Window);
  return { win, calls };
};
const popButton = (win: Window, label: string) =>
  [...(win.document as unknown as Document).querySelectorAll<HTMLButtonElement>(".notes-pop button")].find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement;
const storedItems = (win: Window) => parseStored(win.localStorage.getItem(KEY)).get("tools") ?? [];

test("a version 1 value loads as amber, stays as stored until the first change, and is written as version 2 then", () => {
  const win = page();
  const one = { ...CONTRACT } as Partial<Item>;
  delete one.color;
  const v1 = JSON.stringify({ v: 1, chapters: { tools: [one] } });
  win.localStorage.setItem(KEY, v1);
  start(win as unknown as globalThis.Window);
  assert.deepEqual(painted(win, PLAIN), ["a contract with a model"], "a highlight without a colour is amber");
  assert.equal(win.localStorage.getItem(KEY), v1, "a visit that only reads writes nothing");
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Green").click();
  const written = JSON.parse(win.localStorage.getItem(KEY) ?? "{}") as { v: number; chapters: { tools: Item[] } };
  assert.equal(written.v, 2, "the first change writes version 2");
  assert.deepEqual(
    written.chapters.tools.map((found) => [found.id, found.color]),
    [
      ["one", "amber"],
      [written.chapters.tools[1]?.id, "green"],
    ],
  );
});

test("a colour this script does not know is kept as stored, drawn amber, and replaced only when the reader picks one", () => {
  const kept = parseStored(stored({ tools: [CONTRACT, { ...FAILED, color: "teal" }] })).get("tools");
  assert.equal(kept?.[1]?.color, "teal", "the colour is read as stored");
  assert.equal(parseStored(serializeStored(new Map([["tools", kept ?? []]]))).get("tools")?.[1]?.color, "teal");
  assert.equal(highlightName("teal", true), highlightName("amber", true), "an unknown colour draws amber");
  const { win } = stage([{ ...CONTRACT, color: "teal" }]);
  assert.deepEqual(painted(win, PLAIN), ["a contract with a model"]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  assert.equal(storedItems(win)[0]?.color, "teal", "opening the popover changes nothing");
  popButton(win, "Blue").click();
  assert.equal(storedItems(win)[0]?.color, "blue");
});

test("eight highlight names register in a fixed order, and noted ones come last with priority 1", () => {
  const { win } = stage([CONTRACT, FAILED]);
  const registry = (win as unknown as { CSS: { highlights: Map<string, FakeHighlight & { priority: number }> } }).CSS
    .highlights;
  assert.deepEqual([...registry.keys()], HIGHLIGHT_NAMES);
  assert.deepEqual(
    [...registry.values()].map((highlight) => highlight.priority),
    [0, 0, 0, 0, 1, 1, 1, 1],
  );
  assert.deepEqual(painted(win, highlightName("amber", false)), ["a contract with a model"]);
  assert.deepEqual(painted(win, highlightName("amber", true)), ["A failed call comes back again"]);
  // A repaint keeps the order, so a priority tie always breaks the same way.
  win.dispatchEvent(new win.Event("resize"));
  const again = new win.Event("storage");
  Object.defineProperty(again, "key", { value: KEY });
  win.dispatchEvent(again);
  assert.deepEqual([...registry.keys()], HIGHLIGHT_NAMES);
});

test("a toolbar swatch highlights in its colour, and the colour a reader picked last is the one a note takes", () => {
  const win = page();
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Blue").click();
  assert.equal(storedItems(win)[0]?.color, "blue");
  assert.deepEqual(painted(win, highlightName("blue", false)), ["failed call"]);
  select(win, paragraph, 40, paragraph, 51);
  shortcut(win);
  toolbarButton(win, "Add note").click();
  noteForm(win).field.value = "In blue too.";
  noteForm(win).save();
  const made = storedItems(win).find((found) => found.note === "In blue too.");
  assert.equal(made?.color, "blue", "the note's highlight takes the last colour");
  assert.deepEqual(painted(win, highlightName("blue", true)).length, 1);
});

test("a click on a highlight opens the popover with its passage and colours, and a colour button recolours it", () => {
  const { win, calls } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  assert.deepEqual(calls, ["show"]);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "a contract with a model");
  const pressed = [...(win.document as unknown as Document).querySelectorAll(".notes-pop [aria-pressed='true']")];
  assert.deepEqual(
    pressed.map((button) => button.textContent),
    ["Amber"],
  );
  assert.equal(
    [...(win.document as unknown as Document).querySelectorAll(".notes-pop .notes-colors button")].length,
    4,
    "four colour buttons, each named in text",
  );
  popButton(win, "Pink").click();
  assert.equal(storedItems(win).find((found) => found.id === "one")?.color, "pink");
  assert.deepEqual(painted(win, PLAIN), [], "the amber highlight moved to the pink name");
  assert.deepEqual(painted(win, highlightName("pink", false)), ["a contract with a model"]);
  assert.equal(popButton(win, "Pink").getAttribute("aria-pressed"), "true");
  assert.equal(win.document.activeElement?.textContent, "Pink", "focus stays on the colour that was chosen");
  assert.match(q(win, "[role='status'].visually-hidden")?.textContent ?? "", /colour changed to pink/);
  assert.deepEqual(requests, []);
});

const popChildren = (win: Window) =>
  [...(q(win, ".notes-pop") as Element).children]
    .filter((node) => !(node as HTMLElement).hidden)
    .map((node) => node.className);
const popAction = (win: Window, name: string) =>
  q<HTMLButtonElement>(win, `.notes-pop__act[data-action="${name}"]`) as HTMLButtonElement;

test("the popover shows the colours, the passage as a quotation, the note as the main text, then the actions", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  assert.deepEqual(popChildren(win), [
    "notes-pop__grab",
    "notes-colors",
    "notes-pop__quote",
    "notes-pop__note",
    "notes-pop__actions",
    "notes-pop__message",
  ]);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "A failed call comes back again", "no quotation marks");
  assert.equal(q(win, ".notes-pop__quote")?.getAttribute("title"), "A failed call comes back again", "the tooltip");
  assert.equal(q(win, ".notes-pop__quote")?.getAttribute("data-color"), "amber");
  assert.equal(q(win, ".notes-pop__note")?.textContent, "Remember the retry.");
  const labels = [...(win.document as unknown as Document).querySelectorAll(".notes-pop__act")]
    .filter((button) => !(button as HTMLElement).hidden)
    .map((button) => button.textContent);
  assert.deepEqual(labels, ["Edit", "Share", "Remove"]);
  assert.equal(popAction(win, "delete").className.includes("notes-pop__act--remove"), true);
  assert.equal(
    [...(win.document as unknown as Document).querySelectorAll(".notes-pop .notes-colors button")].length,
    4,
    "four colours, each named for assistive technology",
  );
});

test("a note and the passage are text, never markup, and a long passage keeps its full text for the tooltip", () => {
  const long = "A failed call comes back again";
  const hostile = item({ id: "h", quote: long, section: "errors", note: '<img src=x onerror="alert(1)"><b>bold</b>' });
  const { win } = stage([hostile]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  assert.equal(q(win, ".notes-pop img"), null);
  assert.equal(q(win, ".notes-pop b"), null);
  assert.equal(q(win, ".notes-pop__note")?.textContent, '<img src=x onerror="alert(1)"><b>bold</b>');
});

test("a plain highlight shows the quotation and an Add-a-note field, and Save writes the note", () => {
  const { win, calls } = stage([CONTRACT]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  assert.deepEqual(popChildren(win), [
    "notes-pop__grab",
    "notes-colors",
    "notes-pop__quote",
    "notes-pop__field",
    "notes-pop__actions",
    "notes-pop__message",
  ]);
  const field = q<HTMLTextAreaElement>(win, ".notes-pop__field") as HTMLTextAreaElement;
  assert.equal(field.getAttribute("placeholder"), "Add a note…");
  const labels = [...(win.document as unknown as Document).querySelectorAll(".notes-pop__act")]
    .filter((button) => !(button as HTMLElement).hidden)
    .map((button) => button.textContent);
  assert.deepEqual(labels, ["Save", "Share", "Remove"]);
  field.value = "  Mine, <i>not</i> markup.  ";
  popAction(win, "save").click();
  assert.equal(storedItems(win).find((found) => found.id === "one")?.note, "Mine, <i>not</i> markup.");
  assert.deepEqual(calls, ["show", "hide"], "Save closes the popover");
  assert.equal(q(win, ".notes-pop i"), null);
  assert.equal(q(win, "[role='status'].visually-hidden")?.textContent, "Note saved.", "and says so in the live region");
  const active = win.document.activeElement;
  assert.equal(active?.closest(".notes-pop") ?? null, null, "focus is not left in the closed popover");
  // Opening it again shows the saved note with its Edit.
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  assert.equal(q(win, ".notes-pop__note")?.textContent, "Mine, <i>not</i> markup.");
  assert.equal(popAction(win, "edit").hidden, false, "now it has an Edit");
});

test("Edit turns the note into a field, Cancel drops the change, and Save keeps the typed text", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popAction(win, "edit").click();
  const field = q<HTMLTextAreaElement>(win, ".notes-pop__field") as HTMLTextAreaElement;
  assert.equal(field.hidden, false);
  assert.equal(field.value, "Remember the retry.");
  assert.equal(win.document.activeElement, field);
  field.value = "Changed my mind";
  popAction(win, "cancel").click();
  assert.equal(q(win, ".notes-pop__note")?.textContent, "Remember the retry.", "Cancel keeps the stored note");
  assert.equal(storedItems(win).find((found) => found.id === "two")?.note, "Remember the retry.");
  popAction(win, "edit").click();
  (q(win, ".notes-pop__field") as HTMLTextAreaElement).value = "Changed my mind";
  popAction(win, "save").click();
  assert.equal(storedItems(win).find((found) => found.id === "two")?.note, "Changed my mind");
  click(win, q(win, "article p:last-of-type"), 50, 310);
  assert.equal(q(win, ".notes-pop__note")?.textContent, "Changed my mind");
});

test("Save works from the stored list, so another tab's change is kept, and adds a deleted highlight back", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popAction(win, "edit").click();
  const other = item({ id: "three", quote: "from another tab", section: "errors" });
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT, FAILED, other] }));
  (q(win, ".notes-pop__field") as HTMLTextAreaElement).value = "Edited here";
  popAction(win, "save").click();
  assert.deepEqual(
    storedItems(win)
      .map((found) => found.id)
      .sort(),
    ["one", "three", "two"],
  );
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popAction(win, "edit").click();
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT, other] }));
  (q(win, ".notes-pop__field") as HTMLTextAreaElement).value = "Typed after the delete";
  popAction(win, "save").click();
  assert.equal(
    storedItems(win).find((found) => found.quote === "A failed call comes back again")?.note,
    "Typed after the delete",
    "the highlight another tab deleted is added back with the note",
  );
});

test("on a narrow window the popover is a bottom sheet that a swipe down on its handle closes", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  layout(win, RECTS);
  const calls = withPopover(win);
  Object.defineProperty(win, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query.includes("max-width: 40rem"), media: query }),
  });
  start(win as unknown as globalThis.Window);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  const pop = q<HTMLElement>(win, ".notes-pop") as HTMLElement;
  assert.equal(pop.hasAttribute("data-sheet"), true);
  assert.equal(pop.style.top, "", "a sheet is placed by its stylesheet, not by the click");
  const move = (type: string, y: number) => win.dispatchEvent(new win.MouseEvent(type, { clientY: y }) as never);
  const grab = q(win, ".notes-pop__grab") as Element;
  grab.dispatchEvent(new win.MouseEvent("pointerdown", { clientY: 100, bubbles: true }) as unknown as Event);
  move("pointermove", 130);
  assert.equal(pop.style.transform, "translateY(30px)", "the sheet follows the finger");
  move("pointerup", 130);
  assert.equal(pop.style.transform, "", "a short swipe springs back");
  assert.equal(calls.includes("hide"), false);
  grab.dispatchEvent(new win.MouseEvent("pointerdown", { clientY: 100, bubbles: true }) as unknown as Event);
  move("pointermove", 220);
  move("pointerup", 220);
  assert.equal(calls.includes("hide"), true, "a long swipe closes the sheet");
  assert.equal(pop.style.transform, "");
});

test("focus goes back to the marker after Escape or a keyboard open, not after a click outside", () => {
  const { win } = stage([CONTRACT, FAILED]);
  const closed = () => {
    const toggle = new win.Event("toggle") as unknown as Event & { newState: string };
    toggle.newState = "closed";
    (q(win, ".notes-pop") as Element).dispatchEvent(toggle);
  };
  // A pointer open closed by a click elsewhere leaves focus alone.
  click(win, q(win, "article p:last-of-type"), 50, 310);
  (win.document.activeElement as unknown as HTMLElement | null)?.blur();
  closed();
  assert.notEqual(win.document.activeElement, markers(win)[0], "a click outside keeps focus where the reader put it");
  // Escape inside the popover brings focus back.
  click(win, q(win, "article p:last-of-type"), 50, 310);
  (q(win, ".notes-pop") as Element).dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event,
  );
  (win.document.activeElement as unknown as HTMLElement | null)?.blur();
  closed();
  assert.equal(win.document.activeElement, markers(win)[0]);
});

test("Save after another tab deleted the highlight adds it back with the note, and an unchanged Save writes nothing", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popAction(win, "edit").click();
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT] }));
  (q(win, ".notes-pop__field") as HTMLTextAreaElement).value = "Typed after the other tab deleted it";
  popAction(win, "save").click();
  const saved = storedItems(win).find((found) => found.quote === "A failed call comes back again");
  assert.equal(saved?.note, "Typed after the other tab deleted it", "the highlight is back with its note");
  assert.equal(storedItems(win).length, 2);
  // An unchanged Save does not write, and does not announce a removal.
  const plain = stage([CONTRACT]);
  click(plain.win, q(plain.win, "article p:nth-of-type(2)"), 50, 110);
  const before = plain.win.localStorage.getItem(KEY);
  popAction(plain.win, "save").click();
  assert.equal(plain.win.localStorage.getItem(KEY), before, "nothing was written");
  assert.doesNotMatch(q(plain.win, "[role='status'].visually-hidden")?.textContent ?? "", /removed/);
});

test("Save writes a fresh time, so the panel orders the highlight as it would after a panel edit", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popAction(win, "edit").click();
  (q(win, ".notes-pop__field") as HTMLTextAreaElement).value = "Newer";
  const before = storedItems(win).find((found) => found.id === "two")?.at ?? 0;
  popAction(win, "save").click();
  assert.ok((storedItems(win).find((found) => found.id === "two")?.at ?? 0) >= before);
  assert.equal(storedItems(win).find((found) => found.id === "two")?.note, "Newer");
});

test("a change in another tab updates an open popover, and closes it when the highlight is gone", () => {
  const { win } = stage([CONTRACT, FAILED]);
  const storage = () => {
    const event = new win.Event("storage");
    Object.defineProperty(event, "key", { value: KEY });
    win.dispatchEvent(event);
  };
  click(win, q(win, "article p:last-of-type"), 50, 310);
  assert.equal(q(win, ".notes-pop__note")?.textContent, "Remember the retry.");
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT, { ...FAILED, note: "Changed in tab B" }] }));
  storage();
  assert.equal(q(win, ".notes-pop__note")?.textContent, "Changed in tab B");
  const hide = vi.fn();
  Object.defineProperty(win.HTMLElement.prototype, "hidePopover", { configurable: true, value: hide });
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT] }));
  storage();
  assert.equal(hide.mock.calls.length > 0, true, "the popover closes on a highlight another tab deleted");
});

test("only the pointer that grabbed the sheet's handle moves it, and a layout change while open closes it", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  layout(win, RECTS);
  const calls = withPopover(win);
  const listeners: ((event: unknown) => void)[] = [];
  const query = {
    matches: true,
    media: "(max-width: 40rem)",
    addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.push(listener),
  };
  Object.defineProperty(win, "matchMedia", { configurable: true, value: () => query });
  start(win as unknown as globalThis.Window);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  const pop = q<HTMLElement>(win, ".notes-pop") as HTMLElement;
  const pointer = (type: string, id: number, y: number) => {
    const event = new win.MouseEvent(type, { clientY: y, bubbles: true }) as unknown as Event;
    Object.defineProperty(event, "pointerId", { value: id });
    return event;
  };
  (q(win, ".notes-pop__grab") as Element).dispatchEvent(pointer("pointerdown", 1, 100));
  win.dispatchEvent(pointer("pointermove", 2, 400) as never);
  assert.equal(pop.style.transform, "", "a second finger does not move the sheet");
  win.dispatchEvent(pointer("pointerup", 2, 400) as never);
  assert.equal(calls.includes("hide"), false, "nor does its release close it");
  win.dispatchEvent(pointer("pointermove", 1, 130) as never);
  assert.equal(pop.style.transform, "translateY(30px)");
  win.dispatchEvent(pointer("pointerup", 1, 130) as never);
  // Rotating to a wide window while the sheet is open closes it.
  query.matches = false;
  for (const listener of listeners) listener({});
  assert.equal(calls.includes("hide"), true);
});

/** A phone-sized window for the bottom sheet: a visual viewport a test can resize, a scroll spy and a sheet at `top`. */
function sheetWindow(top: number) {
  const win = page({ items: [CONTRACT, FAILED] });
  layout(win, RECTS);
  withPopover(win);
  Object.defineProperty(win, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, media: "(max-width: 40rem)", addEventListener: () => undefined }),
  });
  Object.defineProperty(win, "innerHeight", { configurable: true, value: 664 });
  const listeners: Record<string, (() => void)[]> = {};
  const visual = {
    height: 664,
    offsetTop: 0,
    addEventListener: (type: string, listener: () => void) => {
      listeners[type] = [...(listeners[type] ?? []), listener];
    },
  };
  Object.defineProperty(win, "visualViewport", { configurable: true, value: visual });
  const scrolls: number[] = [];
  Object.defineProperty(win, "scrollBy", { configurable: true, value: (_x: number, y: number) => scrolls.push(y) });
  start(win as unknown as globalThis.Window);
  const pop = q<HTMLElement>(win, ".notes-pop") as HTMLElement;
  const edge = { top };
  vi.spyOn(pop, "getBoundingClientRect").mockImplementation(() => rect(0, edge.top, 390, 664) as unknown as DOMRect);
  const fire = (type: string) => {
    for (const listener of listeners[type] ?? []) listener();
  };
  return { win, pop, visual, scrolls, fire, edge };
}

test("the sheet follows the visual viewport: its bottom lift, its height cap and compact mode", () => {
  const { win, pop, visual, fire } = sheetWindow(400);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  assert.equal(pop.style.getPropertyValue("--notes-sheet-bottom"), "0px");
  assert.equal(pop.style.getPropertyValue("--notes-sheet-max"), "332px", "half of 664");
  assert.equal(pop.hasAttribute("data-compact"), false);
  // The keyboard opens: the visual viewport shrinks to 400px and the layout viewport keeps its height.
  visual.height = 400;
  fire("resize");
  assert.equal(pop.style.getPropertyValue("--notes-sheet-bottom"), "264px");
  assert.equal(pop.style.getPropertyValue("--notes-sheet-max"), "220px", "55% of 400");
  assert.equal(pop.hasAttribute("data-compact"), true, "the quotation goes");
  // A viewport with no height reading falls back to the window's, with no lift.
  visual.height = 0;
  fire("resize");
  assert.equal(pop.style.getPropertyValue("--notes-sheet-bottom"), "0px");
});

test("a passage under the sheet scrolls into view by its last line, and its first line stays on screen", () => {
  // CONTRACT's passage is one line at 100..120; FAILED's two lines are at 300..340.
  const covered = sheetWindow(300);
  click(covered.win, q(covered.win, "article p:nth-of-type(2)"), 50, 110);
  assert.deepEqual(covered.scrolls, [], "a passage above the sheet does not scroll the page");

  const lines = sheetWindow(310);
  click(lines.win, q(lines.win, "article p:last-of-type"), 50, 310);
  // The first line (300..320) is above the sheet's top at 310 but the last (320..340) is under it: 340 - (310 - 16).
  assert.deepEqual(lines.scrolls, [46], "the page scrolls by the last line's overlap");

  const tall = sheetWindow(200);
  click(tall.win, q(tall.win, "article p:last-of-type"), 50, 310);
  // The overlap would be 156px, but the first line's top (300) allows 284; here it is not the cap that binds.
  assert.deepEqual(tall.scrolls, [156]);

  const capped = sheetWindow(40);
  click(capped.win, q(capped.win, "article p:last-of-type"), 50, 310);
  // The overlap is 316px, and the first line's top at 300 stops the scroll at 284 so it stays visible.
  assert.deepEqual(capped.scrolls, [284]);
});

test("a viewport scroll that moves only the visual viewport's offset does not scroll the page again", () => {
  const { win, visual, scrolls, fire } = sheetWindow(310);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  const opened = scrolls.length;
  visual.offsetTop = 60;
  fire("scroll");
  fire("scroll");
  assert.equal(scrolls.length, opened, "no further scroll");
  visual.height = 400;
  fire("resize");
  assert.equal(scrolls.length, opened + 1, "a height change reveals the passage again");
});

test("a refresh keeps what a reader typed in a plain highlight's field, and a saved note is what a later delete is judged against", () => {
  const { win } = stage([CONTRACT, FAILED]);
  const storage = () => {
    const event = new win.Event("storage");
    Object.defineProperty(event, "key", { value: KEY });
    win.dispatchEvent(event);
  };
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  const field = q<HTMLTextAreaElement>(win, ".notes-pop__field") as HTMLTextAreaElement;
  field.value = "Half typed";
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT, { ...FAILED, color: "pink" }] }));
  storage();
  assert.equal((q(win, ".notes-pop__field") as HTMLTextAreaElement).value, "Half typed", "the typed text is kept");
  popAction(win, "save").click();
  assert.equal(storedItems(win).find((found) => found.id === "one")?.note, "Half typed");
  // After a save the stored note is the saved one, so another tab's delete closes the popover.
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  const hide = vi.fn();
  Object.defineProperty(win.HTMLElement.prototype, "hidePopover", { configurable: true, value: hide });
  win.localStorage.setItem(KEY, stored({ tools: [FAILED] }));
  storage();
  assert.equal(hide.mock.calls.length > 0, true);
});

test("a draft typed on a plain highlight stays as an edit when another tab adds a note to it", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  (q(win, ".notes-pop__field") as HTMLTextAreaElement).value = "My draft";
  win.localStorage.setItem(KEY, stored({ tools: [{ ...CONTRACT, note: "From tab B" }, FAILED] }));
  const event = new win.Event("storage");
  Object.defineProperty(event, "key", { value: KEY });
  win.dispatchEvent(event);
  const field = q<HTMLTextAreaElement>(win, ".notes-pop__field") as HTMLTextAreaElement;
  assert.equal(field.hidden, false, "the field stays open");
  assert.equal(field.value, "My draft");
  assert.equal(popAction(win, "cancel").hidden, false, "Cancel can drop it for the other tab's note");
});

test("a wide window places the popover beside the passage, with no sheet attribute", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  const pop = q<HTMLElement>(win, ".notes-pop") as HTMLElement;
  assert.equal(pop.hasAttribute("data-sheet"), false);
  assert.notEqual(pop.style.top, "");
});

test("Remove in the popover deletes the highlight and closes the popover", () => {
  const { win, calls } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  popButton(win, "Remove").click();
  assert.deepEqual(
    storedItems(win).map((found) => found.id),
    ["two"],
  );
  assert.deepEqual(painted(win, PLAIN), []);
  assert.deepEqual(calls, ["show", "hide"]);
});

test("a plain highlight opens with focus in the note field, and Edit puts the caret at the end of the note", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  const field = q<HTMLTextAreaElement>(win, ".notes-pop__field") as HTMLTextAreaElement;
  assert.equal(win.document.activeElement, field);
  popAction(win, "save").click();
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popAction(win, "edit").click();
  assert.equal(win.document.activeElement, field);
  assert.equal(field.selectionStart, "Remember the retry.".length);
  assert.equal(field.selectionEnd, "Remember the retry.".length);
});

test("Remove and Close shut the popover through one routine and say what happened", () => {
  const { win, calls } = stage([CONTRACT, FAILED]);
  const live = () => q(win, "[role='status'].visually-hidden")?.textContent;
  click(win, q(win, "article p:last-of-type"), 50, 310);
  (q(win, ".notes-pop__close") as HTMLElement).click();
  assert.deepEqual(calls, ["show", "hide"]);
  assert.equal(storedItems(win).length, 2, "Close removes nothing");
  assert.equal(q(win, ".notes-pop__close")?.getAttribute("aria-label"), "Close note");
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popButton(win, "Remove").click();
  assert.equal(live(), "Note removed.");
  assert.deepEqual(calls, ["show", "hide", "show", "hide"]);
});

test("a click on a link, with text selected, outside any highlight or in a browser without popovers opens nothing", () => {
  const { win, calls } = stage([item({ id: "link", quote: "reads the schema only", section: "schemas" })]);
  layout(win, { "reads the schema only": [rect(10, 100, 200, 120)] });
  click(win, q(win, "article a[href='/x/']"), 50, 110);
  assert.deepEqual(calls, [], "a link inside a highlight follows its link");
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  assert.deepEqual(calls, [], "a drag that selects text is not a click on a highlight");
  (win as unknown as globalThis.Window).getSelection()?.removeAllRanges();
  click(win, q(win, "article p:nth-of-type(2)"), 900, 900);
  assert.deepEqual(calls, [], "a click outside every highlight");
  click(win, q(win, "h1"), 50, 110);
  assert.deepEqual(calls, [], "a click outside the article");
  const plain = stage([CONTRACT], { popover: false });
  click(plain.win, q(plain.win, "article p:nth-of-type(2)"), 50, 110);
  assert.equal(q(plain.win, ".notes-pop__quote")?.textContent, "", "without the Popover API the panel is the way in");
});

test("where highlights overlap, a click opens the one that paints on top: a noted one, then a later colour", () => {
  const under = item({ id: "under", quote: "a contract with a model", color: "amber" });
  const over = item({ id: "over", quote: "contract with", color: "pink" });
  const noted = item({ id: "noted", quote: "with a", color: "amber", note: "On top." });
  const win = page({ items: [under, over, noted] });
  layout(win, {
    "a contract with a model": [rect(10, 100, 200, 120)],
    "contract with": [rect(40, 100, 120, 120)],
    "with a": [rect(80, 100, 110, 120)],
  });
  withPopover(win);
  start(win as unknown as globalThis.Window);
  const target = q(win, "article p:nth-of-type(2)");
  click(win, target, 90, 110);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "with a", "the noted highlight paints above the plain ones");
  click(win, target, 50, 110);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "contract with", "pink registers after amber");
  click(win, target, 20, 110);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "a contract with a model");
});

const dots = (win: Window) => [
  ...(win.document as unknown as Document).querySelectorAll<HTMLElement>("article .notes-dot"),
];
const articleText = (win: Window) => (q(win, "article") as Element).textContent;

test("a noted highlight gets a numbered dot right after its last word, and a plain highlight gets none", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  narrow(win);
  const before = articleText(win);
  start(win as unknown as globalThis.Window);
  const [dot, ...rest] = dots(win);
  assert.equal(rest.length, 0, "only the highlight with a note has one");
  assert.equal(dot?.getAttribute("data-id"), "two");
  assert.equal(dot?.getAttribute("data-n"), "1");
  assert.equal(dot?.getAttribute("role"), "button");
  assert.equal(dot?.getAttribute("tabindex"), "0");
  assert.equal(dot?.getAttribute("aria-label"), "Note 1");
  assert.equal(dot?.getAttribute("data-color"), "amber");
  assert.ok(dot?.hasAttribute("data-pagefind-ignore"), "Pagefind skips it");
  assert.equal(dot?.textContent, "", "the number is generated content, so no text is added");
  assert.equal(articleText(win), before, "the chapter's text is the same");
  assert.equal(dot?.previousSibling?.textContent?.endsWith("again"), true, "right after the last word");
  assert.equal(dot?.nextSibling?.textContent, ".", "and before the characters that follow");
  assert.equal(q(win, ".notes-marker"), null, "a narrow window has no margin marker");
});

test("the dot changes no anchor: the text model, the painted passages and the stored value are the same", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  narrow(win);
  const doc = win.document as unknown as Document;
  const article = doc.querySelector("article") as Element;
  const before = buildIndex(proseNodes(article).map((node) => node.data)).text;
  start(win as unknown as globalThis.Window);
  assert.equal(buildIndex(proseNodes(article).map((node) => node.data)).text, before);
  assert.deepEqual(painted(win, PLAIN), ["a contract with a model"]);
  assert.deepEqual(painted(win, NOTED), ["A failed call comes back again"]);
  assert.equal(storedItems(win).length, 2);
  assert.deepEqual(
    storedItems(win).map((found) => found.quote),
    ["a contract with a model", "A failed call comes back again"],
  );
});

test("dots are numbered in the panel's order, and the panel names each note's number", () => {
  const first = item({ id: "late", quote: "A failed call comes back again", section: "errors", note: "Later." });
  const second = item({
    id: "early",
    quote: "a contract with a model",
    section: "schemas",
    offset: 13,
    note: "Earlier.",
  });
  const win = page({ items: [first, second] });
  narrow(win);
  start(win as unknown as globalThis.Window);
  const byId = Object.fromEntries(dots(win).map((dot) => [dot.getAttribute("data-id"), dot.getAttribute("data-n")]));
  assert.deepEqual(byId, { early: "1", late: "2" });
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  const labels = [...(win.document as unknown as Document).querySelectorAll(".notes-dialog__label")].map(
    (label) => label.textContent,
  );
  assert.deepEqual(labels, ["Note 1", "Note 2"]);
});

test("a dot takes its highlight's colour and an unknown colour reads as amber", () => {
  const green = item({
    id: "g",
    quote: "A failed call comes back again",
    section: "errors",
    note: "x",
    color: "green",
  });
  const odd = item({
    id: "o",
    quote: "a contract with a model",
    section: "schemas",
    offset: 13,
    note: "y",
    color: "teal",
  });
  const win = page({ items: [green, odd] });
  narrow(win);
  start(win as unknown as globalThis.Window);
  const colours = Object.fromEntries(
    dots(win).map((dot) => [dot.getAttribute("data-id"), dot.getAttribute("data-color")]),
  );
  assert.deepEqual(colours, { g: "green", o: "amber" });
});

test("a passage that ends in a link or code gets its dot after the element, never inside it", () => {
  const ends = item({ id: "l", quote: "that reads the schema", section: "schemas", note: "n" });
  const win = page({ items: [ends] });
  narrow(win);
  start(win as unknown as globalThis.Window);
  const [dot] = dots(win);
  assert.equal(dot?.parentElement?.tagName, "P", "not inside the anchor");
  assert.equal((dot?.previousSibling as Element | null)?.tagName, "A");
});

test("repainting takes the dots out and joins the text nodes again, so nothing piles up", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  narrow(win);
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type") as Element;
  assert.equal(paragraph.childNodes.length, 3, "a text node, the dot and the text after it");
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  const edit = [...(win.document as unknown as Document).querySelectorAll(".notes-dialog__item button")].find(
    (found) => found.textContent === "Delete",
  ) as HTMLButtonElement;
  // The panel lists the chapter in order: the plain highlight first, then the noted one.
  const rows = [...(win.document as unknown as Document).querySelectorAll(".notes-dialog__item")];
  const noted = rows.find((row) => row.getAttribute("data-id") === "two");
  assert.ok(edit);
  [...(noted?.querySelectorAll("button") ?? [])]
    .find((found) => found.textContent === "Delete")
    ?.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
  assert.equal(dots(win).length, 0, "deleting the note's highlight removes its dot");
  assert.equal(paragraph.childNodes.length, 1, "and the split text is one node again");
});

test("a click on a dot opens the popover for its highlight", () => {
  const { win, calls } = stage([CONTRACT, FAILED], { narrow: true });
  click(win, dots(win)[0] ?? null, 250, 295);
  assert.deepEqual(calls, ["show"]);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "A failed call comes back again");
});

test("Enter on a focused dot opens the popover on keydown and Space on keyup, and focus returns to the dot when it closes", () => {
  const { win, calls } = stage([CONTRACT, FAILED], { narrow: true });
  const dot = dots(win)[0] as HTMLElement;
  const key = (type: string, name: string) =>
    new win.KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }) as unknown as Event;
  const dismiss = () => {
    const closing = new win.Event("beforetoggle") as unknown as Event & { newState: string };
    closing.newState = "closed";
    (q(win, ".notes-pop") as Element).dispatchEvent(closing);
  };
  const spaceDown = key("keydown", " ");
  dot.dispatchEvent(spaceDown);
  assert.equal(spaceDown.defaultPrevented, true, "Space does not scroll the page");
  assert.deepEqual(calls, [], "and does not open on keydown");
  dot.dispatchEvent(key("keyup", " "));
  assert.deepEqual(calls, ["show"]);
  dismiss();
  dot.dispatchEvent(key("keydown", "Enter"));
  assert.deepEqual(calls, ["show", "show"]);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "A failed call comes back again");
  // Closing hands focus to the page, which the dot then takes back.
  (win.document.activeElement as unknown as HTMLElement | null)?.blur();
  const closed = new win.Event("toggle") as unknown as Event & { newState: string };
  closed.newState = "closed";
  (q(win, ".notes-pop") as Element).dispatchEvent(closed);
  assert.equal(win.document.activeElement, dots(win)[0]);
  dot.dispatchEvent(key("keydown", "a"));
  assert.deepEqual(calls, ["show", "show"], "other keys do nothing");
});

const markers = (win: Window) => [
  ...(win.document as unknown as Document).querySelectorAll<HTMLElement>(".notes-markers .notes-marker"),
];
const widen = (win: Window) =>
  Object.defineProperty(win.document.documentElement, "clientWidth", { configurable: true, value: 1024 });

test("a wide window gets a speech-bubble marker in the margin, level with the first line, and adds nothing to the article", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  const before = (q(win, "article") as Element).innerHTML;
  layout(win, RECTS);
  start(win as unknown as globalThis.Window);
  assert.equal((q(win, "article") as Element).innerHTML, before, "the article is exactly as it was");
  const [marker, ...rest] = markers(win);
  assert.equal(rest.length, 0, "only the highlight with a note has one");
  assert.equal(marker?.tagName, "BUTTON");
  assert.equal(marker?.getAttribute("aria-label"), "Note 1");
  assert.equal(marker?.getAttribute("data-id"), "two");
  assert.equal(marker?.getAttribute("data-color"), "amber");
  assert.equal(marker?.querySelector("svg path")?.getAttribute("d"), "M2 3.5h12v7H8.5L5 13.5v-3H2z");
  assert.equal(marker?.closest("[data-pagefind-ignore]")?.className.includes("notes-markers"), true);
  assert.equal(q(win, "article .notes-marker"), null);
  // The article's box ends at 400, so the marker starts 8 pixels to its right, centred on the first line.
  assert.equal(marker?.style.left, "408px");
  assert.equal(marker?.style.top, "296px", "the first line's rectangle runs from 300 to 320, centred on 310");
  assert.equal(dots(win).length, 0, "no dot in a wide window");
});

test("markers that begin close together are stacked, and a plain highlight has none", () => {
  const near = item({ id: "near", quote: "a contract with a model", section: "schemas", offset: 13, note: "n" });
  const win = page({ items: [near, FAILED] });
  layout(win, { ...RECTS, "a contract with a model": [rect(10, 290, 200, 310)] });
  start(win as unknown as globalThis.Window);
  const tops = markers(win).map((marker) => [marker.getAttribute("data-id"), marker.style.top]);
  // "near" is centred on 300, so its marker's top is 286; "two" would be 296, which would overlap, so it moves to 318.
  assert.deepEqual(tops, [
    ["near", "286px"],
    ["two", "318px"],
  ]);
  const none = stage([CONTRACT]);
  assert.equal(markers(none.win).length, 0);
});

test("hovering or focusing a marker brightens its passage with the stronger shade, and leaving puts it back", () => {
  const { win } = stage([CONTRACT, FAILED]);
  const marker = markers(win)[0] as HTMLElement;
  const highlights = (win as unknown as { CSS: { highlights: Map<string, { ranges: Range[] }> } }).CSS.highlights;
  assert.equal(highlights.has("manual-hover-amber"), false);
  marker.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }) as unknown as Event);
  assert.deepEqual(painted(win, "manual-hover-amber"), ["A failed call comes back again"]);
  marker.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true }) as unknown as Event);
  assert.equal(highlights.has("manual-hover-amber"), false);
  marker.dispatchEvent(new win.FocusEvent("focusin", { bubbles: true }) as unknown as Event);
  assert.deepEqual(painted(win, "manual-hover-amber"), ["A failed call comes back again"]);
  marker.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }) as unknown as Event);
  assert.equal(highlights.has("manual-hover-amber"), false);
});

test("a click on a margin marker opens the popover for its highlight, and a keyboard click gives focus back", () => {
  const { win, calls } = stage([CONTRACT, FAILED]);
  const marker = markers(win)[0] as HTMLElement;
  marker.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }) as unknown as Event);
  assert.deepEqual(calls, ["show"]);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "A failed call comes back again");
  (win.document.activeElement as unknown as HTMLElement | null)?.blur();
  const closed = new win.Event("toggle") as unknown as Event & { newState: string };
  closed.newState = "closed";
  (q(win, ".notes-pop") as Element).dispatchEvent(closed);
  assert.equal(win.document.activeElement, markers(win)[0]);
});

test("crossing the gutter's width swaps the markers for dots and back, leaving the article as it was", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  layout(win, RECTS);
  start(win as unknown as globalThis.Window);
  const article = q(win, "article") as Element;
  const original = article.innerHTML;
  assert.equal(markers(win).length, 1);
  narrow(win);
  win.dispatchEvent(new win.Event("resize"));
  assert.equal(markers(win).length, 0, "the margin marker goes");
  assert.equal(dots(win).length, 1, "and a dot takes its place");
  assert.deepEqual(painted(win, NOTED), ["A failed call comes back again"], "the highlight is the same");
  widen(win);
  win.dispatchEvent(new win.Event("resize"));
  assert.equal(dots(win).length, 0, "the dot goes");
  assert.equal(markers(win).length, 1, "and the marker is back");
  assert.equal(article.innerHTML, original, "with the text nodes joined as before, nothing left behind");
  assert.equal(storedItems(win).length, 2, "and the stored anchors are untouched");
});

test("two notes that end at one point read 1 then 2 in dots, and a passage ending on a glossary term keeps its dot out of it", () => {
  const first = item({ id: "a", quote: "A failed call comes back again", section: "errors", note: "x" });
  const second = item({ id: "b", quote: "comes back again", section: "errors", note: "y" });
  const win = page({ items: [first, second] });
  narrow(win);
  start(win as unknown as globalThis.Window);
  const [one, two] = dots(win);
  assert.deepEqual([one?.getAttribute("data-n"), two?.getAttribute("data-n")], ["1", "2"]);
  const between: string[] = [];
  for (let node = one?.nextSibling ?? null; node && node !== two; node = node.nextSibling) {
    if (node.textContent) between.push(node.textContent);
  }
  assert.deepEqual(between, [], "no text sits between the two dots");
  const term = item({ id: "t", quote: "a contract with a model", section: "schemas", offset: 13, note: "z" });
  const win2 = page({ items: [term] });
  narrow(win2);
  start(win2 as unknown as globalThis.Window);
  const [dot] = dots(win2);
  assert.equal(dot?.parentElement?.tagName, "P", "not inside the glossary term");
  assert.equal(dot?.closest(".glossary-term"), null);
});

test("a note on a heading gets its dot after the heading, not inside it", () => {
  const heading = item({ id: "h", quote: "Schemas", section: "schemas", note: "n" });
  const win = page({ items: [heading] });
  narrow(win);
  start(win as unknown as globalThis.Window);
  const [dot] = dots(win);
  assert.ok(dot, "the heading's note has a dot");
  assert.equal(dot.closest("h2"), null);
  assert.equal((dot.previousSibling as Element | null)?.tagName, "H2");
});

test("hovering and focusing are tracked apart, so the shade stays while either one is on the marker", () => {
  const { win } = stage([CONTRACT, FAILED]);
  const marker = markers(win)[0] as HTMLElement;
  const fire = (type: string) => marker.dispatchEvent(new win.Event(type, { bubbles: true }) as unknown as Event);
  const highlights = (win as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;
  fire("focusin");
  fire("mouseover");
  fire("mouseout");
  assert.equal(highlights.has("manual-hover-amber"), true, "focus keeps it after the pointer leaves");
  fire("focusout");
  assert.equal(highlights.has("manual-hover-amber"), false);
  fire("mouseover");
  fire("focusin");
  fire("focusout");
  assert.equal(highlights.has("manual-hover-amber"), true, "the pointer keeps it after focus leaves");
});

test("taking a dot out joins only the text it split and leaves another script's text nodes alone", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  narrow(win);
  const first = q(win, "article p") as Element;
  (first.firstChild as Text).splitText(7);
  assert.equal(first.childNodes.length, 2);
  start(win as unknown as globalThis.Window);
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT, FAILED] }));
  const event = new win.Event("storage");
  Object.defineProperty(event, "key", { value: KEY });
  win.dispatchEvent(event);
  assert.equal(first.childNodes.length, 2, "two nodes another script made stay two");
  assert.equal(dots(win).length, 1);
  assert.equal(
    (q(win, "article p:last-of-type") as Element).childNodes.length,
    3,
    "and the dot's own split is one dot",
  );
});

test("a noted passage in a block wider than the column gives every note a dot, not a marker on the table", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  layout(win, RECTS);
  vi.spyOn(q(win, "article p:last-of-type") as Element, "getBoundingClientRect").mockReturnValue(
    rect(0, 0, 990, 100) as unknown as DOMRect,
  );
  start(win as unknown as globalThis.Window);
  assert.equal(markers(win).length, 0, "only 34 pixels are free beside that block");
  assert.equal(dots(win).length, 1);
});

test("a hovered marker that goes when the window narrows leaves no brightened passage behind", () => {
  const win = page({ items: [CONTRACT, FAILED] });
  layout(win, RECTS);
  start(win as unknown as globalThis.Window);
  (markers(win)[0] as HTMLElement).dispatchEvent(new win.Event("mouseover", { bubbles: true }) as unknown as Event);
  const highlights = (win as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;
  assert.equal(highlights.has("manual-hover-amber"), true);
  narrow(win);
  win.dispatchEvent(new win.Event("resize"));
  assert.equal(markers(win).length, 0);
  assert.equal(highlights.has("manual-hover-amber"), false, "the dot has no hover, so nothing stays brightened");
});

test("a focused dot keeps focus through a redraw", () => {
  const { win } = stage([CONTRACT, FAILED], { narrow: true });
  (dots(win)[0] as HTMLElement).focus();
  assert.equal(win.document.activeElement, dots(win)[0]);
  win.localStorage.setItem(KEY, stored({ tools: [CONTRACT, FAILED] }));
  const event = new win.Event("storage");
  Object.defineProperty(event, "key", { value: KEY });
  win.dispatchEvent(event);
  assert.equal(win.document.activeElement, dots(win)[0]);
});

test("Share copies the passage, the title and a text-fragment link, and never the note", async () => {
  const { win } = stage([CONTRACT, FAILED]);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText } });
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popButton(win, "Share").click();
  await Promise.resolve();
  assert.equal(writeText.mock.calls.length, 1);
  const text = (writeText.mock.calls[0] as unknown as [string])[0];
  assert.equal(
    text,
    "“A failed call comes back again”\n— Tools\nhttps://manual.buildanagent.fyi/tools/#errors:~:text=A%20failed%20call%20comes%20back%20again",
  );
  assert.doesNotMatch(text, /retry/, "the note stays private");
  assert.match(q(win, ".notes-pop__message")?.textContent ?? "", /Copied the passage and its link/);
  assert.deepEqual(requests, []);
});

test("Share adds the passage's own block as context when the passage repeats, and drops a page's old fragment", async () => {
  const again = item({
    id: "again",
    quote: "A failed call comes back",
    prefix: "as a message. ",
    suffix: " again.",
    section: "errors",
  });
  const win = page({ items: [again] });
  layout(win, { "A failed call comes back": [rect(10, 300, 250, 320)] });
  withPopover(win);
  win.history.pushState({}, "", "/tools/?x=1#old:~:text=gone");
  start(win as unknown as globalThis.Window);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText } });
  click(win, q(win, "article p:last-of-type"), 50, 310);
  popButton(win, "Share").click();
  await Promise.resolve();
  const text = (writeText.mock.calls[0] as unknown as [string])[0];
  assert.match(
    text,
    /^“A failed call comes back”\n— Tools\nhttps:\/\/manual\.buildanagent\.fyi\/tools\/\?x=1#errors:~:text=/,
  );
  assert.match(
    text,
    /text=[^,]+-,A%20failed%20call%20comes%20back,-[^,]+$/,
    "a prefix and a suffix tell the copies apart",
  );
  assert.doesNotMatch(text, /#old/);
});

test("Share leaves out text the chapter model skips, such as a hidden glossary card, and uses where the passage is now", async () => {
  const again = item({
    id: "again",
    quote: "A failed call comes back",
    prefix: "as a message. ",
    suffix: " again.",
    section: "stale-section",
  });
  const win = page({ items: [again] });
  const paragraph = q(win, "article p:last-of-type") as Element;
  const text = paragraph.firstChild as Text;
  const rest = text.splitText((text.data.indexOf("A failed call") ?? 0) as number);
  const hidden = (win.document as unknown as Document).createElement("span");
  hidden.setAttribute("aria-hidden", "true");
  hidden.textContent = "ZZHIDDENZZ ";
  paragraph.insertBefore(hidden, rest);
  layout(win, { "A failed call comes back": [rect(10, 300, 250, 320)] });
  withPopover(win);
  start(win as unknown as globalThis.Window);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText } });
  click(win, paragraph, 50, 310);
  popButton(win, "Share").click();
  await Promise.resolve();
  const copied = (writeText.mock.calls[0] as unknown as [string])[0];
  assert.doesNotMatch(copied, /ZZHIDDEN/);
  assert.match(copied, /#errors:~:text=/, "the section is the one the passage is under now, not the stored one");
});

test("Remove in the popover works from the stored list, so another tab's change is kept", () => {
  const { win } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  const other = item({ id: "three", quote: "from another tab", section: "errors" });
  win.localStorage.setItem(KEY, serializeStored(new Map([["tools", [CONTRACT, FAILED, other]]])));
  popButton(win, "Remove").click();
  assert.deepEqual(
    storedItems(win)
      .map((found) => found.id)
      .sort(),
    ["three", "two"],
  );
});

test("a refused highlight is not stored", () => {
  const win = page();
  start(win as unknown as globalThis.Window);
  const paragraph = q(win, "article p:last-of-type")?.firstChild as Node;
  select(win, paragraph, 2, paragraph, 13);
  shortcut(win);
  toolbarButton(win, "Green").click();
  assert.equal(storedItems(win)[0]?.color, "green");
  const long = "x".repeat(5000);
  q(win, "article p:last-of-type")?.append(long);
  select(win, paragraph, 0, q(win, "article p:last-of-type")?.lastChild as Node, long.length);
  shortcut(win);
  toolbarButton(win, "Pink").click();
  assert.equal(storedItems(win).length, 1, "the long passage was refused");
});

test("a click on a second highlight opens its popover after a light dismiss closed the first", () => {
  const { win, calls } = stage([CONTRACT, FAILED]);
  click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
  const pop = q(win, ".notes-pop") as Element;
  // A light dismiss reports beforetoggle at once and toggle later; the click that follows must see it closed.
  const closing = new win.Event("beforetoggle") as unknown as Event & { newState: string };
  closing.newState = "closed";
  pop.dispatchEvent(closing);
  click(win, q(win, "article p:last-of-type"), 50, 310);
  assert.deepEqual(calls, ["show", "show"]);
  assert.equal(q(win, ".notes-pop__quote")?.textContent, "A failed call comes back again");
});

test("Share shows the text in a field to copy by hand when the clipboard is missing or refuses", async () => {
  for (const clipboard of [undefined, { writeText: () => Promise.reject(new Error("denied")) }]) {
    const { win } = stage([CONTRACT]);
    Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: clipboard });
    click(win, q(win, "article p:nth-of-type(2)"), 50, 110);
    popButton(win, "Share").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const field = q<HTMLTextAreaElement>(win, ".notes-pop .notes-dialog__field");
    assert.equal(field?.hidden, false);
    assert.match(
      field?.value ?? "",
      /^“a contract with a model”\n— Tools\nhttps:\/\/manual\.buildanagent\.fyi\/tools\/#schemas:~:text=/,
    );
    assert.match(q(win, ".notes-pop__message")?.textContent ?? "", /Select the text below and copy it/);
  }
});

test("the panel's rows offer the same colour buttons and Share as the popover", async () => {
  const { win } = stage([CONTRACT, FAILED]);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText } });
  q<HTMLButtonElement>(win, ".notes-open")?.click();
  const inRow = (id: string, label: string) =>
    [
      ...(win.document as unknown as Document).querySelectorAll<HTMLButtonElement>(
        `.notes-dialog__item[data-id="${id}"] button`,
      ),
    ].find((button) => button.textContent === label) as HTMLButtonElement;
  assert.equal(inRow("one", "Amber").getAttribute("aria-pressed"), "true");
  inRow("one", "Green").click();
  assert.equal(storedItems(win).find((found) => found.id === "one")?.color, "green");
  assert.equal(inRow("one", "Green").getAttribute("aria-pressed"), "true", "the row shows the new colour");
  inRow("two", "Share").click();
  await Promise.resolve();
  assert.equal(writeText.mock.calls.length, 1);
  assert.equal(inRow("gone", "Share"), undefined, "a passage the chapter lost has nothing to link to");
});

test("textDirective builds a whole-word directive for a passage, its ends, or its context", () => {
  const page = "Intro. The loop runs until the model answers. More text. The loop runs until a limit stops it.";
  const one = (quote: string, before: string, after: string, pageText = page) =>
    textDirective({ quote, before, after, first: quote, last: quote, spans: false }, pageText);
  assert.equal(
    one("The loop runs until the model answers", "Intro. ", ". More"),
    "text=The%20loop%20runs%20until%20the%20model%20answers",
  );
  assert.equal(
    one("oop runs until the mod", "The l", "el answers.", "unique oop runs until the mod text"),
    "text=runs%20until%20the",
    "a passage a reader began and ended inside words loses the partial ones",
  );
  assert.equal(
    one("loop runs until", "The ", " the model"),
    "text=The-,loop%20runs%20until,-the%20model",
    "repeated, so context joins",
  );
  assert.equal(
    one("own fox jumps", "The quick br", " over", "The quick brown fox jumps over. The quick brown fox jumps again."),
    "text=The%20quick%20brown-,fox%20jumps,-over",
    "the fragment of a dropped partial word stays in the context, so the context meets the term",
  );
  const run = "w".repeat(50);
  assert.equal(
    textDirective(
      { quote: `Start here ${run}`, before: "", after: "", first: "Start here", last: run, spans: true },
      "other",
    ),
    "",
    "an end term that is a fragment of one long word leaves no directive",
  );
  assert.equal(one("a-b, c&d", "", "", "other"), "text=a%2Db%2C%20c%26d", "-, and & are percent-encoded");
  assert.equal(one("mid", "x", "y"), "", "a passage with no whole word has no directive");
  const long = "word ".repeat(60).trim();
  assert.equal(
    textDirective({ quote: long, before: "", after: "", first: long, last: long, spans: false }, "other"),
    `text=${[`${"word%20".repeat(7)}word`, `${"word%20".repeat(7)}word`].join(",")}`,
    "a long passage goes in as its first and last 40 characters",
  );
  const across = textDirective(
    {
      quote: "end of one. Start of two",
      before: "",
      after: "",
      first: "end of one.",
      last: "Start of two",
      spans: true,
    },
    "other",
  );
  assert.equal(
    across,
    "text=end%20of%20one.,Start%20of%20two",
    "a passage across blocks takes one term from each block",
  );
});

test("shareLink drops an old fragment and keeps the heading as the fallback, and shareText leaves the note out", () => {
  assert.equal(
    shareLink("https://x.test/a/?q=1#old:~:text=z", "errors", "text=a"),
    "https://x.test/a/?q=1#errors:~:text=a",
  );
  assert.equal(shareLink("https://x.test/a/", "", "text=a"), "https://x.test/a/#:~:text=a");
  assert.equal(
    shareLink("https://x.test/a/", "errors", ""),
    "https://x.test/a/#errors",
    "no whole word, so the section only",
  );
  assert.equal(shareText("q", "T", "https://u"), "“q”\n— T\nhttps://u");
});
