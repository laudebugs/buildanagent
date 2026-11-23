import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTokens } from "@buildanagent/manual/design/tokens";
import { test } from "vitest";
import {
  BOOK_FONTS_URL,
  bookFontFilesForDocs,
  DOCS_FONTS_URL,
  docsFontFolders,
  fontFiles,
  preloadedFonts,
} from "../src/design/theme.js";

const docsFiles = fontFiles(DOCS_FONTS_URL);

test("the docs serve exactly the book's display, body and code font files and their licences", () => {
  assert.deepEqual(docsFontFolders(), ["instrument-serif", "literata", "manual-code"]);
  assert.ok(docsFiles.some((file) => file.endsWith("/OFL.txt")));
  assert.ok(docsFiles.includes("manual-code/TRADEMARKS.md"));
  assert.deepEqual(
    docsFiles,
    bookFontFilesForDocs(),
    "public/fonts/ differs from the book's: run pnpm --filter @buildanagent/docs tokens",
  );
});

test("every docs font file is byte-identical to the book's", () => {
  for (const file of docsFiles) {
    assert.ok(
      readFileSync(new URL(file, DOCS_FONTS_URL)).equals(readFileSync(new URL(file, BOOK_FONTS_URL))),
      `public/fonts/${file} differs from the book's: run pnpm --filter @buildanagent/docs tokens`,
    );
  }
});

test("every font file the tokens name is served from the docs' public folder", () => {
  const tokens = readTokens();
  for (const font of [tokens.font.display, tokens.font.body, tokens.font.code]) {
    for (const file of font.files) assert.ok(docsFiles.includes(file.src.replace(/^\/fonts\//, "")), file.src);
  }
});

test("the head preloads the body and display romans, and nothing else", () => {
  const head = readFileSync(new URL("../src/components/Head.astro", import.meta.url), "utf8");
  const preloaded = [...head.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin/g)];
  assert.deepEqual(
    preloaded.map((match) => match[1]),
    preloadedFonts(),
  );
  assert.deepEqual(preloadedFonts(), [
    "/fonts/literata/literata-roman.woff2",
    "/fonts/instrument-serif/instrument-serif-regular.woff2",
  ]);
  const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
  assert.match(config, /Head: "\.\/src\/components\/Head\.astro"/);
});
