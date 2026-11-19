// The data the book's components render. Later todos fill these from the outline, the listing regions and the
// recorded transcripts; the gallery fills them by hand.

/** A chapter in the contents: planned chapters without a page yet have no `href`. */
export interface ContentsChapter {
  readonly number: number;
  readonly title: string;
  readonly href?: string;
}

export interface ContentsPart {
  readonly title: string;
  readonly chapters: readonly ContentsChapter[];
}

/** A heading on the current page, for the sidebar's "On this page" list. */
export interface PageHeading {
  readonly slug: string;
  readonly text: string;
}

/** A run of code with one syntax kind; `plain` text takes the panel's text colour. */
export interface CodeToken {
  readonly text: string;
  readonly kind?: "keyword" | "string" | "comment" | "highlight";
}

/** One line of a listing, with its number in the source file and an optional annotation marker. */
export interface ListingLine {
  readonly number: number;
  readonly tokens: readonly CodeToken[];
  readonly highlight?: boolean;
  /** The id of the note this line's marker points to. */
  readonly note?: string;
}

/** A note on a listing line; the markers number the notes in the order given. */
export interface ListingNote {
  readonly id: string;
  readonly text: string;
}

/** One step of a figure's stepper; `id` matches the `data-step-part` of the figure parts it lights up. */
export interface FigureStep {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** One event of a recorded run. */
export interface ReplayEvent {
  readonly kind: "user" | "model" | "tool" | "result" | "check";
  readonly role: string;
  readonly body: string;
  /** The line of the example file that led to the event, which the replay highlights in its listing. */
  readonly line?: number;
}

/** A link to a neighbouring chapter. */
export interface ChapterLink {
  readonly href: string;
  readonly title: string;
}
