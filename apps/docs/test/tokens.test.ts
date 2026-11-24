import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTokens, tokensCss } from "@buildanagent/manual/design/tokens";
import { test } from "vitest";
import { DOCS_TOKENS_CSS_URL, docsTokens, docsTokensCss } from "../src/design/theme.js";

test("the committed tokens.css is what the generator writes from book-tokens.json", () => {
  assert.equal(
    readFileSync(DOCS_TOKENS_CSS_URL, "utf8"),
    docsTokensCss(),
    "src/styles/tokens.css is stale: change docs/design/book-tokens.json, then run pnpm --filter @buildanagent/docs tokens",
  );
});

// The font-face rules and the body font's variable are the one place the docs differ from the book.
function withoutBodyFont(css: string): string {
  return css.replace(/@font-face \{[^}]*\}\n\n/g, "").replace(/ {2}--font-body: [^\n]*\n/, "");
}

test("the docs tokens are the book's but for the body font, under the docs site's own header, then the print block", () => {
  const docs = docsTokensCss();
  const book = tokensCss(readTokens());
  assert.match(
    docs,
    /^\/\* Generated from docs\/design\/book-tokens\.json by apps\/docs\/scripts\/generate-tokens\.ts\./,
  );
  assert.match(docs, /pnpm --filter @buildanagent\/docs tokens/);
  const afterComment = (css: string): string => css.slice(css.indexOf("*/"));
  const own = afterComment(tokensCss(docsTokens(), { header: ["x"] }));
  assert.ok(
    afterComment(docs).startsWith(own),
    "the docs file starts with the book's tokens, with the docs' body face",
  );
  assert.equal(withoutBodyFont(own), withoutBodyFont(afterComment(book)), "the docs differ from the book in one font");
  assert.match(afterComment(docs).slice(own.length), /^\n@media print \{\n/);
});

test("Starlight loads the tokens before the stylesheet that maps them", () => {
  const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
  // Later entries, such as the figure stylesheets, may follow the two.
  assert.match(config, /customCss: \[\s*"\.\/src\/styles\/tokens\.css",\s*"\.\/src\/styles\/starlight\.css"[,\]]/);
});
