import type { Book } from "../book/load.js";
import type { ChapterLink, ContentsPart } from "./types.js";

/**
 * The contents as the outline's parts and numbered chapters. A planned chapter whose file does not exist yet has no
 * `href`, so the contents shows it as plain text in its place (BK5).
 */
export function contentsParts(book: Book): ContentsPart[] {
  return book.inputs.outline.map((part, index) => ({
    title: part.title,
    chapters: book.chapters
      .filter((chapter) => chapter.part === index + 1)
      .map(({ slug, number, title }) =>
        book.index.written.has(slug) ? { number, title, href: `/${slug}/` } : { number, title },
      ),
  }));
}

/** The written chapters before and after `slug` in reading order, for the previous and next links. */
export function neighbours(book: Book, slug: string): { previous?: ChapterLink; next?: ChapterLink } {
  const written = book.chapters.filter((chapter) => book.index.written.has(chapter.slug));
  const index = written.findIndex((chapter) => chapter.slug === slug);
  const link = (offset: number): ChapterLink | undefined => {
    const chapter = index === -1 ? undefined : written[index + offset];
    return chapter && { href: `/${chapter.slug}/`, title: chapter.title };
  };
  const previous = link(-1);
  const next = link(1);
  return { ...(previous ? { previous } : {}), ...(next ? { next } : {}) };
}
