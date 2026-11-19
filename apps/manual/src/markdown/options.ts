import type { UnifiedProcessorOptions } from "@astrojs/markdown-remark";

// The book's remark and rehype plugins. Astro 7 renders Markdown with Sätteri by default, which runs no remark or
// rehype plugins, so astro.config.mjs passes these options to the `unified()` processor instead (BK3). The tests
// render a fixture chapter with the same options, so the build and the tests share one pipeline.
export const markdownOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
} as const satisfies UnifiedProcessorOptions;
