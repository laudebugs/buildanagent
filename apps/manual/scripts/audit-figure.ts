// One isometric figure, built with --audit: `tsx scripts/audit-figure.ts <figures root> <chapter>/<id> <out dir>`.
// It runs the anatomy skill's geometry audit on the figure's recorded shapes, which prints the skill's report and ends
// with `audit passed` or `audit failed: N problems`, then writes the figure's light and dark check pages into the out
// directory for scripts/lines.mjs. figures:audit (scripts/audit-figures.ts) runs it once per figure, in its own
// process, as the skill runs `node build.mjs --audit`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { IsoFigure, THEMES } from "../figures/lib/isokit.js";
import { figureScripts, loadFigure } from "../figures/lib/registry.js";

const [root = "", name = "", out = ""] = process.argv.slice(2);
const figure = figureScripts(root).find((script) => `${script.chapter}/${script.id}` === name);
if (figure === undefined) throw new Error(`no figure script ${name} under ${root}`);
const drawn = await loadFigure(figure);
if (!(drawn instanceof IsoFigure)) throw new Error(`${figure.source} draws a flat figure, which has no audit`);
const problems = drawn.audit();
for (const theme of THEMES) writeFileSync(join(out, `${figure.id}-${theme}.html`), drawn.page(figure.source, theme));
process.exitCode = problems === 0 ? 0 : 1;
