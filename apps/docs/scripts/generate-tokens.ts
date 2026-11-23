// Writes src/styles/tokens.css from docs/design/book-tokens.json, with the book's generator, and replaces
// public/fonts/ with a copy of the book's font files. The app's tests fail when either differs from what this writes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copyFonts, DOCS_FONTS_URL, DOCS_TOKENS_CSS_URL, docsTokensCss } from "../src/design/theme.js";

writeFileSync(DOCS_TOKENS_CSS_URL, docsTokensCss());
console.log(`wrote ${fileURLToPath(DOCS_TOKENS_CSS_URL)}`);
copyFonts();
console.log(`copied the book's fonts to ${fileURLToPath(DOCS_FONTS_URL)}`);
