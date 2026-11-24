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

// What the docs change in the book's output: the body font's @font-face rules and its --font-body line. The strip
// takes only the rules for the families in `families`, so a change to any other face's rules still shows.
function withoutFaces(css: string, families: readonly string[]): string {
  let stripped = css.replace(/ {2}--font-body: [^\n]*\n/, "");
  for (const family of families) {
    stripped = stripped.replace(new RegExp(`@font-face \\{\\n {2}font-family: "${family}";[^}]*\\}\\n\\n`, "g"), "");
  }
  return stripped;
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
  const printAt = docs.indexOf("\n@media print {");
  assert.ok(printAt > 0, "the docs file ends with the print block");
  const docsOwn = afterComment(docs.slice(0, printAt));
  assert.equal(
    withoutFaces(docsOwn, ["IBM Plex Sans", "IBM Plex Sans Fallback"]),
    withoutFaces(afterComment(book), ["Literata"]),
    "the docs tokens differ from the book's in the body font's rules and --font-body only",
  );
  assert.match(
    docsOwn,
    /@font-face \{\n {2}font-family: "IBM Plex Sans";[^}]*\/fonts\/ibm-plex-sans\/IBMPlexSans-Regular-Latin1\.woff2/,
  );
  assert.match(docsOwn, /--font-body: "IBM Plex Sans", "IBM Plex Sans Fallback", /);
});

test("Starlight loads the tokens before the stylesheet that maps them", () => {
  const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
  // Later entries, such as the figure stylesheets, may follow the two.
  assert.match(config, /customCss: \[\s*"\.\/src\/styles\/tokens\.css",\s*"\.\/src\/styles\/starlight\.css"[,\]]/);
});
