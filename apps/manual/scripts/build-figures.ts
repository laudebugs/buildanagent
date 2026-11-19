// `pnpm --filter @buildanagent/manual figures:build`: runs every figure script under each folder it is given (the
// book's own figures/ when given none) and writes beside it a flat figure's SVG or an isometric figure's HTML fragment.
// The package script also names the fixture books' figure folders, so one command redraws every figure the tests
// check. The staleness test fails when a committed file differs from what its script draws, so rerun this after
// changing a script, figures/lib/svgkit.ts or isokit.ts, the vendored anatomy kit, the figure rules in
// src/styles/components.css, the tokens or the code font.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOOK_FIGURES, drawFigure, figureScripts, fromRepo, orphanFiles } from "../figures/lib/registry.js";

const roots = process.argv.length > 2 ? process.argv.slice(2).map((root) => resolve(root)) : [BOOK_FIGURES];
let written = 0;
for (const root of roots) {
  for (const figure of figureScripts(root)) {
    const { path, text } = await drawFigure(figure);
    writeFileSync(path, text);
    console.log(`wrote ${fromRepo(path)}`);
    written += 1;
  }
  for (const file of await orphanFiles(root)) console.warn(`${fromRepo(file)} is drawn by no script`);
}
console.log(`figures:build: drew ${written} figure(s)`);
