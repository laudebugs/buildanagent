import type { UnifiedProcessorOptions } from "@astrojs/markdown-remark";
import remarkDirective from "remark-directive";
import type { Book } from "../book/load.js";
import { rehypeAnalogyFigures } from "./rehype-analogy-figures.js";
import { rehypeNumbering } from "./rehype-numbering.js";
import { remarkBookDirectives } from "./remark-book-directives.js";
import { remarkChapterContract } from "./remark-chapter-contract.js";
import { remarkCitations } from "./remark-citations.js";
import { remarkFigures } from "./remark-figures.js";
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
      // Before the directives plugin, which would reject the ::svg inside a figure as an unknown directive.
      [remarkFigures, { book }],
      [remarkBookDirectives, { book }],
      [remarkCitations, { book }],
      [remarkTerms, { book }],
    ],
    rehypePlugins: [
      [rehypeNumbering, { book }],
      [rehypeAnalogyFigures, { book }],
    ],
  };
}
