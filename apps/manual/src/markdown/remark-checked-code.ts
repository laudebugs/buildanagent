import { join, relative } from "node:path";
import type { InlineCode, Parent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { type ChapterNames, hasName, type NameSource } from "../book/code-names.js";
import { CHECKED_VERDICTS } from "../book/fact-check-log.js";
import { classifySpan, markerAt, STRAY_MARKER } from "../book/inline-code.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { placeAt, pointAt } from "./position.js";

/** A list of the places searched, as a failure message names them, or what the chapter lacks. */
function searched(sources: readonly NameSource[], none: string): string {
  return sources.length === 0 ? none : sources.map((source) => source.label).join(", ");
}

/** Why a span's name resolves nowhere, naming the three places searched and the two ways to fix it. */
function unresolvedMessage(span: string, missing: readonly string[], names: ChapterNames, log: string): string {
  const what = missing.length === 1 ? `\`${missing[0]}\`` : missing.map((name) => `\`${name}\``).join(" and ");
  return (
    `inline code \`${span}\` names ${what}, which none of the three places holds: ` +
    `the chapter's listings (${searched(names.listings, "it includes none")}), ` +
    `their transcripts (${searched(names.transcripts, "none recorded")}) ` +
    `and the .d.ts exports of the packages they import (${searched(names.packages, "they import none")}). ` +
    `Show it in a listing, or check it by hand and cite the row as \`${span}\`{checked=row-N}, ` +
    `where row N of ${log} is ✅ or ✏️`
  );
}

/** The chapter's fact-check log: its file, and its path from the repository root as messages name it. */
interface ChapterLog {
  readonly file: string;
  readonly name: string;
}

/**
 * Checks code in a chapter's prose like code in its listings (BK17). Each inline-code span of code, such as
 * `generateText`, `result.steps` or `stopWhen: isStepCount(5)`, must name only what the chapter's file listings show,
 * their examples' transcripts record, or the pinned `.d.ts` files of the packages they import export. Otherwise the
 * span carries a hand-checked marker, `` `name`{checked=row-N} ``, whose row in the chapter's fact-check log is ✅ or
 * ✏️; the marker is removed from the page, and a marker that does not touch its span fails. Shell commands, paths
 * and literal values skip the check (`inline-code.ts`).
 */
export function remarkCheckedCode(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const { outline } = checkedChapter(file);
    const written = book.index.written.get(outline.slug);
    const logFile = join(book.inputs.factChecksDir, `${outline.slug}.md`);
    const log: ChapterLog = { file: logFile, name: relative(book.inputs.repoRoot, logFile) };
    let names: ChapterNames | undefined;
    visit(tree, "inlineCode", (node: InlineCode, index, parent: Parent | undefined) => {
      const next = index === undefined ? undefined : parent?.children[index + 1];
      const marker = next?.type === "text" ? markerAt(next.value) : undefined;
      if (marker !== undefined && "malformed" in marker) {
        failAt(file, `${marker.malformed} after \`${node.value}\` is not a marker; write {checked=row-N}`, node);
      }
      if (marker === undefined && next?.type === "text" && /^\s+\{\s*checked\b/.test(next.value)) {
        failAt(file, strayMessage(next.value.trim().match(STRAY_MARKER)?.[0] ?? "{checked…}"), node);
      }
      if (marker !== undefined) {
        checkRow(book, file, node, marker.row, log);
        strip(next as Text, marker.length);
        return;
      }
      const span = classifySpan(node.value);
      if (span.kind !== "checked" || written === undefined) return;
      if (names === undefined) {
        const found = book.code.chapter(written);
        if (typeof found === "string") failAt(file, found, node);
        names = found;
      }
      const known = names;
      const missing = span.names.filter((name) => !hasName(known, name));
      if (missing.length > 0) failAt(file, unresolvedMessage(node.value, missing, known, log.name), node);
    });
    // Every marker that touched its span is gone by now, so any left in the text stands apart from its code.
    visit(tree, "text", (node: Text) => {
      const stray = STRAY_MARKER.exec(node.value);
      if (stray === null) return;
      failAt(
        file,
        strayMessage(stray[0]),
        placeAt(node.position, node.value, stray.index, stray.index + stray[0].length),
      );
    });
  };
}

/** Why a marker that stands apart from its code span fails. */
const strayMessage = (marker: string): string =>
  `${marker} stands apart from its code span; a marker must touch the span it marks, with no space, as in ` +
  "`name`{checked=row-N}";

/** A marker's row must exist in the chapter's fact-check log, once, with a ✅ or ✏️ verdict. */
function checkRow(book: Book, file: VFile, node: InlineCode, row: number, log: ChapterLog): void {
  const cited = `\`${node.value}\`{checked=row-${row}}`;
  const rows = book.logs.rows(log.file);
  if (rows === undefined) {
    failAt(file, `${cited} cites a row, but the chapter has no fact-check log, ${log.name}`, node);
  }
  if (rows.repeated.has(row)) {
    failAt(file, `${cited} cites row ${row}, which ${log.name} numbers more than once`, node);
  }
  const verdict = rows.verdicts.get(row);
  if (verdict === undefined) failAt(file, `${cited} cites row ${row}, which ${log.name} does not have`, node);
  if (!CHECKED_VERDICTS.includes(verdict)) {
    const given = typeof verdict === "string" ? verdict : `"${verdict.other}"`;
    failAt(file, `${cited} cites row ${row} of ${log.name}, whose verdict is ${given}; a marker needs ✅ or ✏️`, node);
  }
}

/** Takes the marker off the start of the text after the span, so the page shows only the code. */
function strip(text: Text, length: number): void {
  const value = text.value;
  text.value = value.slice(length);
  if (text.position !== undefined) {
    text.position = { start: pointAt(text.position.start, value, length), end: text.position.end };
  }
}
