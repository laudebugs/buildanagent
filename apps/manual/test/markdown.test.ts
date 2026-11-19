import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { markdownConfigDefaults, parseFrontmatter } from "@astrojs/markdown-remark";
import type { AstroUserConfig } from "astro";
import { afterAll, beforeAll, test } from "vitest";

// Renders a chapter through the processor astro.config.mjs gives Astro, so the test fails if the config stops using
// the book's pipeline. The book has no chapter yet, so the config loads the site fixture through BOOK_FIXTURE_DIR, as
// the build test does. Loading the config also runs its render-input check, the step every build runs first.
const site = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const chapter = new URL("./fixtures/site/chapters/call-workflow-loop.md", import.meta.url);
let rendered: { code: string; metadata: { headings: { depth: number; slug: string; text: string }[] } };

beforeAll(async () => {
  process.env.BOOK_FIXTURE_DIR = site;
  const { default: config } = (await import("../astro.config.mjs")) as { default: AstroUserConfig };
  const processor = config.markdown?.processor;
  assert.ok(processor, "astro.config.mjs sets markdown.processor");
  assert.equal(processor.name, "unified");
  // Astro passes its shared Markdown options, these two among them, to createRenderer
  // (astro/dist/vite-plugin-markdown/content-entry-type.js). The config sets none, so Astro's defaults stand in.
  const { syntaxHighlight, shikiConfig } = markdownConfigDefaults;
  const renderer = await processor.createRenderer({ syntaxHighlight, shikiConfig });
  const { content, frontmatter } = parseFrontmatter(await readFile(chapter, "utf8"));
  rendered = await renderer.render(content.trim(), { frontmatter, fileURL: pathToFileURL(fileURLToPath(chapter)) });
});

afterAll(() => {
  delete process.env.BOOK_FIXTURE_DIR;
});

test("the config's pipeline renders a chapter's paragraphs and collects its headings", () => {
  assert.match(rendered.code, /<p>An <a href="\/glossary\/#agent-loop"[^>]*>agent loop<\/a> calls a model/);
  assert.deepEqual(
    rendered.metadata.headings.map(({ depth, slug, text }) => ({ depth, slug, text })),
    [
      { depth: 2, slug: "how-the-loop-stops", text: "How the loop stops" },
      { depth: 2, slug: "exercises", text: "Exercises" },
    ],
  );
});

test("the config's pipeline renders GitHub-flavoured tables", () => {
  assert.match(rendered.code, /<table>/);
  assert.match(rendered.code, /<td>The loop reaches its step limit<\/td>/);
});

test("the config's pipeline runs the book's plugins: numbering and citations", () => {
  assert.match(
    rendered.code,
    /<span class="number figure__number label">Figure 1\.1<\/span> A call, a workflow and a loop/,
  );
  assert.match(rendered.code, /class="cite">1<\/a>\]/);
});
