import type { UnifiedProcessorOptions } from "@astrojs/markdown-remark";

/**
 * The remark and rehype plugins every chapter goes through. Astro 7's default processor, Sätteri, runs no remark or
 * rehype plugins, so `astro.config.mjs` hands these options to `unified()` instead (BK3). A plugin added here reaches
 * every chapter, and the tests render a fixture chapter through the same processor.
 */
export const markdownOptions: UnifiedProcessorOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
};
