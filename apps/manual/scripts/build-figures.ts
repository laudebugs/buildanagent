// `pnpm --filter @buildanagent/manual figures:build`: runs every figure script under each folder it is given (the
// book's own figures/ when given none) and writes its SVG beside it. The package script also names the fixture books'
// figure folders, so one command redraws every figure the tests check. The staleness test fails when a committed SVG
// differs from what its script draws, so rerun this after changing a script, figures/lib/svgkit.ts, the figure rules
// in src/styles/components.css, the tokens or the code font.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOOK_FIGURES, drawFigure, figureScripts, fromRepo, orphanSvgs } from "../figures/lib/registry.js";

const roots = process.argv.length > 2 ? process.argv.slice(2).map((root) => resolve(root)) : [BOOK_FIGURES];
let written = 0;
for (const root of roots) {
  for (const figure of figureScripts(root)) {
    writeFileSync(figure.svg, await drawFigure(figure));
    console.log(`wrote ${fromRepo(figure.svg)}`);
    written += 1;
  }
  for (const svg of orphanSvgs(root)) console.warn(`${fromRepo(svg)} has no script beside it`);
}
console.log(`figures:build: drew ${written} figure(s)`);
