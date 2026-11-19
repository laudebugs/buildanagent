/**
 * The six ways a chapter may open (BK22): a scenario, an incident, a question, a surprising fact, a piece of code or
 * transcript, or an analogy.
 */
export const OPENING_TYPES = ["scenario", "incident", "question", "fact", "code", "analogy"] as const;

/** One of the six opening types. */
export type OpeningType = (typeof OPENING_TYPES)[number];

/** A chapter's place in the outline: its slug (the file name and URL), its planned title and its opening type. */
export interface OutlineChapter {
  readonly slug: string;
  readonly title: string;
  readonly opening: OpeningType;
}

/** A part of the book and its chapters in reading order. */
export interface OutlinePart {
  readonly title: string;
  readonly chapters: readonly OutlineChapter[];
}

/** The whole outline: the parts in reading order. */
export type Outline = readonly OutlinePart[];
