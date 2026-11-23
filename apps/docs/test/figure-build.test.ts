import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, inject, test } from "vitest";
import { readPages } from "../src/plugins/pages.js";

// A built page that places a figure carries it inline, with its alt text and caption, and no page shows a directive
// as text. It reads the docs that test/built-site.ts builds once for every file that reads built pages.
const out = inject("builtSite");

/** Every `::figure` a page places, with its caption and attributes as the page writes them. */
const placed = readPages().flatMap((page) =>
  [...page.body.matchAll(/^::figure\[([^\]]*)\]\{id="([a-z0-9-]+)" alt="([^"]*)"\}$/gm)].map((match) => ({
    page: page.path,
    caption: match[1] ?? "",
    id: match[2] ?? "",
    alt: match[3] ?? "",
  })),
);

const htmlOf = (page: string): string =>
  readFileSync(join(out, page.replace(/(?:index)?\.mdx?$/, ""), "index.html"), "utf8");

test("the pages place the two figures", () => {
  assert.deepEqual(placed.map(({ id }) => id).sort(), ["package-map", "run-loop"]);
});

describe.each(placed.map((figure) => [`${figure.page}: ${figure.id}`, figure] as const))("%s", (_name, figure) => {
  test("is inlined with its alt text and caption on the built page", () => {
    const html = htmlOf(figure.page);
    const start = html.indexOf(`<figure class="docs-figure not-content" id="figure-${figure.id}"`);
    assert.ok(start !== -1, "the page has no figure element for it");
    const element = html.slice(start, html.indexOf("</figure>", start) + "</figure>".length);
    assert.match(
      element,
      new RegExp(`<svg viewBox="[^"]+" width="\\d+" height="\\d+" class="fig" data-figure="${figure.id}"`),
    );
    assert.ok(element.includes(`role="img" aria-label="${figure.alt}"`), "the drawing is named by the alt text");
    assert.ok(element.includes(`>${figure.caption}</figcaption>`), "the caption follows the drawing");
    assert.match(element, /class="figure__stage figure__stage--scroll panel--grid"/, "the stage scrolls when narrow");
    assert.match(element, /class="figure__scroll-hint"/);
    assert.match(element, /<text [^>]*class="fig-text[^"]*">/, "the labels are inline text, not an image");
    assert.doesNotMatch(element, /<style|<script|<image|<use|href=|on[a-z]+=|@font-face/);
  });
});

test("no built page shows a figure directive as text", () => {
  for (const { page } of placed) assert.doesNotMatch(htmlOf(page), /::figure|:figure\[/);
});
