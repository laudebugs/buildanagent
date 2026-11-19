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

/** The accessible name of the numbered list of notes under a listing. */
export const NOTES_LABEL = "Notes on this listing";

/** A numbered marker linking to its note: the one markup for markers on listing lines and in prose. */
export function annotationMarkerHtml(href: string, number: number): string {
  return `<a class="annotation-marker" href="${escapeHtml(href)}" aria-label="Note ${number}">${number}</a>`;
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
          : annotationMarkerHtml(`#${listingId}-note-${line.note}`, number);
      return `<span class="${classes}" data-line="${line.number}"><span class="line__number" aria-hidden="true">${line.number}</span>${tokens}${marker}</span>`;
    })
    .join("");
}

/** A listing's line range as its caption shows it: "line 5" for one line, "lines 3–7" for several. */
export function lineRange(lines: readonly { readonly number: number }[]): string {
  const first = lines[0]?.number ?? 0;
  const last = lines.at(-1)?.number ?? first;
  return first === last ? `line ${first}` : `lines ${first}–${last}`;
}

/**
 * The caption's parts after the number and the title, in order: the path, the line range and the pin, each with its
 * class. `ListingBlock` and the `::listing` directive both render these, so a listing's caption reads the same in
 * the gallery and in a chapter.
 */
export function captionParts(
  path: string,
  lines: readonly { readonly number: number }[],
  pin: string,
): readonly { readonly className: string; readonly text: string }[] {
  return [
    { className: "listing__path", text: path },
    { className: "listing__lines", text: lineRange(lines) },
    { className: "listing__pin", text: pin },
  ];
}

/** The listing's code panel: a keyboard-scrollable `<pre>` labelled with the listing's number, holding its lines. */
export function listingCodeHtml(
  listingId: string,
  number: string,
  lines: readonly ListingLine[],
  noteNumbers: ReadonlyMap<string, number>,
): string {
  const label = escapeHtml(`Code of listing ${number}`);
  const code = listingHtml(listingId, lines, noteNumbers);
  return `<pre class="listing__code" tabindex="0" aria-label="${label}"><code>${code}</code></pre>`;
}
