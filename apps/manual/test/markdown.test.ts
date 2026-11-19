import assert from "node:assert/strict";
import type { AstroUserConfig } from "astro";
import { test } from "vitest";
import { markdownOptions } from "../src/markdown/options.js";

// The build must render chapters through the book's own plugins. Loading the config also runs its render-input
// check, the same step every build runs first.
test("astro.config.mjs renders chapters with unified() and the book's Markdown options", async () => {
  const { default: config } = (await import("../astro.config.mjs")) as { default: AstroUserConfig };
  const processor = config.markdown?.processor as
    | { name: string; options: { remarkPlugins: unknown[]; rehypePlugins: unknown[] } }
    | undefined;
  assert.ok(processor, "astro.config.mjs sets markdown.processor");
  assert.equal(processor.name, "unified");
  assert.deepEqual(processor.options.remarkPlugins, markdownOptions.remarkPlugins);
  assert.deepEqual(processor.options.rehypePlugins, markdownOptions.rehypePlugins);
});
