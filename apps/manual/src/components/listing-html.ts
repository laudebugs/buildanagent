import type { ListingLine } from "./types.js";

// A listing's lines as one HTML string. Inside <pre>, any whitespace between the line elements would show as blank
// space, and Astro's template keeps the indentation of a mapped expression, so the lines are joined here instead.

const KIND_CLASS = {
  keyword: "tok-keyword",
  string: "tok-string",
  comment: "tok-comment",
  highlight: "tok-highlight",
} as const;

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The listing's lines, each a block with its number, its tokens and, for an annotated line, a marker link. */
export function listingHtml(
  listingId: string,
  lines: readonly ListingLine[],
  noteNumbers: ReadonlyMap<string, number>,
) {
  return lines
    .map((line) => {
      const classes = line.highlight ? "line line--highlight" : "line";
      const tokens = line.tokens
        .map((token) =>
          token.kind
            ? `<span class="${KIND_CLASS[token.kind]}">${escapeHtml(token.text)}</span>`
            : escapeHtml(token.text),
        )
        .join("");
      const number = line.note === undefined ? undefined : noteNumbers.get(line.note);
      const marker =
        line.note === undefined || number === undefined
          ? ""
          : `<a class="annotation-marker" href="#${escapeHtml(`${listingId}-note-${line.note}`)}" aria-label="Note ${number}">${number}</a>`;
      return `<span class="${classes}"><span class="line__number" aria-hidden="true">${line.number}</span>${tokens}${marker}</span>`;
    })
    .join("");
}
