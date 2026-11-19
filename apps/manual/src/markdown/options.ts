import type { UnifiedProcessorOptions } from "@astrojs/markdown-remark";
import remarkDirective from "remark-directive";
import { type Book, loadBook } from "../book/load.js";
import { rehypeNumbering } from "./rehype-numbering.js";
import { remarkBookDirectives } from "./remark-book-directives.js";
import { remarkChapterContract } from "./remark-chapter-contract.js";
import { remarkCitations } from "./remark-citations.js";
import { remarkTerms } from "./remark-terms.js";

/**
 * The remark and rehype plugins for one book. The chapter contract runs first, so no other plugin sees front matter
 * that broke the schema. `check:book` renders every chapter through these same options, so a rule it applies is a
 * rule the build applies, and the tests render fixture chapters through them too.
 */
export function markdownOptionsFor(book: Book): UnifiedProcessorOptions {
  return {
    remarkPlugins: [
      remarkDirective,
      [remarkChapterContract, { book }],
      [remarkBookDirectives, { book }],
      [remarkCitations, { book }],
      [remarkTerms, { book }],
    ],
    rehypePlugins: [[rehypeNumbering, { book }]],
  };
}

/**
 * The book every chapter renders against. Loading it checks the outline, the three registers and every chapter's
 * numbered blocks, so a broken rule there stops the build before any page renders.
 */
export const book: Book = loadBook();

/**
 * The remark and rehype plugins every chapter goes through. Astro 7's default processor, Sätteri, runs no remark or
 * rehype plugins, so `astro.config.mjs` hands these options to `unified()` instead (BK3).
 */
export const markdownOptions: UnifiedProcessorOptions = markdownOptionsFor(book);
