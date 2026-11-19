// Writes src/styles/anatomy.css: the vendored anatomy skill's figure rules with its palette mapped to the book's panel
// tokens (src/design/anatomy-css.ts). The app's tests fail when the committed CSS differs from what this writes, so
// rerun it after updating the vendored skill or changing the palette.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANATOMY_CSS_URL, anatomyCss } from "../src/design/anatomy-css.js";

writeFileSync(ANATOMY_CSS_URL, anatomyCss());
console.log(`wrote ${fileURLToPath(ANATOMY_CSS_URL)}`);
