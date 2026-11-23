// `pnpm --filter @buildanagent/docs figures:build`: runs every registered figure script and writes its SVG beside it.
// The figures test fails when a committed SVG differs from what its script draws, so rerun this after changing a
// script, the book's svgkit, its figures.css, the tokens or the code font.
import { writeFileSync } from "node:fs";
import { drawFigure } from "./draw.js";
import { FIGURE_IDS, fromRepo, strayFiles, svgOf } from "./registry.js";

for (const id of FIGURE_IDS) {
  writeFileSync(svgOf(id), await drawFigure(id));
  console.log(`wrote ${fromRepo(svgOf(id))}`);
}
for (const name of strayFiles()) console.warn(`figures/${name} belongs to no registered figure`);
console.log(`figures:build: drew ${FIGURE_IDS.length} figure(s)`);
