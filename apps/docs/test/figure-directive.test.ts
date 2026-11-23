import assert from "node:assert/strict";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import remarkDirective from "remark-directive";
import { beforeAll, describe, test } from "vitest";
import { FigureDirectiveError, figureDirective, SCROLL_HINT } from "../src/plugins/figure.js";

// The `::figure` directive through Astro's own Markdown processor, with remark-directive first as Starlight adds it.
// A page with a broken figure must fail to render, so a build with one fails too.
let render: (markdown: string) => Promise<string>;

beforeAll(async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, figureDirective],
    syntaxHighlight: false,
  });
  const fileURL = new URL("file:///docs/src/content/docs/guide.md");
  render = async (markdown) => (await processor.render(markdown, { fileURL })).code;
});

const ALT = 'alt="The loop calls tools until the model answers."';

const rejects = async (markdown: string, message: RegExp) => {
  await assert.rejects(render(markdown), (error: unknown) => {
    assert.ok(error instanceof FigureDirectiveError, `expected a FigureDirectiveError, got ${String(error)}`);
    // Astro prefixes the message with "Failed to parse Markdown file"; the plugin's own message starts a line.
    assert.match(error.message, /(?:^|\n)\/docs\/src\/content\/docs\/guide\.md:\d+: /, "it names the page and line");
    assert.match(error.message, message);
    return true;
  });
};

test("inlines the figure with its caption, alt text, scrolling stage and hint", async () => {
  const html = await render(`Before.\n\n::figure[One run of the \`run()\` loop]{id="run-loop" ${ALT}}\n\nAfter.`);
  assert.match(html, /<p>Before\.<\/p>\s*<figure class="docs-figure not-content" id="figure-run-loop"/);
  assert.match(html, /aria-labelledby="figure-run-loop--caption"/);
  assert.match(
    html,
    /<div class="figure__stage figure__stage--scroll panel--grid" tabindex="0" role="group" aria-labelledby="figure-run-loop--caption"><svg /,
  );
  assert.match(html, /role="img" aria-label="The loop calls tools until the model answers\."/);
  assert.match(html, new RegExp(`<p class="figure__scroll-hint" aria-hidden="true">${SCROLL_HINT}</p>`));
  assert.match(
    html,
    /<figcaption class="figure__caption" id="figure-run-loop--caption">One run of the <code>run\(\)<\/code> loop<\/figcaption><\/figure>/,
  );
  assert.doesNotMatch(
    html,
    /::figure|<style|<p><\/p>/,
    "the directive leaves no source text, style or empty paragraph",
  );
});

describe("fails the page", () => {
  test("without alt text", () => rejects('::figure[Caption]{id="run-loop"}', /needs alt text/));
  test("with blank alt text", () => rejects('::figure[Caption]{id="run-loop" alt="  "}', /needs alt text/));
  test("without a caption", () => rejects(`::figure{id="run-loop" ${ALT}}`, /needs a caption/));
  test("with a blank caption", () => rejects(`::figure[ ]{id="run-loop" ${ALT}}`, /needs a caption/));
  test("without an id", () => rejects(`::figure[Caption]{${ALT}}`, /no registered figure has the id ""/));
  test("with an id the registry lacks", () =>
    rejects(`::figure[Caption]{id="../../secrets" ${ALT}}`, /no registered figure has the id "\.\.\/\.\.\/secrets"/));
  test("with another attribute", () =>
    rejects(`::figure[Caption]{id="run-loop" ${ALT} src="https://example.com/x.svg"}`, /only id and alt, not src/));
  test("with a class shorthand", () =>
    rejects(`::figure[Caption]{.wide id="run-loop" ${ALT}}`, /only id and alt, not class/));
  test("with a link in its caption", () =>
    rejects(`::figure[See [this](https://example.com)]{id="run-loop" ${ALT}}`, /only text and inline code, not link/));
  test("with HTML in its caption", () =>
    rejects(`::figure[<img src=x onerror=alert(1)>]{id="run-loop" ${ALT}}`, /only text and inline code, not html/));
  test("written as a container", () =>
    rejects(`:::figure[Caption]{id="run-loop" ${ALT}}\n:::`, /leaf directive on a line of its own/));
  test("written inline", () => rejects(`Text :figure[Caption]{id="run-loop" ${ALT}} here.`, /leaf directive/));
  test("showing one figure twice", () =>
    rejects(`::figure[A]{id="run-loop" ${ALT}}\n\n::figure[B]{id="run-loop" ${ALT}}`, /shown twice/));
});
