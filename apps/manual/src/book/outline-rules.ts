import type { Outline, OutlineChapter } from "./outline-types.js";
import type { ProblemList } from "./problems.js";

/** A kebab-case id: lowercase letters and digits in words joined by single hyphens. */
export const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A chapter with its number, which is its position in the whole book, counted from 1 across the parts. */
export interface NumberedChapter extends OutlineChapter {
  readonly number: number;
  readonly part: number;
}

/** Every chapter in reading order, numbered from 1 across the parts. */
export function numberChapters(outline: Outline): readonly NumberedChapter[] {
  let number = 0;
  return outline.flatMap((part, partIndex) =>
    part.chapters.map((chapter) => ({ ...chapter, number: ++number, part: partIndex + 1 })),
  );
}

/**
 * Checks the outline's own rules: kebab-case slugs that appear once, and the opening rotation of BK22. Two chapters
 * next to each other in reading order may not share an opening type, even across a part boundary, and no type may
 * open more than a quarter of the chapters, rounded up.
 */
export function checkOutline(outline: Outline, file: string, problems: ProblemList): void {
  const chapters = numberChapters(outline);
  const seen = new Set<string>();
  for (const chapter of chapters) {
    if (!KEBAB_ID.test(chapter.slug)) problems.add(file, `chapter slug "${chapter.slug}" is not kebab-case`);
    if (seen.has(chapter.slug)) problems.add(file, `chapter slug "${chapter.slug}" appears twice`);
    seen.add(chapter.slug);
  }
  checkOpenings(chapters, file, problems);
}

function checkOpenings(chapters: readonly NumberedChapter[], file: string, problems: ProblemList): void {
  for (const [index, chapter] of chapters.entries()) {
    const previous = chapters[index - 1];
    if (previous?.opening === chapter.opening) {
      problems.add(
        file,
        `chapters ${previous.number} (${previous.slug}) and ${chapter.number} (${chapter.slug}) both open with ` +
          `"${chapter.opening}"; consecutive chapters need different opening types`,
      );
    }
  }
  const limit = Math.ceil(chapters.length / 4);
  const counts = new Map<string, number>();
  for (const { opening } of chapters) counts.set(opening, (counts.get(opening) ?? 0) + 1);
  for (const [opening, count] of counts) {
    if (count > limit) {
      problems.add(
        file,
        `"${opening}" opens ${count} of ${chapters.length} chapters; no type may open more than ${limit} ` +
          "(a quarter, rounded up)",
      );
    }
  }
}
