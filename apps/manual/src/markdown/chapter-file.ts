import { basename } from "node:path";
import type { VFile } from "vfile";
import type { ChapterFrontmatter } from "../book/chapter-schema.js";
import type { NumberedChapter } from "../book/outline-rules.js";

interface AstroData {
  astro?: { frontmatter?: Record<string, unknown> };
  /** The lines of the chapter file above the rendered body; the chapter-contract plugin sets it from the book index. */
  lineOffset?: number;
  /** Set by the chapter-contract plugin once the front matter has passed the schema. */
  chapter?: { readonly outline: NumberedChapter; readonly frontmatter: ChapterFrontmatter };
}

/** The file's data as Astro and the book's plugins share it. */
export const fileData = (file: VFile): AstroData => file.data as AstroData;

/** The slug a chapter file renders as: its file name without `.md`. */
export const slugOf = (file: VFile): string | undefined => (file.path ? basename(file.path, ".md") : undefined);

/**
 * The chapter being rendered, once the contract plugin has checked it. Every later plugin reads it from here, so none
 * of them runs on front matter that broke the schema.
 */
export function checkedChapter(file: VFile): NonNullable<AstroData["chapter"]> {
  const chapter = fileData(file).chapter;
  if (chapter === undefined) return file.fail("the chapter-contract plugin must run before the book's other plugins");
  return chapter;
}
