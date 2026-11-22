// A reader's highlights and notes on a chapter. The reader selects text in the chapter's article, then highlights it
// or attaches a short note. Each highlight is stored as a text-quote anchor: the selected text, up to 32 characters on
// each side, the section heading it sits under and its offset in that section. On the next visit the script finds the
// quote again, so a highlight survives small edits to the chapter, and one it cannot place stays listed in the notes
// panel with its text. The CSS Custom Highlight API draws the highlights, so the chapter's markup is never wrapped or
// changed. Everything stays in this browser's localStorage: the script makes no request, and it writes stored text
// into the page only as text. Without JavaScript, without CSS.highlights or with storage blocked, nothing appears.
// The file is served as-is from public/, not bundled, like reading.js; the tests import its exported functions.

/** The localStorage key that holds every chapter's highlights. */
export const KEY = "manual-notes";

/** The most highlights the script keeps for one chapter. */
export const MAX_HIGHLIGHTS = 200;

/** The longest note, in characters. */
export const MAX_NOTE = 500;

/** The longest passage one highlight can mark, in characters. */
export const MAX_QUOTE = 1000;

/** How many characters of the chapter's text an anchor keeps on each side of its quote. */
export const CONTEXT = 32;

/** The names the two kinds of highlight take in `CSS.highlights`, which the stylesheet's `::highlight()` rules use. */
export const HIGHLIGHT_NAMES = { plain: "manual-highlight", noted: "manual-note" };

/** The keyboard shortcut that acts on the selection or opens the notes panel, as `aria-keyshortcuts` writes it. */
export const SHORTCUT = "Alt+Shift+N";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ITEM_ID = /^[a-z0-9]{1,40}$/;
const MAX_HEADING_ID = 200;
// Text inside these elements is not part of the chapter's prose: figures and listings, replays, controls that scripts
// add or relabel, hidden glossary cards and this script's own panel. Leaving them out keeps the text the script
// searches the same before and after the page's other scripts run.
const NOT_TEXT = [
  "figure",
  ".replay",
  ".listing-replay",
  "button",
  "[role='tablist']",
  "[aria-live]",
  "[role='status']",
  "[aria-hidden='true']",
  "[data-pagefind-ignore]",
  "script",
  "style",
  "template",
  "svg",
  "textarea",
  "input",
  "select",
].join(", ");
// The same rule as reading.js: these headings name a tab, a listing, a replay or a figure, not a section.
const NOT_A_SECTION = ".tabs, .listing, .replay, .figure, [data-pagefind-ignore]";

const isHeadingId = (value) =>
  typeof value === "string" && value.length <= MAX_HEADING_ID && !/[\s\p{Cc}]/u.test(value);

/**
 * @typedef {{ quote: string, prefix: string, suffix: string, section: string, offset: number }} Anchor
 * @typedef {Anchor & { id: string, note: string, at: number }} Item
 * @typedef {{ id: string, start: number }} Section
 * @typedef {{ text: string, before: number[][], seg: number[], off: number[] }} TextIndex
 * @typedef {{ start: number, end: number, status: "found" | "moved" } | { status: "lost" }} Located
 */

function parseItem(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { id, quote, prefix, suffix, section, offset, note, at } = value;
  if (typeof id !== "string" || !ITEM_ID.test(id)) return undefined;
  if (typeof quote !== "string" || quote.length === 0 || quote.length > MAX_QUOTE) return undefined;
  if (typeof prefix !== "string" || typeof suffix !== "string" || typeof note !== "string") return undefined;
  if (!isHeadingId(section) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isFinite(at)) return undefined;
  return {
    id,
    quote,
    prefix: prefix.slice(-CONTEXT),
    suffix: suffix.slice(0, CONTEXT),
    section,
    offset,
    note: note.slice(0, MAX_NOTE),
    at,
  };
}

/**
 * Reads the stored value into a map from chapter slug to its highlights, in the order they were stored. Anything that
 * is not the shape this script writes, a damaged or hand-edited value included, gives an empty map or drops that one
 * chapter or highlight. A chapter keeps at most `MAX_HIGHLIGHTS`, and a repeated id keeps its first highlight.
 * @param {unknown} raw
 * @returns {Map<string, Item[]>}
 */
export function parseStored(raw) {
  const chapters = new Map();
  if (typeof raw !== "string") return chapters;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return chapters;
  }
  const stored = value?.v === 1 ? value.chapters : undefined;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return chapters;
  for (const [slug, list] of Object.entries(stored)) {
    if (!SLUG.test(slug) || !Array.isArray(list)) continue;
    const seen = new Set();
    const items = [];
    for (const entry of list) {
      const item = parseItem(entry);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length === MAX_HIGHLIGHTS) break;
    }
    if (items.length > 0) chapters.set(slug, items);
  }
  return chapters;
}

/**
 * Writes the map back as the JSON string `parseStored` reads, leaving out chapters with no highlights.
 * @param {Map<string, Item[]>} chapters
 * @returns {string}
 */
export function serializeStored(chapters) {
  const out = {};
  for (const [slug, items] of chapters) if (items.length > 0) out[slug] = items;
  return JSON.stringify({ v: 1, chapters: out });
}

/**
 * Joins the chapter's text nodes into one string with every run of white space collapsed to a single space, the way
 * a reader sees the text, and records where each character came from. `before[s][o]` is the number of characters the
 * joined text holds before offset `o` of text `s`; `seg[i]` and `off[i]` give the text and offset of character `i`.
 * @param {readonly string[]} texts
 * @returns {TextIndex}
 */
export function buildIndex(texts) {
  const parts = [];
  const before = [];
  const seg = [];
  const off = [];
  let length = 0;
  // Starting as if after a space drops the white space at the start of the article.
  let space = true;
  texts.forEach((raw, s) => {
    const marks = [];
    for (let o = 0; o < raw.length; o += 1) {
      marks.push(length);
      const char = raw[o] ?? "";
      const isSpace = /\s/.test(char);
      if (isSpace && space) continue;
      parts.push(isSpace ? " " : char);
      space = isSpace;
      seg.push(s);
      off.push(o);
      length += 1;
    }
    marks.push(length);
    before.push(marks);
  });
  return { text: parts.join(""), before, seg, off };
}

/**
 * The offset in the joined text of a point in text `s`, at raw offset `o`.
 * @param {TextIndex} index
 * @param {number} s
 * @param {number} o
 * @returns {number}
 */
export function textOffset(index, s, o) {
  const marks = index.before[s] ?? [];
  return marks[Math.max(0, Math.min(o, marks.length - 1))] ?? 0;
}

/**
 * The point in the original texts where joined offset `i` falls: the start of character `i` for a range's start, or
 * just after character `i - 1` for its end. Gives undefined when the texts hold no characters.
 * @param {TextIndex} index
 * @param {number} i
 * @param {"start" | "end"} edge
 * @returns {{ seg: number, off: number } | undefined}
 */
export function rawPoint(index, i, edge) {
  const last = index.seg.length - 1;
  if (last < 0) return undefined;
  if (edge === "start" && i <= last) {
    const at = Math.max(0, i);
    return { seg: index.seg[at] ?? 0, off: index.off[at] ?? 0 };
  }
  const at = Math.max(0, Math.min(i - 1, last));
  if (edge === "end" && i <= 0) return { seg: index.seg[0] ?? 0, off: index.off[0] ?? 0 };
  return { seg: index.seg[at] ?? 0, off: (index.off[at] ?? 0) + 1 };
}

/**
 * The index of the section a joined offset falls in: the last section that starts at or before it, or -1 before the
 * first heading.
 * @param {readonly Section[]} sections
 * @param {number} position
 * @returns {number}
 */
export function sectionAt(sections, position) {
  let found = -1;
  sections.forEach((section, i) => {
    if (section.start <= position) found = i;
  });
  return found;
}

/**
 * Builds the anchor for the passage between joined offsets `start` and `end`, after trimming the spaces at its ends.
 * Gives a reason instead when the passage is empty or longer than `MAX_QUOTE`.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {readonly Section[]} sections
 * @returns {{ anchor: Anchor, start: number, end: number } | { reason: "empty" | "long" }}
 */
export function buildAnchor(text, start, end, sections) {
  let from = Math.max(0, Math.min(start, end));
  let to = Math.min(text.length, Math.max(start, end));
  while (from < to && text[from] === " ") from += 1;
  while (to > from && text[to - 1] === " ") to -= 1;
  if (from >= to) return { reason: "empty" };
  if (to - from > MAX_QUOTE) return { reason: "long" };
  const at = sectionAt(sections, from);
  const section = at < 0 ? undefined : sections[at];
  return {
    anchor: {
      quote: text.slice(from, to),
      prefix: text.slice(Math.max(0, from - CONTEXT), from),
      suffix: text.slice(to, to + CONTEXT),
      section: section?.id ?? "",
      offset: from - (section?.start ?? 0),
    },
    start: from,
    end: to,
  };
}

function occurrences(text, quote, from, to) {
  const found = [];
  let at = text.indexOf(quote, from);
  while (at !== -1 && at < to) {
    found.push(at);
    at = text.indexOf(quote, at + 1);
  }
  return found;
}

function sharedEnd(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * Picks the occurrence of the anchor's quote whose surrounding text matches the anchor's prefix and suffix best, and
 * among equals the one nearest the anchor's offset in its section. Gives the occurrence's start and whether its
 * context matches in full.
 * @param {string} text
 * @param {readonly number[]} starts
 * @param {Anchor} anchor
 * @param {number} sectionStart
 * @returns {{ start: number, exact: boolean } | undefined}
 */
export function bestMatch(text, starts, anchor, sectionStart) {
  let best;
  for (const start of starts) {
    const end = start + anchor.quote.length;
    const context =
      sharedEnd(text.slice(Math.max(0, start - anchor.prefix.length), start), anchor.prefix) +
      sharedStart(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    const distance = Math.abs(start - sectionStart - anchor.offset);
    if (!best || context > best.context || (context === best.context && distance < best.distance)) {
      best = { start, context, distance };
    }
  }
  if (!best) return undefined;
  return { start: best.start, exact: best.context === anchor.prefix.length + anchor.suffix.length };
}

// A passage whose own words were edited is found by its context: the prefix, then the suffix a similar length later.
function byContext(text, anchor) {
  if (anchor.prefix.length < 8 || anchor.suffix.length < 8) return undefined;
  const longest = Math.min(MAX_QUOTE, anchor.quote.length * 2);
  const shortest = Math.ceil(anchor.quote.length / 2);
  for (const at of occurrences(text, anchor.prefix, 0, text.length)) {
    const start = at + anchor.prefix.length;
    const end = text.indexOf(anchor.suffix, start);
    if (end === -1 || end - start > longest) continue;
    if (end - start < shortest) continue;
    const found = buildAnchor(text, start, end, []);
    if ("anchor" in found) return { start: found.start, end: found.end };
  }
  return undefined;
}

/**
 * Finds an anchor in the chapter's joined text. The search looks first in the anchor's own section, then in the
 * whole article, and picks among repeats of the quote with `bestMatch`. A quote found in its section with its context
 * intact is "found"; one found elsewhere, with changed context, or by its context alone after its own words changed is
 * "moved"; one the chapter no longer holds is "lost".
 * @param {string} text
 * @param {Anchor} anchor
 * @param {readonly Section[]} sections
 * @returns {Located}
 */
export function locate(text, anchor, sections) {
  if (typeof anchor.quote !== "string" || anchor.quote.length === 0) return { status: "lost" };
  const at = anchor.section === "" ? -1 : sections.findIndex((section) => section.id === anchor.section);
  const known = anchor.section === "" || at >= 0;
  const sectionStart = at >= 0 ? (sections[at]?.start ?? 0) : 0;
  const sectionEnd = at >= 0 ? (sections[at + 1]?.start ?? text.length) : (sections[0]?.start ?? text.length);
  const inSection = known ? occurrences(text, anchor.quote, sectionStart, sectionEnd) : [];
  const starts = inSection.length > 0 ? inSection : occurrences(text, anchor.quote, 0, text.length);
  const match = bestMatch(text, starts, anchor, sectionStart);
  if (match) {
    const status = inSection.length > 0 && match.exact ? "found" : "moved";
    return { start: match.start, end: match.start + anchor.quote.length, status };
  }
  const moved = byContext(text, anchor);
  return moved ? { ...moved, status: "moved" } : { status: "lost" };
}

/**
 * Cuts a note to `MAX_NOTE` characters after trimming the white space at its ends.
 * @param {string} note
 * @returns {string}
 */
export function cleanNote(note) {
  return String(note).trim().slice(0, MAX_NOTE);
}

/**
 * Writes a chapter's highlights as Markdown: a heading with the chapter's title, its address, then each passage as a
 * quotation with its note under it. A passage the chapter no longer holds says so.
 * @param {string} title
 * @param {string} url
 * @param {readonly { quote: string, note: string, status: string }[]} items
 * @returns {string}
 */
export function toMarkdown(title, url, items) {
  const oneLine = (value) => value.replace(/\s+/g, " ").trim();
  const lines = [`# Notes on ${oneLine(title)}`, "", `From <${url}>, exported from this browser.`, ""];
  if (items.length === 0) lines.push("No highlights yet.", "");
  for (const item of items) {
    lines.push(`> ${oneLine(item.quote)}`, "");
    if (item.note) lines.push(...item.note.trim().split(/\r?\n/), "");
    if (item.status === "lost") lines.push("_This passage is no longer in the chapter._", "");
    lines.push("---", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * A new highlight id: the time and a random part, in base 36.
 * @param {number} now
 * @param {number} random
 * @returns {string}
 */
export function newId(now, random) {
  return `${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(random * 36 ** 6).toString(36)}`.slice(0, 40);
}

/**
 * Whether the browser can draw highlights: it has `CSS.highlights` and the `Highlight` constructor.
 * @param {Window} win
 * @returns {boolean}
 */
export function supportsHighlights(win) {
  const css = win.CSS;
  return (
    typeof css === "object" && css !== null && typeof css.highlights === "object" && typeof win.Highlight === "function"
  );
}

/**
 * Collects the article's prose text nodes in document order, leaving out the text inside `NOT_TEXT`.
 * @param {Element} article
 * @returns {Text[]}
 */
export function proseNodes(article) {
  const doc = article.ownerDocument;
  const walker = doc.createTreeWalker(article, 4);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(NOT_TEXT)) continue;
    nodes.push(node);
  }
  return nodes;
}

function sectionHeadings(article) {
  return [...article.querySelectorAll("h2[id], h3[id]")].filter(
    (heading) => !heading.id.startsWith("lst-") && heading.closest(NOT_A_SECTION) === null,
  );
}

/**
 * The chapter's text model: its prose nodes, their joined text and its sections, each starting where its heading's
 * text starts.
 * @param {Element} article
 */
export function readChapter(article) {
  const nodes = proseNodes(article);
  const index = buildIndex(nodes.map((node) => node.data));
  const position = (container, offset) => pointOffset(index, nodes, container, offset);
  const sections = sectionHeadings(article).map((heading) => ({ id: heading.id, start: position(heading, 0) }));
  return { nodes, index, sections, position };
}

/**
 * The joined offset of a DOM point, such as a selection's start. A point in a prose text node maps directly; a point
 * in an element or in left-out text maps to the start of the next prose text after it.
 * @param {TextIndex} index
 * @param {readonly Text[]} nodes
 * @param {Node} container
 * @param {number} offset
 * @returns {number}
 */
export function pointOffset(index, nodes, container, offset) {
  const s = nodes.indexOf(container);
  if (s >= 0) return textOffset(index, s, offset);
  const doc = container.ownerDocument ?? container;
  const point = doc.createRange();
  point.setStart(container, offset);
  // The first prose node at or after the point, by binary search over nodes in document order.
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const node = nodes[mid];
    if (node && point.comparePoint(node, 0) < 0) low = mid + 1;
    else high = mid;
  }
  return low < nodes.length ? textOffset(index, low, 0) : index.text.length;
}

function readAll(storage) {
  try {
    return parseStored(storage.getItem(KEY));
  } catch {
    return undefined;
  }
}

function writeAll(storage, chapters) {
  try {
    storage.setItem(KEY, serializeStored(chapters));
    return true;
  } catch {
    return false;
  }
}

function element(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "text") node.textContent = value;
    else if (name === "className") node.className = value;
    else if (value === true) node.setAttribute(name, "");
    else if (value !== false && value !== undefined) node.setAttribute(name, String(value));
  }
  node.append(...children);
  return node;
}

const MESSAGES = {
  long: `Select a shorter passage to highlight it: one highlight holds up to ${MAX_QUOTE.toLocaleString("en")} characters.`,
  full: `This chapter already holds ${MAX_HIGHLIGHTS} highlights, the most this browser keeps for one chapter. Delete one in Notes to add another.`,
  storage: "This browser would not save the change: its storage is full or turned off.",
};

/**
 * Starts the script on a chapter page: draws the stored highlights, offers the toolbar on a selection inside the
 * article, and adds the Notes button and its panel. Does nothing on another page, without `CSS.highlights` or with
 * storage blocked.
 * @param {Window} win
 */
export function start(win) {
  const doc = win.document;
  const article = doc.querySelector("article[data-reading-chapter]");
  const slug = article?.getAttribute("data-reading-chapter") ?? "";
  if (!article || !SLUG.test(slug) || !supportsHighlights(win)) return;
  let storage;
  try {
    storage = win.localStorage;
    storage.getItem(KEY);
  } catch {
    return;
  }
  if (!storage) return;
  new Notes(win, article, slug, storage);
}

class Notes {
  constructor(win, article, slug, storage) {
    this.win = win;
    this.doc = win.document;
    this.article = article;
    this.slug = slug;
    this.storage = storage;
    this.items = readAll(storage)?.get(slug) ?? [];
    /** @type {{ anchor: Anchor, start: number, end: number } | undefined} */
    this.pending = undefined;
    this.placed = new Map();
    this.build();
    this.paint();
    this.listen();
  }

  build() {
    const doc = this.doc;
    const ui = { "data-pagefind-ignore": true, "data-notes-ui": true };
    this.live = element(doc, "div", { ...ui, className: "visually-hidden", role: "status" });
    this.highlightButton = element(doc, "button", { type: "button", className: "control", text: "Highlight" });
    this.noteButton = element(doc, "button", { type: "button", className: "control", text: "Add note" });
    this.toolbarMessage = element(doc, "p", { className: "notes-toolbar__message", hidden: true });
    this.toolbar = element(
      doc,
      "div",
      { ...ui, className: "notes-toolbar notes-ui", role: "group", "aria-label": "Selected text", hidden: true },
      [this.highlightButton, this.noteButton, this.toolbarMessage],
    );
    this.count = element(doc, "span", { className: "notes-open__count" });
    this.openButton = element(
      doc,
      "button",
      {
        ...ui,
        type: "button",
        className: "control notes-open notes-ui",
        "aria-haspopup": "dialog",
        "aria-keyshortcuts": SHORTCUT,
        title: `Notes (${SHORTCUT.replaceAll("+", " ")})`,
      },
      [element(doc, "span", { text: "Notes" }), this.count],
    );
    this.buildDialog(ui);
    doc.body.append(this.live, this.toolbar, this.openButton, this.dialog);
    this.updateCount();
  }

  buildDialog(ui) {
    const doc = this.doc;
    this.selectionQuote = element(doc, "blockquote", { className: "notes-dialog__quote" });
    this.selectionHighlight = element(doc, "button", { type: "button", className: "control", text: "Highlight" });
    this.selectionNote = element(doc, "button", { type: "button", className: "control", text: "Add note" });
    this.selectionBlock = element(
      doc,
      "section",
      { className: "notes-dialog__selection", "aria-label": "Selected text", hidden: true },
      [
        element(doc, "p", { className: "label", text: "Selected text" }),
        this.selectionQuote,
        element(doc, "div", { className: "notes-dialog__actions" }, [this.selectionHighlight, this.selectionNote]),
      ],
    );
    this.formQuote = element(doc, "blockquote", { className: "notes-dialog__quote" });
    this.noteField = element(doc, "textarea", {
      id: "notes-field",
      className: "notes-dialog__field",
      rows: 4,
      maxlength: MAX_NOTE,
      "aria-describedby": "notes-field-count",
    });
    this.noteCount = element(doc, "p", { id: "notes-field-count", className: "notes-dialog__hint" });
    this.saveButton = element(doc, "button", { type: "submit", className: "control", text: "Save note" });
    this.cancelButton = element(doc, "button", { type: "button", className: "control", text: "Cancel" });
    this.form = element(doc, "form", { className: "notes-dialog__form", hidden: true }, [
      this.formQuote,
      element(doc, "label", { for: "notes-field", className: "label", text: "Note" }),
      this.noteField,
      this.noteCount,
      element(doc, "div", { className: "notes-dialog__actions" }, [this.saveButton, this.cancelButton]),
    ]);
    this.status = element(doc, "p", { className: "notes-dialog__status", role: "status" });
    this.list = element(doc, "ol", { className: "notes-dialog__list" });
    this.empty = element(doc, "p", {
      className: "notes-dialog__hint",
      text: `No highlights yet. Select text in the chapter, then choose Highlight or Add note, or press ${SHORTCUT.replaceAll("+", " ")}.`,
    });
    this.exportButton = element(doc, "button", { type: "button", className: "control", text: "Export as Markdown" });
    this.closeButton = element(doc, "button", { type: "button", className: "control", text: "Close" });
    this.exportField = element(doc, "textarea", {
      id: "notes-export",
      className: "notes-dialog__field",
      rows: 6,
      readonly: true,
    });
    this.exportMessage = element(doc, "p", { className: "notes-dialog__hint" });
    this.download = element(doc, "a", {
      className: "control notes-dialog__download",
      download: `notes-${this.slug}.md`,
      text: "Download .md",
    });
    this.exportBlock = element(
      doc,
      "section",
      { className: "notes-dialog__export", "aria-label": "Markdown export", hidden: true },
      [
        this.exportMessage,
        element(doc, "label", { for: "notes-export", className: "label", text: "Your notes as Markdown" }),
        this.exportField,
        this.download,
      ],
    );
    this.dialog = element(
      doc,
      "dialog",
      { ...ui, className: "notes-dialog notes-ui", "aria-labelledby": "notes-title" },
      [
        element(doc, "div", { className: "notes-dialog__head" }, [
          element(doc, "h2", {
            id: "notes-title",
            className: "notes-dialog__title",
            text: "Your notes on this chapter",
          }),
          this.closeButton,
        ]),
        element(doc, "p", {
          className: "notes-dialog__hint",
          text: "They stay in this browser only. Clearing this site's data deletes them, so export them to keep a copy.",
        }),
        this.selectionBlock,
        this.form,
        this.status,
        this.empty,
        this.list,
        element(doc, "div", { className: "notes-dialog__actions" }, [this.exportButton]),
        this.exportBlock,
      ],
    );
  }

  listen() {
    const { win, doc } = this;
    let frame;
    const later = () => {
      if (frame !== undefined) return;
      frame = win.requestAnimationFrame(() => {
        frame = undefined;
        this.onSelection();
      });
    };
    doc.addEventListener("selectionchange", later);
    win.addEventListener("scroll", () => this.position(), { passive: true });
    win.addEventListener("resize", () => this.position());
    // A press on the toolbar keeps the selection the reader made.
    this.toolbar.addEventListener("pointerdown", (event) => event.preventDefault());
    this.toolbar.addEventListener("mousedown", (event) => event.preventDefault());
    this.highlightButton.addEventListener("click", () => this.addPending(false));
    this.noteButton.addEventListener("click", () => this.addPending(true));
    this.toolbar.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.hideToolbar();
      this.restoreFocus();
    });
    this.openButton.addEventListener("pointerdown", () => this.onSelection());
    this.openButton.addEventListener("click", () => this.open(this.openButton));
    this.selectionHighlight.addEventListener("click", () => this.addPending(false));
    this.selectionNote.addEventListener("click", () => this.addPending(true));
    this.closeButton.addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("close", () => this.onClose());
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveNote();
    });
    this.cancelButton.addEventListener("click", () => this.closeForm());
    this.noteField.addEventListener("input", () => this.updateNoteCount());
    this.exportButton.addEventListener("click", () => this.exportMarkdown());
    doc.addEventListener("keydown", (event) => this.onKey(event));
    // Another tab of this book may change the notes; this page then shows the stored ones.
    win.addEventListener("storage", (event) => {
      if (event.key !== KEY && event.key !== null) return;
      this.items = readAll(this.storage)?.get(this.slug) ?? [];
      this.paint();
      if (this.dialog.open) this.renderList();
    });
  }

  onKey(event) {
    const { doc } = this;
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyN") {
      if (this.dialog.open) return;
      const active = doc.activeElement;
      if (active && active !== doc.body && active.matches("textarea, input, select, [contenteditable]")) return;
      event.preventDefault();
      this.onSelection();
      if (this.pending && !this.toolbar.hidden) {
        this.returnFocus = active;
        const first = [this.highlightButton, this.noteButton].find((button) => !button.disabled);
        (first ?? this.highlightButton).focus();
      } else {
        this.open(active);
      }
      return;
    }
    if (event.key === "Escape" && !this.toolbar.hidden && !this.dialog.open) this.hideToolbar();
  }

  /** Reads the current selection; shows the toolbar when it marks prose in the article. */
  onSelection() {
    const { win, article } = this;
    if (this.toolbar.contains(this.doc.activeElement) || this.dialog.open) return;
    const selection = win.getSelection();
    const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : undefined;
    if (!range || !article.contains(range.commonAncestorContainer)) {
      this.pending = undefined;
      this.hideToolbar();
      return;
    }
    const chapter = readChapter(article);
    const start = chapter.position(range.startContainer, range.startOffset);
    const end = chapter.position(range.endContainer, range.endOffset);
    const built = buildAnchor(chapter.index.text, start, end, chapter.sections);
    if ("reason" in built && built.reason === "empty") {
      this.pending = undefined;
      this.hideToolbar();
      return;
    }
    this.pending = "anchor" in built ? built : undefined;
    const problem = "reason" in built ? MESSAGES.long : this.items.length >= MAX_HIGHLIGHTS ? MESSAGES.full : "";
    this.highlightButton.disabled = problem !== "";
    this.noteButton.disabled = problem !== "";
    this.toolbarMessage.textContent = problem;
    this.toolbarMessage.hidden = problem === "";
    this.toolbar.hidden = false;
    this.anchorRange = range.cloneRange();
    this.position();
  }

  position() {
    if (this.toolbar.hidden || !this.anchorRange) return;
    const { win, doc } = this;
    const rects = [...this.anchorRange.getClientRects()];
    const first = rects[0] ?? this.anchorRange.getBoundingClientRect();
    const last = rects[rects.length - 1] ?? first;
    const width = doc.documentElement.clientWidth || win.innerWidth;
    const height = win.innerHeight;
    const box = this.toolbar.getBoundingClientRect();
    const gap = 8;
    let top = last.bottom + gap;
    if (top + box.height > height - gap) top = first.top - box.height - gap;
    top = Math.max(gap, Math.min(top, height - box.height - gap));
    const left = Math.max(gap, Math.min(last.left, width - box.width - gap));
    // Set through the CSSOM, which the content security policy allows; a style attribute in markup it would block.
    this.toolbar.style.top = `${Math.round(top)}px`;
    this.toolbar.style.left = `${Math.round(left)}px`;
  }

  hideToolbar() {
    this.toolbar.hidden = true;
    this.anchorRange = undefined;
  }

  restoreFocus() {
    const target = this.returnFocus;
    this.returnFocus = undefined;
    if (target?.isConnected && target !== this.doc.body && typeof target.focus === "function") target.focus();
    else this.openButton.focus();
  }

  /** Highlights the pending selection, or opens the note form for it. */
  addPending(withNote) {
    const pending = this.pending;
    const fromToolbar = this.toolbar.contains(this.doc.activeElement);
    if (!pending) return;
    if (this.items.length >= MAX_HIGHLIGHTS) {
      this.say(MESSAGES.full);
      return;
    }
    const existing = this.items.find((item) => {
      const place = this.placed.get(item.id);
      return place?.status !== "lost" && place?.start === pending.start && place?.end === pending.end;
    });
    this.hideToolbar();
    if (withNote) {
      this.formTarget = existing ? { id: existing.id } : { anchor: pending.anchor };
      if (!this.dialog.open) this.open(fromToolbar ? this.returnFocus : this.doc.activeElement);
      this.selectionBlock.hidden = true;
      this.openForm(existing?.note ?? "", pending.anchor.quote);
      this.clearSelection();
      return;
    }
    if (existing) {
      this.say("That passage is already highlighted.");
    } else {
      const item = this.makeItem(pending.anchor, "");
      if (this.commit([...this.items, item])) this.say(`Highlighted “${shorten(item.quote)}”.`);
    }
    this.pending = undefined;
    this.clearSelection();
    if (this.dialog.open) {
      this.selectionBlock.hidden = true;
      this.renderList();
      this.list.querySelector("button")?.focus();
    } else if (fromToolbar) this.restoreFocus();
  }

  makeItem(anchor, note) {
    return { id: newId(Date.now(), Math.random()), ...anchor, note: cleanNote(note), at: Date.now() };
  }

  clearSelection() {
    try {
      this.win.getSelection()?.removeAllRanges();
    } catch {
      // A browser without a selection to clear has nothing to do here.
    }
  }

  /** Stores the chapter's new list, keeping the other chapters as they are stored now. Gives whether it was saved. */
  commit(items) {
    const all = readAll(this.storage);
    if (!all) {
      this.say(MESSAGES.storage);
      return false;
    }
    all.set(this.slug, items);
    if (!writeAll(this.storage, all)) {
      this.say(MESSAGES.storage);
      return false;
    }
    this.items = items;
    this.paint();
    return true;
  }

  say(message) {
    this.live.textContent = "";
    this.live.textContent = message;
    if (this.dialog.open) this.status.textContent = message;
  }

  paint() {
    const { win, doc, article } = this;
    const chapter = readChapter(article);
    const plain = [];
    const noted = [];
    this.placed = new Map();
    for (const item of this.items) {
      const located = locate(chapter.index.text, item, chapter.sections);
      this.placed.set(item.id, located);
      if (located.status === "lost") continue;
      const from = rawPoint(chapter.index, located.start, "start");
      const to = rawPoint(chapter.index, located.end, "end");
      const startNode = from && chapter.nodes[from.seg];
      const endNode = to && chapter.nodes[to.seg];
      if (!startNode || !endNode) continue;
      const range = doc.createRange();
      range.setStart(startNode, from.off);
      range.setEnd(endNode, to.off);
      (item.note ? noted : plain).push(range);
    }
    win.CSS.highlights.set(HIGHLIGHT_NAMES.plain, new win.Highlight(...plain));
    win.CSS.highlights.set(HIGHLIGHT_NAMES.noted, new win.Highlight(...noted));
    this.updateCount();
  }

  updateCount() {
    this.count.textContent = this.items.length > 0 ? String(this.items.length) : "";
    this.openButton.setAttribute("aria-label", this.items.length > 0 ? `Notes, ${this.items.length} saved` : "Notes");
  }

  ordered() {
    const position = (item) => {
      const place = this.placed.get(item.id);
      return place && place.status !== "lost" ? place.start : Number.POSITIVE_INFINITY;
    };
    return [...this.items].sort((a, b) => position(a) - position(b) || a.at - b.at);
  }

  open(opener) {
    this.opener = opener && opener !== this.doc.body ? opener : this.openButton;
    this.hideToolbar();
    this.status.textContent = "";
    this.exportBlock.hidden = true;
    this.form.hidden = true;
    const pending = this.pending;
    this.selectionBlock.hidden = !pending;
    if (pending) this.selectionQuote.textContent = shorten(pending.anchor.quote, 300);
    this.renderList();
    if (!this.dialog.open) this.dialog.showModal();
    (pending ? this.selectionHighlight : this.closeButton).focus();
  }

  onClose() {
    this.form.hidden = true;
    this.formTarget = undefined;
    this.pending = undefined;
    this.revokeDownload();
    const opener = this.opener;
    this.opener = undefined;
    if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
    else this.openButton.focus();
  }

  renderList() {
    const doc = this.doc;
    const items = this.ordered();
    this.empty.hidden = items.length > 0;
    this.list.replaceChildren(
      ...items.map((item) => {
        const place = this.placed.get(item.id) ?? { status: "lost" };
        const buttons = [];
        if (place.status !== "lost") {
          const go = element(doc, "button", { type: "button", className: "control", text: "Go to passage" });
          go.addEventListener("click", () => this.jump(item));
          buttons.push(go);
        }
        const edit = element(doc, "button", {
          type: "button",
          className: "control",
          text: item.note ? "Edit note" : "Add note",
        });
        edit.addEventListener("click", () => {
          this.formTarget = { id: item.id };
          this.selectionBlock.hidden = true;
          this.openForm(item.note, item.quote, edit);
        });
        const remove = element(doc, "button", { type: "button", className: "control", text: "Delete" });
        remove.addEventListener("click", () => this.remove(item));
        buttons.push(edit, remove);
        const parts = [element(doc, "blockquote", { className: "notes-dialog__quote", text: item.quote })];
        if (place.status === "moved") {
          parts.push(
            element(doc, "p", {
              className: "notes-dialog__flag label",
              text: "Moved: the text around this passage changed since you saved it",
            }),
          );
        } else if (place.status === "lost") {
          parts.push(
            element(doc, "p", {
              className: "notes-dialog__flag label",
              text: "Not found: the chapter no longer holds this passage",
            }),
          );
        }
        if (item.note) parts.push(element(doc, "p", { className: "notes-dialog__note", text: item.note }));
        parts.push(element(doc, "div", { className: "notes-dialog__actions" }, buttons));
        return element(doc, "li", { className: "notes-dialog__item", "data-id": item.id }, parts);
      }),
    );
  }

  openForm(note, quote, returnTo) {
    this.formReturn = returnTo;
    this.formQuote.textContent = shorten(quote, 300);
    this.noteField.value = note;
    this.updateNoteCount();
    this.form.hidden = false;
    this.noteField.focus();
  }

  closeForm() {
    this.form.hidden = true;
    const target = this.formReturn;
    this.formReturn = undefined;
    this.formTarget = undefined;
    if (target?.isConnected) target.focus();
    else this.closeButton.focus();
  }

  updateNoteCount() {
    this.noteCount.textContent = `${this.noteField.value.length} of ${MAX_NOTE} characters`;
  }

  saveNote() {
    const target = this.formTarget;
    if (!target) return;
    const note = cleanNote(this.noteField.value);
    let id;
    let items;
    if ("anchor" in target) {
      if (this.items.length >= MAX_HIGHLIGHTS) {
        this.say(MESSAGES.full);
        return;
      }
      const item = this.makeItem(target.anchor, note);
      id = item.id;
      items = [...this.items, item];
    } else {
      id = target.id;
      items = this.items.map((item) => (item.id === id ? { ...item, note, at: Date.now() } : item));
    }
    if (!this.commit(items)) return;
    this.formTarget = undefined;
    this.formReturn = undefined;
    this.form.hidden = true;
    this.selectionBlock.hidden = true;
    this.pending = undefined;
    this.renderList();
    this.say(note ? "Note saved." : "Highlight saved without a note.");
    this.focusItem(id);
  }

  focusItem(id) {
    const row = [...this.list.children].find((child) => child.getAttribute("data-id") === id);
    const button = row?.querySelector("button");
    (button ?? this.closeButton).focus();
  }

  remove(item) {
    const rows = [...this.list.children];
    const index = rows.findIndex((row) => row.getAttribute("data-id") === item.id);
    if (!this.commit(this.items.filter((other) => other.id !== item.id))) return;
    this.renderList();
    this.say(`Deleted the highlight on “${shorten(item.quote)}”.`);
    const next = this.list.children[Math.min(index, this.list.children.length - 1)];
    (next?.querySelector("button") ?? this.exportButton).focus();
  }

  jump(item) {
    const { win, doc, article } = this;
    const chapter = readChapter(article);
    const located = locate(chapter.index.text, item, chapter.sections);
    if (located.status === "lost") return;
    const from = rawPoint(chapter.index, located.start, "start");
    const node = from && chapter.nodes[from.seg];
    const block = node?.parentElement?.closest("p, li, blockquote, td, th, dd, dt, h2, h3, h4, figcaption, aside");
    this.opener = undefined;
    this.dialog.close();
    if (!block) return;
    // The passage's block takes focus, so the keyboard continues from the passage, then gives up its tabindex.
    if (!block.hasAttribute("tabindex")) {
      block.setAttribute("tabindex", "-1");
      block.addEventListener("blur", () => block.removeAttribute("tabindex"), { once: true });
    }
    const still = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    block.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    block.focus({ preventScroll: true });
    doc.defaultView?.getSelection()?.removeAllRanges();
  }

  exportMarkdown() {
    const { doc, win } = this;
    const title = doc.querySelector("h1")?.textContent ?? doc.title;
    const url = `${win.location.origin}${win.location.pathname}`;
    const items = this.ordered().map((item) => ({ ...item, status: this.placed.get(item.id)?.status ?? "lost" }));
    const markdown = toMarkdown(title, url, items);
    this.exportField.value = markdown;
    this.exportBlock.hidden = false;
    this.revokeDownload();
    try {
      this.blobUrl = win.URL.createObjectURL(new win.Blob([markdown], { type: "text/markdown" }));
      this.download.href = this.blobUrl;
      this.download.hidden = false;
    } catch {
      this.download.hidden = true;
    }
    const fallback = () => {
      this.exportMessage.textContent = "Select the Markdown below and copy it.";
      this.exportField.focus();
      this.exportField.select();
    };
    const clipboard = win.navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      fallback();
      return;
    }
    clipboard.writeText(markdown).then(() => {
      this.exportMessage.textContent = "Copied to the clipboard. The same Markdown is below.";
      this.say("Notes copied to the clipboard as Markdown.");
    }, fallback);
  }

  revokeDownload() {
    if (!this.blobUrl) return;
    try {
      this.win.URL.revokeObjectURL(this.blobUrl);
    } catch {
      // Nothing to release.
    }
    this.blobUrl = undefined;
    this.download.removeAttribute("href");
  }
}

function shorten(text, max = 60) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

if (typeof window !== "undefined" && typeof document !== "undefined") start(window);
