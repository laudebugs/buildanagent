import type { ContentsPart } from "./types.js";

/** The fields of a chapter entry the contents needs. */
export interface ChapterEntry {
  readonly id: string;
  readonly data: { readonly title: string };
}

/**
 * The contents as parts of numbered chapters. The outline arrives with the content model; until then the contents is
 * one part, numbered in collection order.
 */
export function contentsParts(chapters: readonly ChapterEntry[]): ContentsPart[] {
  return [
    {
      title: "Chapters",
      chapters: chapters.map((chapter, index) => ({
        number: index + 1,
        title: chapter.data.title,
        href: `/${chapter.id}/`,
      })),
    },
  ];
}
