import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { test } from "vitest";
import { markdownOptions } from "../src/markdown/options.js";

const fixture = new URL("./fixtures/chapter.md", import.meta.url);

async function renderFixture() {
  const processor = await createMarkdownProcessor({ ...markdownOptions });
  const source = await readFile(fixture, "utf8");
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "");
  return processor.render(body);
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
