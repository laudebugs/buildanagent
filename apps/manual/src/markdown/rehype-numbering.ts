import type { Element, ElementContent, Root, Text } from "hast";
import { SKIP, visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { isNumberedKind, NUMBERED_KINDS, type NumberedKind } from "../book/book-index.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { placeAt } from "./position.js";

/** Where a reference sits, for its error message. */
type Place = ReturnType<typeof placeAt>;

/** A reference as written: `[[fig:id]]`, `[[lst:id]]`, `[[tbl:id]]` or `[[ch:slug]]`. */
const REF = /\[\[(fig|lst|tbl|ch):([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g;
/**
 * Anything that starts like a reference, so a malformed one fails instead of rendering as plain text. The match stays
 * on one line and within 200 characters, so a long run of unclosed brackets cannot make it scan the text again and
 * again.
 */
export const REF_LIKE = /\[\[[^\]\n]{0,200}\]\]/g;
/** Text inside these elements is never a reference: code shows syntax, and links cannot nest. */
const NO_REFS = new Set(["code", "pre", "a", "script", "style"]);

const KIND_BY_PREFIX: ReadonlyMap<string, NumberedKind> = new Map(
  Object.entries(NUMBERED_KINDS).map(([kind, { prefix }]) => [prefix, kind as NumberedKind]),
);

/**
 * Numbers the chapter's figures, listings and tables and resolves references to them. A number is the chapter's
 * position in the outline and the block's order in the chapter (Figure 3.2), both taken from the book index, so
 * moving a chapter in the outline renumbers its blocks and every reference to them. A reference to an unknown id
 * fails the build with the file and line. A reference to a chapter that is not written yet shows its number without
 * a link.
 */
export function rehypeNumbering(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const { outline } = checkedChapter(file);
    numberBlocks(tree, file, book, outline.slug);
    resolveRefs(tree, file, book);
  };
}

function numberBlocks(tree: Root, file: VFile, book: Book, slug: string): void {
  const expected = book.index.written.get(slug)?.blocks ?? [];
  let position = 0;
  visit(tree, "element", (node) => {
    const kind = node.properties.dataNumbered;
    if (!isNumberedKind(kind)) return;
    const id = String(node.properties.dataNumberedId);
    const block = expected[position++];
    // The index reads the chapter file before the build renders it; if the two disagree, the numbers would be wrong.
    if (block === undefined || block.kind !== kind || block.id !== id) {
      failAt(file, `the book index and the page disagree about ${kind} "${id}"; rerun the build`, node);
    }
    const number = findNumberSpan(node);
    if (number !== undefined)
      number.children = [{ type: "text", value: `${NUMBERED_KINDS[kind].label} ${block.number}` }];
  });
}

function findNumberSpan(figure: Element): Element | undefined {
  let found: Element | undefined;
  visit(figure, "element", (node) => {
    const classes = node.properties.className;
    if (node.tagName === "span" && Array.isArray(classes) && classes.includes("number")) {
      found = node;
      return false;
    }
    return undefined;
  });
  return found;
}

function resolveRefs(tree: Root, file: VFile, book: Book): void {
  visit(tree, (node, index, parent) => {
    if (node.type === "element" && NO_REFS.has(node.tagName)) return SKIP;
    if (node.type !== "text" || parent === undefined || index === undefined) return undefined;
    const pieces = refPieces(node, file, book);
    if (pieces === undefined) return undefined;
    parent.children.splice(index, 1, ...pieces);
    return [SKIP, index + pieces.length];
  });
}

/** The nodes that replace one text node, or undefined when it holds no reference. */
function refPieces(node: Text, file: VFile, book: Book): ElementContent[] | undefined {
  const value = node.value;
  const valid = new Set([...value.matchAll(REF)].map((m) => m.index));
  for (const m of value.matchAll(REF_LIKE)) {
    if (!valid.has(m.index))
      failAt(file, `${m[0]} is not a reference; write [[fig:id]], [[lst:id]], [[tbl:id]] or [[ch:slug]]`, node);
  }
  if (valid.size === 0) return undefined;
  const out: ElementContent[] = [];
  let last = 0;
  for (const m of value.matchAll(REF)) {
    const [whole, prefix = "", id = ""] = m;
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    const at = placeAt(node.position, value, m.index, m.index + whole.length);
    out.push(prefix === "ch" ? chapterRef(id, file, book, at) : blockRef(prefix, id, file, book, at));
    last = m.index + whole.length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function blockRef(prefix: string, id: string, file: VFile, book: Book, at: Place): ElementContent {
  const block = book.index.blocks.get(`${prefix}:${id}`);
  const kind = KIND_BY_PREFIX.get(prefix);
  if (block === undefined || kind === undefined) {
    return failAt(file, `[[${prefix}:${id}]] names no ${kind ?? "block"} in the book`, at);
  }
  return {
    type: "element",
    tagName: "a",
    properties: { href: `/${block.chapter.slug}/#${prefix}-${id}`, className: ["xref"] },
    children: [{ type: "text", value: `${NUMBERED_KINDS[kind].label} ${block.number}` }],
  };
}

function chapterRef(slug: string, file: VFile, book: Book, at: Place): ElementContent {
  const chapter = book.bySlug.get(slug);
  if (chapter === undefined) return failAt(file, `[[ch:${slug}]] names no chapter in ${book.names.outline}`, at);
  const text: Text = { type: "text", value: `Chapter ${chapter.number}` };
  if (!book.index.written.has(slug)) return text;
  return { type: "element", tagName: "a", properties: { href: `/${slug}/`, className: ["xref"] }, children: [text] };
}
