import type { UnifiedProcessorOptions } from "@astrojs/markdown-remark";

// Astro 7 renders Markdown with Sätteri by default, which runs no remark or rehype plugins, so astro.config.mjs passes
// these options to the `unified()` processor instead (BK3).

/**
 * The remark and rehype plugins every chapter goes through. `astro.config.mjs` hands them to `unified()`, so a
 * plugin added here reaches every chapter, and the tests render a fixture chapter through the same processor.
 */
export const markdownOptions: UnifiedProcessorOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
};
