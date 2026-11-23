// Writes src/styles/tokens.css and src/landing/theme-colors.json from docs/design/book-tokens.json. The site's tests
// fail when either committed file differs from what this script writes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tokenFiles } from "./token-files.js";

for (const file of tokenFiles()) {
  const url = new URL(`../${file.path}`, import.meta.url);
  writeFileSync(url, file.content);
  console.log(`wrote ${fileURLToPath(url)}`);
}
