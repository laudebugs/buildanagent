import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTokens, tokensCss } from "@buildanagent/manual/design/tokens";
import { test } from "vitest";
import { DOCS_TOKENS_CSS_URL, docsTokensCss } from "../src/design/theme.js";

test("the committed tokens.css is what the generator writes from book-tokens.json", () => {
  assert.equal(
    readFileSync(DOCS_TOKENS_CSS_URL, "utf8"),
    docsTokensCss(),
    "src/styles/tokens.css is stale: change docs/design/book-tokens.json, then run pnpm --filter @buildanagent/docs tokens",
  );
});

test("the docs tokens are the book's, under the docs site's own header, then the print block", () => {
  const docs = docsTokensCss();
  const book = tokensCss(readTokens());
  assert.match(
    docs,
    /^\/\* Generated from docs\/design\/book-tokens\.json by apps\/docs\/scripts\/generate-tokens\.ts\./,
  );
  assert.match(docs, /pnpm --filter @buildanagent\/docs tokens/);
  const body = book.slice(book.indexOf("*/"));
  assert.ok(docs.slice(docs.indexOf("*/")).startsWith(body), "the docs file starts with the book's tokens");
  assert.match(docs.slice(docs.indexOf("*/") + body.length), /^\n@media print \{\n/);
});

test("Starlight loads the tokens before the stylesheet that maps them", () => {
  const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
  // Later entries, such as the figure stylesheets, may follow the two.
  assert.match(config, /customCss: \[\s*"\.\/src\/styles\/tokens\.css",\s*"\.\/src\/styles\/starlight\.css"[,\]]/);
});
