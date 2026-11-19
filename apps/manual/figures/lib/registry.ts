// The staleness check below is adapted from scripts/tests/figure_staleness.py in the owner's garment engineering
// textbook (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KEBAB_ID } from "../../src/book/outline-rules.js";
import { Figure, FigureError } from "./svgkit.js";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const REPO = join(APP, "../..");

/**
 * The folders that hold figure scripts: the book's own, `figures/<chapter>/<id>.ts`, and the fixture book's, whose
 * analogy illustration the content-model tests render. `figures:build` and the staleness test cover both.
 */
export const FIGURE_ROOTS: readonly string[] = [join(APP, "figures"), join(APP, "test/fixtures/book/figures")];

/** The command that redraws every figure, as messages name it. */
export const FIGURES_BUILD = "pnpm --filter @buildanagent/manual figures:build";

/** One figure script and the SVG it writes beside it. */
export interface FigureScript {
  readonly id: string;
  readonly chapter: string;
  readonly script: string;
  readonly svg: string;
  /** The script's path from the repository root, which the SVG's first line names. */
  readonly source: string;
}

/** A path from the repository root, for messages and the SVG's header. */
export const fromRepo = (file: string): string => relative(REPO, file);

/**
 * Every figure script under `root`: each `.ts` file in a chapter folder, outside `lib/`. A file elsewhere, or a name
 * that is not kebab-case, throws, so no script is silently skipped.
 */
export function figureScripts(root: string): FigureScript[] {
  if (!existsSync(root)) return [];
  const found: FigureScript[] = [];
  for (const path of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
    if (!path.endsWith(".ts") || path.startsWith(`lib/`) || path === "lib") continue;
    const parts = path.split(/[\\/]/);
    const [chapter = "", file = ""] = parts;
    const id = basename(file, ".ts");
    if (parts.length !== 2 || !KEBAB_ID.test(chapter) || !KEBAB_ID.test(id)) {
      throw new FigureError(
        `${fromRepo(join(root, path))}: a figure script lives at figures/<chapter>/<figure-id>.ts, both kebab-case`,
      );
    }
    const script = join(root, path);
    found.push({ id, chapter, script, svg: join(dirname(script), `${id}.svg`), source: fromRepo(script) });
  }
  return found;
}

/** Every committed SVG under `root` that no script draws. */
export function orphanSvgs(root: string): string[] {
  if (!existsSync(root)) return [];
  const drawn = new Set(figureScripts(root).map((figure) => figure.svg));
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".svg"))
    .map((path) => join(root, path))
    .filter((svg) => !drawn.has(svg))
    .sort();
}

/**
 * Runs one figure script in memory and returns the SVG it draws now. The script's default export is a function that
 * returns a `Figure` whose id is the script's file name.
 */
export async function drawFigure(figure: FigureScript): Promise<string> {
  const module = (await import(pathToFileURL(figure.script).href)) as { default?: unknown };
  if (typeof module.default !== "function") {
    throw new FigureError(`${figure.source} must export default a function that returns its Figure`);
  }
  const drawn: unknown = module.default();
  if (!(drawn instanceof Figure)) throw new FigureError(`${figure.source}'s default export must return a Figure`);
  if (drawn.id !== figure.id) {
    throw new FigureError(`${figure.source} draws figure "${drawn.id}", but its file name says "${figure.id}"`);
  }
  return drawn.toSvg(figure.source);
}

/**
 * Every way the committed figures under `root` differ from what their scripts draw now: an SVG that is missing or
 * stale, naming the script to rerun, and an SVG that no script draws. An empty list means every figure is current.
 */
export async function staleFigures(root: string): Promise<string[]> {
  const problems: string[] = [];
  for (const figure of figureScripts(root)) {
    const drawn = await drawFigure(figure);
    const committed = existsSync(figure.svg) ? readFileSync(figure.svg, "utf8") : undefined;
    if (committed === undefined) {
      problems.push(`${fromRepo(figure.svg)} is missing: run ${FIGURES_BUILD}, which draws it from ${figure.source}`);
    } else if (committed !== drawn) {
      problems.push(`${fromRepo(figure.svg)} is stale: run ${FIGURES_BUILD}, which redraws it from ${figure.source}`);
    }
  }
  for (const svg of orphanSvgs(root)) {
    problems.push(`${fromRepo(svg)} has no script beside it; delete it or add ${basename(svg, ".svg")}.ts`);
  }
  return problems;
}
