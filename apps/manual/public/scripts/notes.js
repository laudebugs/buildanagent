// A reader's highlights and notes on a chapter. The reader selects text in the chapter's article, then highlights it
// or attaches a short note. Each highlight is stored as a text-quote anchor: the selected text, up to 32 characters on
// each side, the section heading it sits under and its offset in that section. On the next visit the script finds the
// quote again, so a highlight survives small edits to the chapter, and one it cannot place stays listed in the notes
// panel with its text. The CSS Custom Highlight API draws the highlights, so the chapter's markup is never wrapped or
// changed. Everything stays in this browser's localStorage: the script makes no request, and it writes stored text
// into the page only as text. Each highlight has one of four colours, a click on a highlight or its note marker opens a
// popover with colour, Share and Remove, and a highlight with a note gets a marker, because Firefox 140 to 145 draws
// no underline from a CSS highlight: a speech bubble in the margin where the window leaves room beside the article,
// and a numbered dot after the passage's last word where it does not. Without JavaScript, without CSS.highlights or with
// storage blocked, nothing appears.
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

/** The four colours a reader can choose, in the order their highlights register, and the one a new highlight takes. */
export const COLORS = ["amber", "green", "blue", "pink"];
export const DEFAULT_COLOR = "amber";

/** What each colour is called to a reader, in the popover and the panel, so colour is never the only cue. */
export const COLOR_LABELS = { amber: "Amber", green: "Green", blue: "Blue", pink: "Pink" };

/** The version of the stored value this script writes; it also reads version 1, which had no colours. */
export const STORE_VERSION = 2;

/**
 * The name a highlight takes in `CSS.highlights`, which the stylesheet's `::highlight()` rules use. Each range carries
 * one name, because the specification advises one name per highlight. A colour this script does not know draws amber.
 * @param {string} color
 * @param {boolean} noted
 * @returns {string}
 */
export function highlightName(color, noted) {
  return `manual-${noted ? "note" : "hl"}-${COLORS.includes(color) ? color : DEFAULT_COLOR}`;
}

/** A stored colour as one of the four this script draws; an unknown one reads as the default. */
const colorKey = (color) => (COLORS.includes(color) ? color : DEFAULT_COLOR);

/** Every highlight name, in registration order: the plain names, then the noted ones, which paint above them. */
export const HIGHLIGHT_NAMES = [
  ...COLORS.map((color) => highlightName(color, false)),
  ...COLORS.map((color) => highlightName(color, true)),
];

/** The keyboard shortcut that acts on the selection or opens the notes panel, as `aria-keyshortcuts` writes it. */
export const SHORTCUT = "Alt+Shift+N";

/** How long the article's text must stay unchanged before the script draws the highlights again, in milliseconds. */
export const REPAINT_MS = 100;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ITEM_ID = /^[a-z0-9]{1,40}$/;
// A stored colour this version does not know, written by a later one, is kept as stored and drawn as the default.
const COLOR_ID = /^[a-z0-9-]{1,32}$/i;
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
 * @typedef {Anchor & { id: string, note: string, at: number, color: string }} Item
 * @typedef {{ id: string, start: number }} Section
 * @typedef {{ text: string, before: number[][], seg: number[], off: number[] }} TextIndex
 * @typedef {{ start: number, end: number, status: "found" | "moved" } | { status: "lost" }} Located
 */

/** Versions 1 and 2 are the shapes this script reads; any other version belongs to another script and is never touched. */
const isOurVersion = (version) => version === 1 || version === STORE_VERSION;

function parseItem(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { id, quote, prefix, suffix, section, offset, note, at, color } = value;
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
    color: typeof color === "string" && COLOR_ID.test(color) ? color : DEFAULT_COLOR,
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
  const stored = isOurVersion(value?.v) ? value.chapters : undefined;
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
  return JSON.stringify({ v: STORE_VERSION, chapters: out });
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
 * Picks the occurrence of the anchor's quote whose surrounding text matches the anchor's prefix and suffix best.
 * Among equals it prefers one for which `preferred(start)` holds, the anchor's own section, then the one nearest the
 * anchor's offset in its section. Gives the occurrence's start, whether its context matches in full and whether it
 * is preferred.
 * @param {string} text
 * @param {readonly number[]} starts
 * @param {Anchor} anchor
 * @param {number} sectionStart
 * @param {(start: number) => boolean} [preferred]
 * @returns {{ start: number, exact: boolean, preferred: boolean } | undefined}
 */
export function bestMatch(text, starts, anchor, sectionStart, preferred = () => true) {
  let best;
  for (const start of starts) {
    const end = start + anchor.quote.length;
    const context =
      sharedEnd(text.slice(Math.max(0, start - anchor.prefix.length), start), anchor.prefix) +
      sharedStart(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    const home = preferred(start);
    const distance = Math.abs(start - sectionStart - anchor.offset);
    const better =
      !best ||
      context > best.context ||
      (context === best.context && home && !best.home) ||
      (context === best.context && home === best.home && distance < best.distance);
    if (better) best = { start, context, home, distance };
  }
  if (!best) return undefined;
  return {
    start: best.start,
    exact: best.context === anchor.prefix.length + anchor.suffix.length,
    preferred: best.home,
  };
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
 * Finds an anchor in the chapter's joined text. Every repeat of the quote in the article is scored with `bestMatch`:
 * the best match of the stored context wins wherever it sits, and the anchor's own section wins only a tie. A quote
 * found in its section with its context intact is "found"; one found in another section, with changed context, or
 * by its context alone after its own words changed is "moved"; one the chapter no longer holds is "lost".
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
  const home = (start) => known && start >= sectionStart && start < sectionEnd;
  const match = bestMatch(text, occurrences(text, anchor.quote, 0, text.length), anchor, sectionStart, home);
  if (match) {
    const status = match.preferred && match.exact ? "found" : "moved";
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
 * Escapes one line of a reader's text for a Markdown blockquote, so it stays a line of plain text. Leading spaces go.
 * Everywhere in the line a backslash escapes `\`, `` ` ``, `*`, `_`, `[`, `]`, `!`, `&`, `<`, `~` and `|`, so no code,
 * emphasis, link, image, reference, entity, HTML, strikethrough or table is read. At the line's start it also escapes
 * `#`, `>`, `+`, `=` and `-`, and the `.` or `)` after a number, so no heading, quote, list or rule begins.
 * @param {string} line
 * @returns {string}
 */
export function markdownLine(line) {
  const text = line.replace(/^\s+/, "").replace(/[\\`*_[\]!&<~|]/g, (char) => `\\${char}`);
  if (/^\d+[.)]/.test(text)) return text.replace(/^(\d+)([.)])/, "$1\\$2");
  return /^[#>+=-]/.test(text) ? `\\${text}` : text;
}

/**
 * Writes a chapter's highlights as Markdown: a heading with the chapter's title, its address, then each passage as a
 * quotation, and its note as a second quotation under a "Note:" line, with every line of both escaped by
 * `markdownLine`. A passage the chapter no longer holds says so.
 * @param {string} title
 * @param {string} url
 * @param {readonly { quote: string, note: string, status: string }[]} items
 * @returns {string}
 */
export function toMarkdown(title, url, items) {
  const oneLine = (value) => value.replace(/\s+/g, " ").trim();
  const quote = (text) => text.split(/\r?\n/).map((line) => (line.trim() ? `> ${markdownLine(line)}` : ">"));
  const lines = [`# Notes on ${markdownLine(oneLine(title))}`, "", `From <${url}>, exported from this browser.`, ""];
  if (items.length === 0) lines.push("No highlights yet.", "");
  for (const item of items) {
    lines.push(...quote(oneLine(item.quote)), "");
    if (item.note.trim()) lines.push("Note:", "", ...quote(item.note.trim()), "");
    if (item.status === "lost") lines.push("_This passage is no longer in the chapter._", "");
    lines.push("---", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const WORD = /[\p{L}\p{N}_]/u;

/** The longest passage a share link carries whole, and the length of each end when it carries only the ends. */
export const WHOLE_QUOTE = 120;
export const END_TERM = 40;

/** How much text before and after the passage a link may add to tell a repeated passage from the others. */
export const LINK_CONTEXT = 32;

const squash = (text) => text.replace(/\s+/g, " ").trim();

/**
 * Splits off the word a passage starts in the middle of, because a text directive matches whole words. `lost` is that
 * word's fragment, which belongs to the context before the passage.
 */
function splitStart(text, before) {
  const mid = WORD.test(text[0] ?? "") && WORD.test(before.slice(-1));
  const word = mid ? (text.match(/^[\p{L}\p{N}_]+\s*/u)?.[0] ?? "") : "";
  return { lost: word.trim(), kept: squash(text.slice(word.length)) };
}

/** Splits off the word a passage ends in the middle of; `lost` belongs to the context after the passage. */
function splitEnd(text, after) {
  const mid = WORD.test(text.slice(-1)) && WORD.test(after[0] ?? "");
  const word = mid ? (text.match(/\s*[\p{L}\p{N}_]+$/u)?.[0] ?? "") : "";
  return { lost: word.trim(), kept: squash(text.slice(0, text.length - word.length)) };
}

/** The first or last `max` characters of a text, cut back to a whole word when the cut falls inside one. */
function edgeTerm(text, max, fromEnd) {
  if (text.length <= max) return text;
  if (!fromEnd) {
    const cut = text.slice(0, max);
    if (!WORD.test(text[max] ?? "")) return cut.trim();
    const space = cut.search(/\s\S*$/);
    return space > 0 ? cut.slice(0, space).trim() : "";
  }
  const cut = text.slice(-max);
  if (!WORD.test(text[text.length - max - 1] ?? "")) return cut.trim();
  const space = cut.search(/\s/);
  return space >= 0 ? cut.slice(space).trim() : "";
}

/** The last `LINK_CONTEXT` characters of a text, without a word the cut starts in the middle of. */
function contextTail(text) {
  const clean = squash(text);
  const tail = clean.slice(-LINK_CONTEXT);
  const cutInWord = clean.length > LINK_CONTEXT && WORD.test(clean[clean.length - LINK_CONTEXT - 1] ?? "");
  return (cutInWord ? tail.replace(/^\S*\s+/, "") : tail).trim();
}

/** The first `LINK_CONTEXT` characters of a text, without a word the cut ends in the middle of. */
function contextHead(text) {
  const clean = squash(text);
  const head = clean.slice(0, LINK_CONTEXT);
  const cutInWord = clean.length > LINK_CONTEXT && WORD.test(clean[LINK_CONTEXT] ?? "");
  return (cutInWord ? head.replace(/\s+\S*$/, "") : head).trim();
}

const encodeTerm = (term) => encodeURIComponent(term).replaceAll("-", "%2D");

function countOf(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/**
 * The text directive that scrolls to a highlighted passage, as `text=...`, or "" when the passage leaves no whole word
 * to match. Each term must sit inside one block, so a passage over `WHOLE_QUOTE` characters or across blocks goes in
 * as its first and last `END_TERM` characters, cut at words. Context from the passage's own block joins only when the
 * passage's first term occurs more than once in the page's text, which a directive searches whole.
 * @param {{ quote: string, before: string, after: string, first: string, last: string, spans: boolean }} parts
 *   `first` and `last` are the passage's text in its first and last block, the whole passage when it has one block;
 *   `before` and `after` are the text of those blocks around the passage.
 * @param {string} pageText The page's rendered text.
 * @returns {string}
 */
export function textDirective(parts, pageText) {
  const { spans } = parts;
  const start = splitStart(parts.first, parts.before);
  const end = splitEnd(spans ? parts.last : start.kept, parts.after);
  // A fragment of a word the term had to drop stays in the context, so the context still meets the term.
  const before = parts.before + start.lost;
  const after = end.lost + parts.after;
  const terms =
    !spans && end.kept.length <= WHOLE_QUOTE
      ? [end.kept]
      : [edgeTerm(spans ? start.kept : end.kept, END_TERM, false), edgeTerm(end.kept, END_TERM, true)];
  if (terms.some((term) => term === "")) return "";
  const repeated = countOf(squash(pageText).toLowerCase(), (terms[0] ?? "").toLowerCase()) > 1;
  const prefix = repeated ? contextTail(before) : "";
  const suffix = repeated ? contextHead(after) : "";
  const pieces = [
    ...(prefix ? [`${encodeTerm(prefix)}-`] : []),
    ...terms.map(encodeTerm),
    ...(suffix ? [`-${encodeTerm(suffix)}`] : []),
  ];
  return `text=${pieces.join(",")}`;
}

/**
 * The link a Share copies: the page's address without any fragment, the passage's section heading as the fallback
 * and the text directive after it.
 * @param {string} base The page's origin, path and query.
 * @param {string} section The id of the heading above the passage, or "".
 * @param {string} directive
 * @returns {string}
 */
export function shareLink(base, section, directive) {
  return `${base.split("#")[0]}#${section}${directive ? `:~:${directive}` : ""}`;
}

/**
 * The text Share copies: the passage in quotation marks, the chapter's title and the link. The note is never part of it.
 * @param {string} quote
 * @param {string} title
 * @param {string} link
 * @returns {string}
 */
export function shareText(quote, title, link) {
  return `“${quote}”\n— ${title}\n${link}`;
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

/**
 * Names what the stored value is: "empty" when nothing is stored, "ours" when it is this script's version 1 or 2 shape,
 * and "foreign" for anything else, such as a later version's value or damaged text, which the script reads as no
 * notes but never overwrites.
 * @param {unknown} raw
 * @returns {"empty" | "ours" | "foreign"}
 */
export function storedKind(raw) {
  if (raw === null || raw === undefined || raw === "") return "empty";
  if (typeof raw !== "string") return "foreign";
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return "foreign";
  }
  const chapters = isOurVersion(value?.v) ? value.chapters : undefined;
  return typeof chapters === "object" && chapters !== null && !Array.isArray(chapters) ? "ours" : "foreign";
}

/** Reads the store: its chapters, its kind and its raw text, or undefined when storage throws. */
function readStore(storage) {
  try {
    const raw = storage.getItem(KEY);
    return { chapters: parseStored(raw), kind: storedKind(raw), raw: raw ?? "" };
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
  foreign:
    "Nothing was changed: this browser holds notes in a form this page cannot read, saved by a newer or damaged version of the book. Export shows them as stored.",
  gone: "That highlight was deleted in another tab or window. Save to add it back with this note.",
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
    this.items = [];
    this.foreign = false;
    /** The colour the next highlight takes: the one the reader picked last, amber until then. */
    this.color = DEFAULT_COLOR;
    /** The highlights as drawn, each with its range and its paint order, for the click test and the note dots. */
    this.drawn = [];
    this.canPop = typeof win.HTMLElement?.prototype?.showPopover === "function";
    this.reload();
    // The chapter's text model is built once and rebuilt only after the article's text or the attributes that decide
    // which text counts have changed.
    this.model = undefined;
    this.observer = new win.MutationObserver(() => {
      this.model = undefined;
      // Another script changed the article's text, so the ranges and offsets are redrawn once it settles.
      win.clearTimeout(this.repaintTimer);
      this.repaintTimer = win.setTimeout(() => {
        this.paint();
        if (this.dialog.open) this.rerender();
      }, REPAINT_MS);
    });
    this.observer.observe(article, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "aria-live", "role", "data-pagefind-ignore", "id"],
    });
    /** @type {{ anchor: Anchor, start: number, end: number } | undefined} */
    this.pending = undefined;
    this.placed = new Map();
    this.build();
    this.margin = false;
    this.hoverSources = { pointer: undefined, focus: undefined };
    this.paint();
    this.listen();
    // A margin marker follows its passage when the article reflows, so it is placed again when the article's size
    // changes and when fonts finish loading, and the layout switches when the window crosses the gutter's width.
    if (typeof win.ResizeObserver === "function") {
      this.resizer = new win.ResizeObserver(() => this.refit());
      this.resizer.observe(article);
    }
    whenFontsLoad(this.doc, () => this.refit());
  }

  /** Reads this chapter's highlights from storage, and whether the stored value is one this page must not overwrite. */
  reload() {
    const store = readStore(this.storage);
    if (!store) return;
    this.items = store.chapters.get(this.slug) ?? [];
    this.foreign = store.kind === "foreign";
    if (this.warning) this.warning.hidden = !this.foreign;
  }

  /** The chapter's text model, rebuilt only when the article changed since it was last built. */
  chapter() {
    if (this.observer.takeRecords().length > 0) this.model = undefined;
    if (!this.model) this.model = readChapter(this.article);
    return this.model;
  }

  build() {
    const doc = this.doc;
    const ui = { "data-pagefind-ignore": true, "data-notes-ui": true };
    this.live = element(doc, "div", { ...ui, className: "visually-hidden", role: "status" });
    this.swatches = COLORS.map((color) => this.swatch(color));
    this.noteButton = element(doc, "button", { type: "button", className: "control", text: "Add note" });
    this.toolbarMessage = element(doc, "p", { className: "notes-toolbar__message", hidden: true });
    this.toolbar = element(
      doc,
      "div",
      { ...ui, className: "notes-toolbar notes-ui", role: "group", "aria-label": "Selected text", hidden: true },
      [
        element(
          doc,
          "div",
          { className: "notes-colors", role: "group", "aria-label": "Highlight in colour" },
          this.swatches,
        ),
        this.noteButton,
        this.toolbarMessage,
      ],
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
    this.buildPopover(ui);
    this.markers = element(doc, "div", {
      "data-pagefind-ignore": true,
      "data-notes-ui": true,
      className: "notes-markers notes-ui",
    });
    doc.body.append(this.live, this.toolbar, this.openButton, this.dialog, this.pop, this.markers);
    this.updateCount();
  }

  /** A colour button: a swatch beside the colour's name, so colour is never the only cue. */
  swatch(color, pressed) {
    return element(this.doc, "button", {
      type: "button",
      className: `control notes-swatch notes-swatch--${color}`,
      "data-color": color,
      "data-action": `color-${color}`,
      "aria-pressed": pressed === undefined ? undefined : String(pressed),
      text: COLOR_LABELS[color],
    });
  }

  /**
   * The popover a click on a highlight or a note marker opens. It holds, in order, the four colours, the passage as a
   * small quotation, the note as the main text (or a field to write one), and a row of actions.
   */
  buildPopover(ui) {
    const doc = this.doc;
    const action = (name, text, extra = "") =>
      element(doc, "button", {
        type: "button",
        className: `notes-pop__act${extra}`,
        "data-action": name,
        text,
      });
    this.popGrab = element(doc, "div", { className: "notes-pop__grab", "aria-hidden": "true" }, [element(doc, "span")]);
    this.popColors = element(doc, "div", {
      className: "notes-colors",
      role: "group",
      "aria-label": "Highlight colour",
    });
    this.popQuote = element(doc, "p", { className: "notes-pop__quote" });
    this.popNote = element(doc, "p", { className: "notes-pop__note" });
    this.popField = element(doc, "textarea", {
      className: "notes-pop__field",
      rows: 3,
      maxlength: MAX_NOTE,
      placeholder: "Add a note…",
      "aria-label": "Note",
      hidden: true,
    });
    this.popEdit = action("edit", "Edit");
    this.popSave = action("save", "Save");
    this.popCancel = action("cancel", "Cancel");
    this.popShare = action("share", "Share");
    this.popRemove = action("delete", "Remove", " notes-pop__act--remove");
    this.popCopy = element(doc, "textarea", {
      className: "notes-dialog__field",
      rows: 5,
      readonly: true,
      hidden: true,
      "aria-label": "Text to copy",
    });
    this.popMessage = element(doc, "p", { className: "notes-pop__message", role: "status" });
    this.pop = element(
      doc,
      "div",
      { ...ui, className: "notes-pop notes-ui", popover: "auto", role: "dialog", "aria-label": "Highlight" },
      [
        this.popGrab,
        this.popColors,
        this.popQuote,
        this.popNote,
        this.popField,
        element(doc, "div", { className: "notes-pop__actions" }, [
          this.popEdit,
          this.popSave,
          this.popCancel,
          this.popShare,
          this.popRemove,
        ]),
        this.popCopy,
        this.popMessage,
      ],
    );
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
    this.shareField = element(doc, "textarea", {
      className: "notes-dialog__field",
      rows: 5,
      readonly: true,
      hidden: true,
      "aria-label": "Text to copy",
    });
    this.warning = element(doc, "p", {
      className: "notes-dialog__flag",
      text: MESSAGES.foreign,
      hidden: !this.foreign,
    });
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
        this.warning,
        this.status,
        this.shareField,
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
    win.addEventListener("resize", () => {
      this.position();
      this.refit();
    });
    // On iOS Safari a tap fires a click only when an element below the body listens, so the article listens itself.
    this.article.addEventListener("click", (event) => this.onClick(event));
    this.article.addEventListener("keydown", (event) => this.onDotKey(event));
    this.article.addEventListener("keyup", (event) => this.onDotKey(event));
    this.markers.addEventListener("click", (event) => this.onClick(event));
    // A marker brightens its passage while it is hovered or has focus.
    // The pointer and the keyboard focus are tracked apart, so the shade stays while either one is on a marker.
    for (const [type, source, on] of [
      ["mouseover", "pointer", true],
      ["focusin", "focus", true],
      ["mouseout", "pointer", false],
      ["focusout", "focus", false],
    ]) {
      this.markers.addEventListener(type, (event) => {
        const marker = event.target?.closest?.(".notes-marker");
        if (!marker || (type === "mouseout" && marker.contains(event.relatedTarget))) return;
        this.hoverSources[source] = on ? marker.getAttribute("data-id") : undefined;
        this.hover(this.hoverSources.pointer ?? this.hoverSources.focus);
      });
    }
    // A click outside or Escape closes the popover without calling this script.
    // beforetoggle runs synchronously, so a click that follows a light dismiss already sees a closed popover.
    this.pop.addEventListener("toggle", (event) => {
      if (event.newState === "closed") this.restoreDotFocus();
    });
    this.pop.addEventListener("beforetoggle", (event) => {
      if (event.newState !== "closed") return;
      this.popOpen = false;
      this.popId = undefined;
    });
    // A press on the toolbar keeps the selection the reader made.
    this.toolbar.addEventListener("pointerdown", (event) => event.preventDefault());
    this.toolbar.addEventListener("mousedown", (event) => event.preventDefault());
    for (const swatch of this.swatches) {
      swatch.addEventListener("click", () => {
        const color = swatch.getAttribute("data-color") ?? DEFAULT_COLOR;
        const existing = this.pending ? this.existing(this.pending) : undefined;
        if (existing) {
          this.setColor(existing.id, color);
          this.hideToolbar();
          this.pending = undefined;
          this.clearSelection();
          return;
        }
        this.addPending(false, color);
      });
    }
    this.noteButton.addEventListener("click", () => this.addPending(true));
    this.popShare.addEventListener("click", () => this.sharePopped());
    this.popRemove.addEventListener("click", () => this.removePopped());
    this.pop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.popEscaped = true;
    });
    // A rotation or a resize across the sheet's width while the popover is open closes it, since a popover placed
    // beside a passage and a full-width sheet are laid out differently; opening it again lays it out afresh.
    const sheetQuery = typeof win.matchMedia === "function" ? win.matchMedia(SHEET_QUERY) : undefined;
    sheetQuery?.addEventListener?.("change", () => {
      if (this.popOpen && this.pop.hasAttribute("data-sheet") !== sheetQuery.matches) this.closePop();
    });
    this.popEdit.addEventListener("click", () => this.editPopped());
    this.popSave.addEventListener("click", () => this.savePopped());
    this.popCancel.addEventListener("click", () => this.cancelPopped());
    this.popGrab.addEventListener("pointerdown", (event) => this.startSwipe(event));
    this.toolbar.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.hideToolbar();
      this.restoreFocus();
    });
    this.openButton.addEventListener("pointerdown", () => this.onSelection());
    doc.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.target?.closest?.("[data-notes-ui]")) this.pending = undefined;
      },
      { capture: true },
    );
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
      this.reload();
      this.paint();
      this.keepFormText();
      if (this.dialog.open) this.rerender();
      this.refreshPop();
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
        const first = [...this.swatches, this.noteButton].find((button) => !button.disabled);
        (first ?? this.swatches[0]).focus();
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
      // A selection that collapses as focus moves, such as on the way to the Notes button, stays pending; a pointer
      // press elsewhere or a selection outside the article replaces it.
      if (range) this.pending = undefined;
      this.hideToolbar();
      return;
    }
    const chapter = this.chapter();
    const start = chapter.position(range.startContainer, range.startOffset);
    const end = chapter.position(range.endContainer, range.endOffset);
    const built = buildAnchor(chapter.index.text, start, end, chapter.sections);
    if ("reason" in built && built.reason === "empty") {
      this.pending = undefined;
      this.hideToolbar();
      return;
    }
    this.pending = "anchor" in built ? built : undefined;
    // At the cap a passage already highlighted can still take a note; only a new highlight is refused.
    const isNew = this.pending !== undefined && this.existing(this.pending) === undefined;
    const full = isNew && this.items.length >= MAX_HIGHLIGHTS;
    const problem = "reason" in built ? MESSAGES.long : full ? MESSAGES.full : "";
    for (const button of [...this.swatches, this.noteButton]) button.disabled = problem !== "";
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

  /** The stored highlight drawn over exactly the pending passage, if any. */
  existing(pending) {
    return this.items.find((item) => {
      const place = this.placed.get(item.id);
      return place?.status !== "lost" && place?.start === pending.start && place?.end === pending.end;
    });
  }

  /**
   * Highlights the pending selection, or opens the note form for it. The toolbar stays open, with the reason in view,
   * until the highlight is saved.
   */
  addPending(withNote, color = this.color) {
    const pending = this.pending;
    const fromToolbar = this.toolbar.contains(this.doc.activeElement);
    if (!pending) return;
    const existing = this.existing(pending);
    if (!existing && this.items.length >= MAX_HIGHLIGHTS) {
      this.notice(MESSAGES.full);
      return;
    }
    if (!withNote && existing) {
      this.notice("That passage is already highlighted.");
      return;
    }
    if (withNote) {
      this.hideToolbar();
      this.formTarget = existing ? { id: existing.id, anchor: anchorOf(existing) } : { anchor: pending.anchor };
      if (!this.dialog.open) this.open(fromToolbar ? this.returnFocus : this.doc.activeElement);
      this.selectionBlock.hidden = true;
      this.openForm(existing?.note ?? "", pending.anchor.quote);
      this.clearSelection();
      return;
    }
    const item = this.makeItem(pending.anchor, "", color);
    const problem = this.commit([...this.items, item]);
    if (problem) {
      this.notice(problem);
      return;
    }
    this.color = color;
    this.hideToolbar();
    this.say(`Highlighted “${shorten(item.quote)}”.`);
    this.pending = undefined;
    this.clearSelection();
    if (this.dialog.open) {
      this.selectionBlock.hidden = true;
      this.renderList();
      this.list.querySelector("button")?.focus();
    } else if (fromToolbar) this.restoreFocus();
  }

  makeItem(anchor, note, color = this.color) {
    return { id: newId(Date.now(), Math.random()), ...anchor, note: cleanNote(note), at: Date.now(), color };
  }

  clearSelection() {
    try {
      this.win.getSelection()?.removeAllRanges();
    } catch {
      // A browser without a selection to clear has nothing to do here.
    }
  }

  /**
   * Stores the chapter's new list, keeping the other chapters as they are stored now. Gives "" when it was saved, or
   * the message that says why not. A stored value this page cannot read is never overwritten.
   */
  commit(items) {
    const store = readStore(this.storage);
    if (!store) return MESSAGES.storage;
    if (store.kind === "foreign") {
      this.foreign = true;
      this.warning.hidden = false;
      return MESSAGES.foreign;
    }
    store.chapters.set(this.slug, items);
    if (!writeAll(this.storage, store.chapters)) return MESSAGES.storage;
    this.items = items;
    this.paint();
    return "";
  }

  say(message) {
    this.live.textContent = "";
    this.live.textContent = message;
    if (this.dialog.open) this.status.textContent = message;
  }

  /** Says why an action failed where the reader is looking: the toolbar while it is open, and the panel. */
  notice(message) {
    this.say(message);
    if (this.toolbar.hidden) return;
    this.toolbarMessage.textContent = message;
    this.toolbarMessage.hidden = false;
    this.position();
  }

  paint() {
    const { win, doc } = this;
    const focusedId = this.focusedNoteId();
    // The dots from the last paint split the article's text nodes, so they go and the nodes are joined again before the
    // chapter's text is read.
    this.clearDots();
    const chapter = this.chapter();
    const groups = new Map(HIGHLIGHT_NAMES.map((name) => [name, []]));
    this.placed = new Map();
    this.drawn = [];
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
      const name = highlightName(item.color, item.note !== "");
      groups.get(name)?.push(range);
      // A noted name has priority 1 and registers after the plain ones, so it paints above them: the order a click
      // follows when highlights overlap.
      this.drawn.push({ item, range, rank: (item.note ? 1000 : 0) + HIGHLIGHT_NAMES.indexOf(name) });
    }
    // Deleting before setting keeps the registration order the same on every paint, which breaks priority ties.
    for (const [name, ranges] of groups) {
      const highlight = new win.Highlight(...ranges);
      highlight.priority = name.startsWith("manual-note-") ? 1 : 0;
      win.CSS.highlights.delete(name);
      win.CSS.highlights.set(name, highlight);
    }
    this.margin = this.hasGutter();
    if (this.margin) {
      this.layoutMarkers();
    } else {
      this.markers.replaceChildren();
      this.placeDots();
    }
    // A marker that is gone, as when the window narrows to dots, can no longer send its mouseout or focusout, so a
    // hover or focus source that names one is cleared here.
    for (const source of ["pointer", "focus"]) {
      const id = this.hoverSources[source];
      if (![...this.markers.children].some((marker) => marker.getAttribute("data-id") === id)) {
        this.hoverSources[source] = undefined;
      }
    }
    this.hover(this.hoverSources.pointer ?? this.hoverSources.focus);
    if (focusedId !== undefined) this.noteControl(focusedId)?.focus({ preventScroll: true });
    this.updateCount();
  }

  /** The right edge of the chapter's text column: its first paragraph, which the article's box is wider than. */
  columnRight() {
    return (this.article.querySelector("p") ?? this.article).getBoundingClientRect().right;
  }

  /**
   * Whether the window leaves room for a margin marker beside the text column, and beside every noted passage's own
   * block, which runs past the column in a table or a quote. When any block is too wide, every note gets a dot.
   */
  hasGutter() {
    const { win, doc } = this;
    let edge = this.columnRight();
    for (const { item, range } of this.drawn) {
      if (!item.note) continue;
      const node = range.startContainer;
      const block = (node.nodeType === 1 ? node : node.parentElement)?.closest(BLOCK);
      if (block) edge = Math.max(edge, block.getBoundingClientRect().right);
    }
    return (doc.documentElement.clientWidth || win.innerWidth) - edge >= GUTTER_MIN;
  }

  /** Places the margin markers again, or switches between markers and dots when the window crossed the gutter's width. */
  refit() {
    if (this.hasGutter() !== this.margin) this.paint();
    else if (this.margin) this.layoutMarkers();
  }

  /** The id of the note whose dot or marker has keyboard focus, so a redraw can give the focus back. */
  focusedNoteId() {
    const active = this.doc.activeElement;
    const control = active?.closest?.(".notes-dot, .notes-marker");
    return control?.getAttribute("data-id") ?? undefined;
  }

  /** The dot or the marker of a note. */
  noteControl(id) {
    for (const control of this.doc.querySelectorAll(".notes-dot, .notes-marker")) {
      if (control.getAttribute("data-id") === id) return control;
    }
    return undefined;
  }

  /** Brightens a note's passage while its marker is hovered or focused: one stronger shade of its own colour. */
  hover(id) {
    const { win } = this;
    this.hovered = id;
    for (const color of COLORS) win.CSS.highlights.delete(`manual-hover-${color}`);
    const entry = id === undefined ? undefined : this.drawn.find((drawn) => drawn.item.id === id);
    if (!entry) return;
    const highlight = new win.Highlight(entry.range);
    highlight.priority = 2;
    win.CSS.highlights.set(`manual-hover-${colorKey(entry.item.color)}`, highlight);
  }

  /** The number of each noted highlight the page draws, in the order the notes panel lists them, from 1. */
  noteNumbers() {
    const numbers = new Map();
    for (const item of this.ordered()) {
      const place = this.placed.get(item.id);
      if (item.note && place && place.status !== "lost" && this.drawn.some((entry) => entry.item.id === item.id)) {
        numbers.set(item.id, numbers.size + 1);
      }
    }
    return numbers;
  }

  /**
   * Takes every dot out of the article and joins the text nodes each one split. The article's own mutation records are
   * dropped, because the change is this script's, and the chapter's text model is read again.
   */
  clearDots() {
    let removed = false;
    for (const dot of this.article.querySelectorAll(".notes-dot")) {
      const before = dot.previousSibling;
      const after = dot.nextSibling;
      dot.remove();
      removed = true;
      // Only the two text nodes the dot split are joined again, never any other text node in the parent.
      if (before?.nodeType === 3 && after?.nodeType === 3) {
        before.appendData(after.data);
        after.remove();
      }
    }
    // A paint reads the DOM as it is now, so records a script left before it are covered by this paint, and records
    // from the changes above are this script's own.
    const pending = this.observer.takeRecords().length > 0;
    if (removed || pending) this.model = undefined;
  }

  /**
   * Draws one speech-bubble marker in the margin for each noted highlight, level with the passage's first line, in the
   * gutter beside the article. Nothing is added to the article. The markers live in their own container, in page
   * coordinates; two that begin close together are stacked so they never overlap.
   */
  layoutMarkers() {
    const { win, doc } = this;
    const numbers = this.noteNumbers();
    const column = this.columnRight();
    const width = doc.documentElement.clientWidth || win.innerWidth;
    const placed = [];
    for (const { item, range } of this.drawn) {
      const number = numbers.get(item.id);
      const first = [...range.getClientRects()][0];
      if (number === undefined || !first) continue;
      // Beside the passage's own block when that runs past the column, such as a table, and never off the window.
      const startNode = range.startContainer;
      const block = (startNode.nodeType === 1 ? startNode : startNode.parentElement)?.closest(BLOCK);
      const edge = Math.max(column, block ? block.getBoundingClientRect().right : 0);
      const left = Math.min(edge + MARKER_GAP, width - MARKER_SIZE - 4);
      placed.push({ item, number, left, top: first.top + first.height / 2 - MARKER_SIZE / 2 });
    }
    placed.sort((a, b) => a.top - b.top || a.number - b.number);
    // A marker that is already in place is moved, not replaced, so one that has focus or the pointer keeps it.
    const existing = new Map([...this.markers.children].map((marker) => [marker.getAttribute("data-id"), marker]));
    const markers = [];
    let floor = Number.NEGATIVE_INFINITY;
    for (const { item, number, left, top } of placed) {
      const y = Math.max(top, floor);
      floor = y + MARKER_SIZE + 4;
      let marker = existing.get(item.id);
      if (!marker) {
        marker = element(doc, "button", {
          type: "button",
          className: "notes-marker",
          "data-id": item.id,
          "data-notes-ui": true,
        });
        marker.append(bubble(doc));
      }
      marker.setAttribute("aria-label", `Note ${number}`);
      marker.setAttribute("data-n", String(number));
      marker.setAttribute("data-color", colorKey(item.color));
      // Set through the CSSOM, which the content security policy allows where a style attribute would be blocked.
      marker.style.left = `${Math.round(left + win.scrollX)}px`;
      marker.style.top = `${Math.round(y + win.scrollY)}px`;
      markers.push(marker);
    }
    // Only a change in the set of markers or their order touches the container, which keeps the focus where it is.
    const same =
      markers.length === this.markers.children.length &&
      markers.every((marker, i) => marker === this.markers.children[i]);
    if (!same) {
      const focusedId = this.focusedNoteId();
      this.markers.replaceChildren(...markers);
      if (focusedId !== undefined) this.noteControl(focusedId)?.focus({ preventScroll: true });
    }
  }

  /**
   * Puts a numbered dot right after the last word of each noted passage, as an inline element the line reserves room
   * for, so it never sits on a character. The dot holds no text (its number is generated content), is skipped by the
   * chapter's text model, and stays out of Pagefind's index, copy and paste and every stored anchor. It goes after an
   * inline element the passage ends in, such as a link, never inside it.
   */
  placeDots() {
    const { doc } = this;
    const numbers = this.noteNumbers();
    let placed = false;
    // Highest number first, so two dots that land at one point read in number order after the later ones are inserted.
    const noted = this.drawn.filter(({ item }) => numbers.has(item.id));
    noted.sort((a, b) => (numbers.get(b.item.id) ?? 0) - (numbers.get(a.item.id) ?? 0));
    for (const { item, range } of noted) {
      const number = numbers.get(item.id);
      const dot = element(doc, "span", {
        className: "notes-dot",
        role: "button",
        tabindex: "0",
        "aria-label": `Note ${number}`,
        "data-id": item.id,
        "data-n": String(number),
        "data-color": colorKey(item.color),
        "data-notes-ui": true,
        "data-pagefind-ignore": true,
      });
      const point = range.cloneRange();
      point.collapse(false);
      this.outOfInline(point);
      point.insertNode(dot);
      placed = true;
    }
    // The dots split text nodes, so the model's node list is stale; the text it joins is the same.
    const others = this.observer.takeRecords().length > 0;
    if (placed || others) this.model = undefined;
  }

  /**
   * Moves a collapsed point out of every inline element the passage ends at the end of, so a dot never lands in a link
   * or in code. Trailing text that is white space only, or that the text model skips (a glossary card), is no content.
   */
  outOfInline(point) {
    let node = point.endContainer;
    const length = node.nodeType === 3 ? node.data.length : node.childNodes.length;
    if (point.endOffset < length) return;
    while (node !== this.article) {
      const parent = node.parentElement;
      if (!parent || parent === this.article || parent.matches(BLOCK) || !parent.matches(INLINE)) break;
      let more = false;
      for (let next = node.nextSibling; next && !more; next = next.nextSibling) {
        more = next.nodeType === 3 ? next.data.trim() !== "" : next.nodeType === 1 && !next.matches(NOT_TEXT);
      }
      if (more) return;
      node = parent;
      point.setStartAfter(node);
      point.collapse(true);
    }
    // A button inside a heading would become part of its accessible name, so a dot goes after the heading.
    const heading = (node.nodeType === 1 ? node : node.parentElement)?.closest("h2, h3, h4");
    if (heading && this.article.contains(heading)) {
      point.setStartAfter(heading);
      point.collapse(true);
    }
  }

  /** The highlight that paints on top where the point falls inside a range's rectangles, within two pixels. */
  hit(x, y) {
    const slack = 2;
    let best;
    for (const entry of this.drawn) {
      const inside = [...entry.range.getClientRects()].some(
        (rect) =>
          x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack,
      );
      if (inside && (!best || entry.rank >= best.rank)) best = entry;
    }
    return best;
  }

  /** A click on a highlight or a note dot opens the popover; a click on a link, a control or a drag does not. */
  onClick(event) {
    const { win } = this;
    const target = event.target;
    if (!this.canPop || this.dialog.open || event.defaultPrevented || event.button > 0) return;
    if (typeof target?.closest !== "function") return;
    const marker = target.closest(".notes-dot, .notes-marker");
    if (!marker && target.closest("[data-notes-ui]")) return;
    if (!marker) {
      if (!this.article.contains(target)) return;
      if (target.closest("a[href], button, input, textarea, select, summary, label, [role='button']")) return;
      if (win.getSelection()?.isCollapsed === false) return;
    }
    const entry = marker
      ? this.drawn.find((drawn) => drawn.item.id === marker.getAttribute("data-id"))
      : this.hit(event.clientX, event.clientY);
    if (!entry) return;
    // A marker is a button, so Enter and Space reach it as a click with no pointer position: its own place stands in.
    const box = marker ? marker.getBoundingClientRect() : undefined;
    const byKeyboard = marker !== null && event.detail === 0;
    this.popFromKey = byKeyboard;
    this.openPop(entry, box ? box.left + box.width / 2 : event.clientX, box ? box.top + box.height / 2 : event.clientY);
  }

  /**
   * Enter or Space on a focused note dot opens the popover, as a click does. Enter acts on keydown and Space on keyup,
   * like a button, so the keyup of a Space that opened the popover never lands on a colour button inside it.
   */
  onDotKey(event) {
    const target = event.target;
    if (typeof target?.closest !== "function") return;
    const dot = target.closest(".notes-dot");
    const down = event.type === "keydown";
    if (!dot || !this.canPop || this.dialog.open) return;
    if (event.key === " " && down) event.preventDefault();
    if (!(down ? event.key === "Enter" : event.key === " ")) return;
    const entry = this.drawn.find((drawn) => drawn.item.id === dot.getAttribute("data-id"));
    if (!entry) return;
    event.preventDefault();
    const box = dot.getBoundingClientRect();
    this.popFromKey = true;
    this.openPop(entry, box.left + box.width / 2, box.top + box.height / 2);
  }

  /**
   * After the popover closes on a keyboard path, opened from the keyboard or closed with Escape, focus goes back to the
   * marker it was opened from. A click outside leaves focus where the reader put it.
   */
  restoreDotFocus() {
    const id = this.popReturnId;
    const byKeyboard = this.popFromKey || this.popEscaped;
    this.popReturnId = undefined;
    this.popFromKey = false;
    this.popEscaped = false;
    if (id === undefined || !byKeyboard) return;
    const active = this.doc.activeElement;
    if (active && active !== this.doc.body && active !== this.doc.documentElement) return;
    this.noteControl(id)?.focus({ preventScroll: true });
  }

  /** Whether the window is narrow enough that the popover is a bottom sheet. */
  isSheet() {
    return typeof this.win.matchMedia === "function" && this.win.matchMedia(SHEET_QUERY).matches;
  }

  /**
   * Opens the popover for a highlight: beside the passage on a wide window, as a bottom sheet on a narrow one, with
   * focus on its first control.
   */
  openPop(entry, x, y) {
    const { win } = this;
    const item = entry.item;
    this.popId = item.id;
    this.popReturnId = item.id;
    this.popEscaped = false;
    // A copy of the highlight as it was when the popover opened, so a Save after another tab deleted it can add it back.
    this.popItem = { ...item };
    this.popMessage.textContent = "";
    this.popCopy.hidden = true;
    this.popEditing = false;
    this.popField.value = item.note;
    const sheet = this.isSheet();
    this.pop.toggleAttribute("data-sheet", sheet);
    this.pop.style.transform = "";
    this.renderPop();
    try {
      if (!this.popOpen) this.pop.showPopover();
    } catch {
      return;
    }
    this.popOpen = true;
    if (sheet) {
      this.pop.style.top = "";
      this.pop.style.left = "";
    } else {
      const box = this.pop.getBoundingClientRect();
      const width = this.doc.documentElement.clientWidth || win.innerWidth;
      const gap = 8;
      // Beside the passage, not over it: below its last line, or above its first when the window has no room below.
      const rects = [...entry.range.getClientRects()];
      const first = rects[0];
      const last = rects[rects.length - 1];
      const below = (last ? last.bottom : y + 8) + gap;
      const above = (first ? first.top : y - 8) - gap - box.height;
      const top = below + box.height <= win.innerHeight - gap || above < gap ? below : above;
      const left = Math.max(gap, Math.min(x - 16, width - box.width - gap));
      this.pop.style.top = `${Math.round(Math.max(gap, Math.min(top, win.innerHeight - box.height - gap)))}px`;
      this.pop.style.left = `${Math.round(left)}px`;
    }
    this.popColors.querySelector("button")?.focus({ preventScroll: true });
  }

  /**
   * The popover's colours, quotation, note or note field, and actions for the highlight it is open on. Every piece of
   * text goes in as text. A plain highlight, or a note being edited, shows the field.
   */
  renderPop() {
    const item = this.items.find((other) => other.id === this.popId);
    if (!item) return;
    const writing = this.popEditing || item.note === "";
    this.popQuote.textContent = item.quote;
    // The full passage is the tooltip, since the quotation is clamped to a few lines.
    this.popQuote.setAttribute("title", item.quote);
    this.popQuote.setAttribute("data-color", colorKey(item.color));
    this.popNote.textContent = item.note;
    this.popNote.hidden = writing;
    this.popField.hidden = !writing;
    this.popColors.replaceChildren(...COLORS.map((color) => this.colorButton(item, color)));
    this.popEdit.hidden = writing;
    this.popSave.hidden = !writing;
    this.popCancel.hidden = !(writing && item.note !== "");
    this.popShare.hidden = this.placed.get(item.id)?.status === "lost";
  }

  /** Edit turns the note into a field with the note's text in it. */
  editPopped() {
    const item = this.items.find((other) => other.id === this.popId);
    if (!item) return;
    this.popEditing = true;
    this.popField.value = item.note;
    this.renderPop();
    this.popField.focus({ preventScroll: true });
  }

  /** Cancel drops what was typed and shows the note again. */
  cancelPopped() {
    const item = this.items.find((other) => other.id === this.popId);
    this.popEditing = false;
    if (item) this.popField.value = item.note;
    this.renderPop();
    this.popEdit.focus({ preventScroll: true });
  }

  /**
   * Save writes the field's text as the highlight's note, from the stored list, so another tab's changes are kept. If
   * the highlight was deleted in another tab, Save adds it back with the note, as the panel's form does.
   */
  savePopped() {
    this.reload();
    if (this.foreign) {
      this.say(MESSAGES.foreign);
      this.popMessage.textContent = MESSAGES.foreign;
      return;
    }
    const note = cleanNote(this.popField.value);
    let item = this.items.find((other) => other.id === this.popId);
    let items;
    if (item) {
      // Nothing changes when the text is the same, so nothing is written or announced.
      if (note === item.note) {
        this.popEditing = false;
        this.renderPop();
        return;
      }
      const current = item;
      items = this.items.map((other) => (other.id === current.id ? { ...other, note, at: Date.now() } : other));
    } else if (this.popItem) {
      item = this.makeItem(anchorOf(this.popItem), note, this.popItem.color);
      items = [...this.items, item];
    } else {
      this.say(MESSAGES.gone);
      this.popMessage.textContent = MESSAGES.gone;
      return;
    }
    const before = this.items.find((other) => other.id === this.popId)?.note ?? "";
    const problem = this.commit(items);
    if (problem) {
      this.say(problem);
      this.popMessage.textContent = problem;
      return;
    }
    this.popId = item.id;
    this.popReturnId = item.id;
    this.popItem = { ...item, note };
    this.popEditing = false;
    this.popMessage.textContent = "";
    this.say(note === "" && before !== "" ? "Note removed." : "Note saved.");
    this.popField.value = note;
    this.renderPop();
    (note === "" ? this.popField : this.popEdit).focus({ preventScroll: true });
  }

  /**
   * Brings an open popover up to date after another tab changed the stored notes: the highlight, its colour and its
   * note are read again, a highlight that is gone closes the popover, and text the reader is typing is kept.
   */
  refreshPop() {
    if (!this.popOpen) return;
    const item = this.items.find((other) => other.id === this.popId);
    if (!item) {
      // A reader who is writing a note keeps the popover, and Save adds the highlight back.
      if (this.popField.value !== (this.popItem?.note ?? "")) return;
      this.closePop();
      return;
    }
    // The field is the reader's while a note is being written or edited, which a plain highlight always is.
    const writing = this.popEditing || (this.popItem?.note ?? "") === "";
    if (!writing) this.popField.value = item.note;
    // Typed text on a highlight that gained a note in another tab stays in the field as an edit, not dropped.
    else if (!this.popEditing && item.note !== "" && this.popField.value.trim() !== "") this.popEditing = true;
    this.popItem = { ...item };
    const active = this.doc.activeElement;
    const color = this.pop.contains(active) ? active?.getAttribute?.("data-color") : null;
    this.renderPop();
    // The colour buttons are rebuilt, so one that had focus gets it back.
    if (color) this.popColors.querySelector(`[data-color="${color}"]`)?.focus({ preventScroll: true });
  }

  /**
   * Starts a swipe on the sheet's handle: the sheet follows the finger down, and lets go closes it past a distance and
   * springs back before that.
   */
  startSwipe(event) {
    const { win } = this;
    if (!this.pop.hasAttribute("data-sheet")) return;
    const start = event.clientY;
    const pointer = event.pointerId;
    let distance = 0;
    // Only the pointer that grabbed the handle drives the sheet; another finger's moves and release are ignored.
    const move = (next) => {
      if (next.pointerId !== pointer) return;
      distance = Math.max(0, next.clientY - start);
      this.pop.style.transform = `translateY(${Math.round(distance)}px)`;
    };
    const end = (last) => {
      if (last?.pointerId !== pointer) return;
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", end);
      win.removeEventListener("pointercancel", end);
      this.pop.style.transform = "";
      if (distance > SWIPE_CLOSE) this.closePop();
    };
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", end);
    win.addEventListener("pointercancel", end);
  }

  /** A colour button on a highlight, pressed when the highlight has that colour. */
  colorButton(item, color) {
    const button = this.swatch(color, highlightName(item.color, false) === highlightName(color, false));
    button.addEventListener("click", () => this.setColor(item.id, color));
    return button;
  }

  /** Gives a highlight another colour. A colour this script did not write stays as stored until the reader picks one. */
  setColor(id, color) {
    this.reload();
    if (this.foreign) {
      this.say(MESSAGES.foreign);
      this.popMessage.textContent = MESSAGES.foreign;
      return;
    }
    const target = this.items.find((item) => item.id === id);
    if (!target) return;
    const problem = this.commit(this.items.map((item) => (item.id === id ? { ...item, color } : item)));
    if (problem) {
      this.say(problem);
      this.popMessage.textContent = problem;
      return;
    }
    this.color = color;
    this.say(`Highlight colour changed to ${COLOR_LABELS[color].toLowerCase()}.`);
    this.renderPop();
    if (this.dialog.open) this.rerender();
    // The panel redraws its rows, so focus goes to the same colour in the row; otherwise it stays in the popover.
    const row = this.dialog.open ? [...this.list.children].find((child) => child.getAttribute("data-id") === id) : null;
    const scope = row ?? this.popColors;
    (scope.querySelector(`[data-color="${color}"]`) ?? this.popShare).focus({ preventScroll: true });
  }

  /** Removes the highlight the popover is open on, and closes the popover. */
  removePopped() {
    this.reload();
    if (this.foreign) {
      this.say(MESSAGES.foreign);
      this.popMessage.textContent = MESSAGES.foreign;
      return;
    }
    const item = this.items.find((other) => other.id === this.popId);
    if (!item) {
      this.closePop();
      return;
    }
    const problem = this.commit(this.items.filter((other) => other.id !== item.id));
    if (problem) {
      this.say(problem);
      this.popMessage.textContent = problem;
      return;
    }
    this.closePop();
    this.say(`Deleted the highlight on “${shorten(item.quote)}”.`);
  }

  closePop() {
    try {
      if (this.popOpen) this.pop.hidePopover();
    } catch {
      // A popover that is already closed has nothing to do here.
    }
    this.popOpen = false;
    this.popId = undefined;
  }

  /** Copies what Share offers for the highlight the popover is open on. */
  sharePopped() {
    this.reload();
    const item = this.items.find((other) => other.id === this.popId);
    if (!item) return;
    this.share(item, {
      say: (message) => {
        this.popMessage.textContent = message;
        this.say(message);
      },
      field: this.popCopy,
    });
  }

  /**
   * The text Share copies for a highlight: the passage, the chapter's title and a link that scrolls to the passage.
   * Never the note. Gives "" when the passage is not on the page.
   */
  shareFor(item) {
    const entry = this.drawn.find((drawn) => drawn.item.id === item.id);
    const place = this.placed.get(item.id);
    if (!entry || !place || place.status === "lost") return "";
    const { doc, win } = this;
    const chapter = this.chapter();
    const range = entry.range;
    const blockOf = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest(BLOCK) ?? this.article;
    const startBlock = blockOf(range.startContainer);
    const endBlock = blockOf(range.endContainer);
    // Only the prose the reader sees: text the chapter model leaves out, such as a glossary card, is never rendered.
    const part = (from, to) => {
      const piece = doc.createRange();
      piece.setStart(from.node, from.offset);
      piece.setEnd(to.node, to.offset);
      return chapter.nodes
        .filter((node) => piece.intersectsNode(node))
        .map((node) => {
          const begin = node === piece.startContainer ? piece.startOffset : 0;
          const finish = node === piece.endContainer ? piece.endOffset : node.data.length;
          return node.data.slice(begin, finish);
        })
        .join("");
    };
    const blockStart = { node: startBlock, offset: 0 };
    const blockEnd = (block) => ({ node: block, offset: block.childNodes.length });
    const here = { node: range.startContainer, offset: range.startOffset };
    const there = { node: range.endContainer, offset: range.endOffset };
    const spans = startBlock !== endBlock;
    // The passage as drawn now, which differs from the stored words when the highlight has moved.
    const quote = chapter.index.text.slice(place.start, place.end).trim();
    const section = chapter.sections[sectionAt(chapter.sections, place.start)]?.id ?? "";
    const parts = {
      quote,
      before: part(blockStart, here),
      after: part(there, blockEnd(endBlock)),
      first: spans ? part(here, blockEnd(startBlock)) : quote,
      last: spans ? part({ node: endBlock, offset: 0 }, there) : quote,
      spans,
    };
    const pageText = pageTextOutsideNotes(doc);
    const base = `${win.location.origin}${win.location.pathname}${win.location.search}`;
    const title = doc.querySelector("h1")?.textContent ?? doc.title;
    return shareText(quote, title, shareLink(base, section, textDirective(parts, pageText)));
  }

  /**
   * Copies Share's text to the clipboard. When the browser refuses, the text appears in a field with its text selected
   * to copy by hand. Nothing is sent anywhere.
   */
  share(item, surface) {
    const text = this.shareFor(item);
    if (text === "") return;
    surface.field.value = text;
    const fallback = () => {
      surface.field.hidden = false;
      surface.say("Select the text below and copy it.");
      surface.field.focus();
      surface.field.select();
    };
    const clipboard = this.win.navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      fallback();
      return;
    }
    clipboard.writeText(text).then(() => {
      surface.field.hidden = true;
      surface.say("Copied the passage and its link to the clipboard.");
    }, fallback);
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
    this.closePop();
    this.hideToolbar();
    this.status.textContent = "";
    this.shareField.hidden = true;
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
    if (this.jumping && opener) {
      this.jumping = false;
      this.reveal(opener);
      return;
    }
    // The browser has already returned focus to the element focused before the panel opened. Only when that element
    // is gone or hidden, as the toolbar is, does focus need a new place.
    const active = this.doc.activeElement;
    if (active && active !== this.doc.body && !this.dialog.contains(active)) return;
    if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
    else this.openButton.focus();
  }

  /** Renders the list again and puts focus back on the same control of the same row, if both are still there. */
  rerender() {
    const active = this.doc.activeElement;
    const row = this.list.contains(active) ? active.closest("[data-id]") : null;
    const id = row?.getAttribute("data-id");
    const action = active?.getAttribute?.("data-action");
    this.renderList();
    if (!row) return;
    const again = [...this.list.children].find((child) => child.getAttribute("data-id") === id);
    const target =
      [...(again?.querySelectorAll("button") ?? [])].find((button) => button.getAttribute("data-action") === action) ??
      again?.querySelector("button");
    (target ?? this.closeButton).focus();
  }

  renderList() {
    const doc = this.doc;
    const items = this.ordered();
    const numbers = this.noteNumbers();
    this.empty.hidden = items.length > 0;
    this.list.replaceChildren(
      ...items.map((item) => {
        const place = this.placed.get(item.id) ?? { status: "lost" };
        const buttons = [];
        if (place.status !== "lost") {
          const go = element(doc, "button", {
            type: "button",
            className: "control",
            "data-action": "go",
            text: "Go to passage",
          });
          go.addEventListener("click", () => this.jump(item));
          buttons.push(go);
        }
        const edit = element(doc, "button", {
          type: "button",
          className: "control",
          "data-action": "edit",
          text: item.note ? "Edit note" : "Add note",
        });
        edit.addEventListener("click", () => {
          this.formTarget = { id: item.id, anchor: anchorOf(item) };
          this.selectionBlock.hidden = true;
          this.openForm(item.note, item.quote, edit);
        });
        const remove = element(doc, "button", {
          type: "button",
          className: "control",
          "data-action": "delete",
          text: "Delete",
        });
        remove.addEventListener("click", () => this.remove(item));
        buttons.push(edit, remove);
        if (place.status !== "lost") {
          const share = element(doc, "button", {
            type: "button",
            className: "control",
            "data-action": "share",
            text: "Share",
          });
          share.addEventListener("click", () =>
            this.share(item, { say: (message) => this.say(message), field: this.shareField }),
          );
          buttons.push(share);
        }
        const colors = element(
          doc,
          "div",
          { className: "notes-colors", role: "group", "aria-label": "Highlight colour" },
          COLORS.map((color) => this.colorButton(item, color)),
        );
        const parts = [element(doc, "blockquote", { className: "notes-dialog__quote", text: item.quote })];
        const number = numbers.get(item.id);
        // The number on the dot after the passage, so a dot and its note in this list can be matched.
        if (number !== undefined)
          parts.unshift(element(doc, "p", { className: "notes-dialog__label label", text: `Note ${number}` }));
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
        parts.push(element(doc, "div", { className: "notes-dialog__actions" }, buttons), colors);
        return element(doc, "li", { className: "notes-dialog__item", "data-id": item.id }, parts);
      }),
    );
  }

  openForm(note, quote, returnTo) {
    this.formReturn = returnTo;
    this.formQuote.textContent = shorten(quote, 300);
    this.noteField.value = note;
    this.updateNoteCount();
    this.empty.hidden = true;
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
    // Another tab may have changed this chapter's highlights since the form opened.
    this.reload();
    if (this.foreign) {
      // The stored value is one this script cannot read, so every highlight reads as missing; say why instead.
      this.say(MESSAGES.foreign);
      return;
    }
    if ("id" in target && !this.items.some((item) => item.id === target.id)) {
      this.keepFormText();
      this.say(MESSAGES.gone);
      return;
    }
    // A passage another tab highlighted meanwhile takes the note instead of a second highlight.
    const same = "anchor" in target ? this.items.find((item) => sameAnchor(item, target.anchor)) : undefined;
    const id = "id" in target ? target.id : same?.id;
    let items;
    if (id === undefined) {
      if (this.items.length >= MAX_HIGHLIGHTS) {
        this.say(MESSAGES.full);
        return;
      }
      const item = this.makeItem(target.anchor, note);
      items = [...this.items, item];
    } else {
      items = this.items.map((item) => (item.id === id ? { ...item, note, at: Date.now() } : item));
    }
    const problem = this.commit(items);
    if (problem) {
      this.say(problem);
      return;
    }
    const savedId = id ?? items[items.length - 1]?.id;
    this.formTarget = undefined;
    this.formReturn = undefined;
    this.form.hidden = true;
    this.selectionBlock.hidden = true;
    this.pending = undefined;
    this.renderList();
    this.say(note ? "Note saved." : "Highlight saved without a note.");
    this.focusItem(savedId);
  }

  /**
   * Keeps the note form usable when the highlight it edits is gone: the form stays open with the reader's text, and
   * its next save adds the highlight back from the anchor it had.
   */
  keepFormText() {
    const target = this.formTarget;
    if (!target || !("id" in target) || this.items.some((item) => item.id === target.id)) return;
    this.formTarget = { anchor: target.anchor };
    if (!this.form.hidden) this.say(MESSAGES.gone);
  }

  focusItem(id) {
    const row = [...this.list.children].find((child) => child.getAttribute("data-id") === id);
    const button = row?.querySelector("button");
    (button ?? this.closeButton).focus();
  }

  remove(item) {
    const rows = [...this.list.children];
    const index = rows.findIndex((row) => row.getAttribute("data-id") === item.id);
    const problem = this.commit(this.items.filter((other) => other.id !== item.id));
    if (problem) {
      this.say(problem);
      return;
    }
    // A note form open on the deleted highlight closes with it; the reader chose to delete it.
    if (this.formTarget && "id" in this.formTarget && this.formTarget.id === item.id) {
      this.form.hidden = true;
      this.formTarget = undefined;
      this.formReturn = undefined;
    }
    this.renderList();
    this.say(`Deleted the highlight on “${shorten(item.quote)}”.`);
    const next = this.list.children[Math.min(index, this.list.children.length - 1)];
    (next?.querySelector("button") ?? this.exportButton).focus();
  }

  jump(item) {
    const chapter = this.chapter();
    const located = locate(chapter.index.text, item, chapter.sections);
    if (located.status === "lost") return;
    const from = rawPoint(chapter.index, located.start, "start");
    const node = from && chapter.nodes[from.seg];
    const block = node?.parentElement?.closest("p, li, blockquote, td, th, dd, dt, h2, h3, h4, figcaption, aside");
    // The dialog's close event runs after the browser has returned focus to the opener, so the move happens there.
    if (block) {
      this.opener = block;
      this.jumping = true;
    }
    this.dialog.close();
  }

  /** Scrolls a passage's block into view and gives it focus, so the keyboard continues from the passage. */
  reveal(block) {
    const { win } = this;
    // The block then gives up the tabindex it took for this.
    if (!block.hasAttribute("tabindex")) {
      block.setAttribute("tabindex", "-1");
      block.addEventListener("blur", () => block.removeAttribute("tabindex"), { once: true });
    }
    const still = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    block.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    block.focus({ preventScroll: true });
  }

  exportMarkdown() {
    const { doc, win } = this;
    const title = doc.querySelector("h1")?.textContent ?? doc.title;
    const url = `${win.location.origin}${win.location.pathname}`;
    const items = this.ordered().map((item) => ({ ...item, status: this.placed.get(item.id)?.status ?? "lost" }));
    // Notes this page cannot read are exported exactly as stored, so the reader keeps them.
    const raw = this.foreign ? (readStore(this.storage)?.raw ?? "") : "";
    const markdown = this.foreign ? raw : toMarkdown(title, url, items);
    this.download.setAttribute("download", this.foreign ? "notes-as-stored.txt" : `notes-${this.slug}.md`);
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

/**
 * The page's text without this script's own interface, which quotes the passage and would count as a repeat of it. A
 * text directive searches the whole page, so hidden text, such as a closed glossary card, counts too: over-counting
 * only adds context to a link, which does no harm.
 * @param {Document} doc
 * @returns {string}
 */
export function pageTextOutsideNotes(doc) {
  const walker = doc.createTreeWalker(doc.body, 4);
  const parts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("[data-notes-ui], script, style, template")) continue;
    parts.push(node.data);
  }
  return parts.join(" ");
}

// The blocks a text directive's terms must each sit inside.
const BLOCK = "p, li, blockquote, td, th, dd, dt, h2, h3, h4, figcaption, aside";

// The inline elements a note dot is kept out of, so it never lands inside a link or a run of code.
const INLINE =
  "a, em, strong, code, b, i, u, s, mark, abbr, cite, kbd, sub, sup, span, small, del, ins, q, time, var, samp, dfn, bdi, bdo, ruby";

// The popover is a bottom sheet in a window this narrow, and a swipe down of this many pixels closes it.
const SHEET_QUERY = "(max-width: 40rem)";
const SWIPE_CLOSE = 80;

// A margin marker is 28 pixels across and sits 8 pixels from the text column, so it needs this much free room beside the
// column; a narrower window gets the inline dot instead.
const MARKER_SIZE = 28;
const MARKER_GAP = 8;
const GUTTER_MIN = 44;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Calls back when the page's fonts finish loading, since they change where a line ends. */
function whenFontsLoad(doc, callback) {
  try {
    doc.fonts?.ready?.then(callback);
    doc.fonts?.addEventListener?.("loadingdone", callback);
  } catch {
    // A browser without font events keeps the markers where the layout placed them.
  }
}

/** The speech-bubble icon of a margin marker, built as DOM nodes so the script writes no markup. */
function bubble(doc) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2 3.5h12v7H8.5L5 13.5v-3H2z");
  svg.append(path);
  return svg;
}

const anchorOf = (item) => ({
  quote: item.quote,
  prefix: item.prefix,
  suffix: item.suffix,
  section: item.section,
  offset: item.offset,
});

const sameAnchor = (item, anchor) =>
  item.quote === anchor.quote &&
  item.prefix === anchor.prefix &&
  item.suffix === anchor.suffix &&
  item.section === anchor.section;

function shorten(text, max = 60) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

if (typeof window !== "undefined" && typeof document !== "undefined") start(window);
