// `pnpm --filter @buildanagent/manual figures:build`: runs every figure script and writes its SVG beside it. The
// staleness test fails when a committed SVG differs from what its script draws, so rerun this after changing a
// script, figures/lib/svgkit.ts, the figure rules in src/styles/components.css, the tokens or the code font.
import { writeFileSync } from "node:fs";
import { drawFigure, FIGURE_ROOTS, figureScripts, fromRepo, orphanSvgs } from "../figures/lib/registry.js";

let written = 0;
for (const root of FIGURE_ROOTS) {
  for (const figure of figureScripts(root)) {
    writeFileSync(figure.svg, await drawFigure(figure));
    console.log(`wrote ${fromRepo(figure.svg)}`);
    written += 1;
  }
  for (const svg of orphanSvgs(root)) console.warn(`${fromRepo(svg)} has no script beside it`);
}
console.log(`figures:build: drew ${written} figure(s)`);
