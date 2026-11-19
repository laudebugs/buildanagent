// Writes src/styles/tokens.css from docs/design/book-tokens.json. A token change starts in the JSON file; the app's
// tests fail when the committed CSS differs from what this script writes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readTokens, TOKENS_CSS_URL, tokensCss } from "../src/design/tokens.js";

writeFileSync(TOKENS_CSS_URL, tokensCss(readTokens()));
console.log(`wrote ${fileURLToPath(TOKENS_CSS_URL)}`);
