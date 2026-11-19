import type { ListingSource } from "./listings.js";
import { KEBAB_ID } from "./outline-rules.js";

/** A `::note` as the index found it, with its line in the chapter's body. */
interface FoundNote {
  readonly id: string | undefined;
  readonly hasText: boolean;
  readonly line: number;
}

/**
 * Checks the notes a file listing gives against the `// book:note` markers on the lines it shows. Each note needs a
 * kebab-case id, text and a marker with its id in those lines, and no id may appear twice. Once a listing gives a
 * note, every marker in its lines needs one; a listing that gives none shows its lines without markers, so a region
 * can be listed with its notes in one chapter and without them in another. Returns the first problem, with its line
 * in the chapter file, or undefined.
 */
export function checkNotes(
  listingId: string,
  source: ListingSource,
  notes: readonly FoundNote[],
  strays: readonly number[],
  line: number,
  lineOffset: number,
): { readonly message: string; readonly line: number } | undefined {
  const stray = strays[0];
  if (stray !== undefined) {
    return {
      message: `listing "${listingId}" may hold only notes, written ::note[The note's text]{#marker-id}`,
      line: stray + lineOffset,
    };
  }
  const markers = new Map(source.lines.flatMap((shown) => (shown.note ? [[shown.note, shown.number] as const] : [])));
  const given = new Set<string>();
  for (const note of notes) {
    const at = note.line + lineOffset;
    if (note.id === undefined || !KEBAB_ID.test(note.id)) {
      return { message: "a note needs the kebab-case id of its marker, written ::note[Text]{#marker-id}", line: at };
    }
    if (given.has(note.id)) return { message: `listing "${listingId}" gives note "${note.id}" twice`, line: at };
    if (!note.hasText)
      return { message: `note "${note.id}" needs its text, written ::note[Text]{#${note.id}}`, line: at };
    if (!markers.has(note.id)) {
      const known = markers.size === 0 ? "they hold no marker" : `their markers are ${[...markers.keys()].join(", ")}`;
      return {
        message: `note "${note.id}" has no // book:note ${note.id} marker in the lines listing "${listingId}" shows; ${known}`,
        line: at,
      };
    }
    given.add(note.id);
  }
  if (given.size === 0) return undefined;
  for (const [id, number] of markers) {
    if (!given.has(id)) {
      return {
        message: `listing "${listingId}" gives no note for the marker // book:note ${id} at ${source.path}:${number}`,
        line,
      };
    }
  }
  return undefined;
}

/** The number of each note, in the order its marker appears in the listing's lines; empty when it gives no notes. */
export function noteNumbers(source: ListingSource, given: ReadonlySet<string>): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  for (const shown of source.lines) {
    if (shown.note !== undefined && given.has(shown.note)) numbers.set(shown.note, numbers.size + 1);
  }
  return numbers;
}
