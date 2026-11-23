// Writes src/styles/tokens.css and src/styles/reading.css from docs/design/book-tokens.json. A token change starts in
// the JSON file; the app's tests fail when either committed CSS file differs from what this script writes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { READING_CSS_URL, readingCss, readTokens, TOKENS_CSS_URL, tokensCss } from "../src/design/tokens.js";

const tokens = readTokens();
writeFileSync(TOKENS_CSS_URL, tokensCss(tokens));
console.log(`wrote ${fileURLToPath(TOKENS_CSS_URL)}`);
writeFileSync(READING_CSS_URL, readingCss(tokens));
console.log(`wrote ${fileURLToPath(READING_CSS_URL)}`);
