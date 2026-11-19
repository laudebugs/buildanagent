import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { markdownConfigDefaults, parseFrontmatter } from "@astrojs/markdown-remark";
import type { AstroUserConfig } from "astro";
import { test } from "vitest";

// The test renders through the processor astro.config.mjs gives Astro, so it fails if the config stops using the
// book's pipeline. Loading the config also runs its render-input check, the same step every build runs first.
const fixture = new URL("./fixtures/chapter.md", import.meta.url);

async function renderFixture() {
  const { default: config } = (await import("../astro.config.mjs")) as { default: AstroUserConfig };
  const processor = config.markdown?.processor;
  assert.ok(processor, "astro.config.mjs sets markdown.processor");
  assert.equal(processor.name, "unified");
  // Astro passes these shared options to createRenderer (astro/dist/vite-plugin-markdown/content-entry-type.js);
  // the config sets none of them, so Astro's defaults stand in.
  const { syntaxHighlight, shikiConfig } = markdownConfigDefaults;
  const renderer = await processor.createRenderer({ syntaxHighlight, shikiConfig });
  const { content, frontmatter } = parseFrontmatter(await readFile(fixture, "utf8"));
  return renderer.render(content, { frontmatter });
}

test("the book's Markdown pipeline renders a chapter's paragraphs and headings", async () => {
  const { code, metadata } = await renderFixture();
  assert.match(
    code,
    /<p>An agent calls a model, runs the tools the model asks for and stops when the model answers.<\/p>/,
  );
  assert.deepEqual(
    metadata.headings.map(({ depth, slug, text }) => ({ depth, slug, text })),
    [{ depth: 2, slug: "how-the-loop-stops", text: "How the loop stops" }],
  );
});

test("the book's Markdown pipeline renders GitHub-flavoured tables", async () => {
  const { code } = await renderFixture();
  assert.match(code, /<table>/);
  assert.match(code, /<td>The loop reaches its step limit<\/td>/);
});
