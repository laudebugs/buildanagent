// The staleness check below is adapted from scripts/tests/figure_staleness.py in the owner's garment engineering
// textbook (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIGURES_BUILD, figureFiles } from "../../src/book/figures.js";
import { KEBAB_ID } from "../../src/book/outline-rules.js";
import { IsoFigure } from "./isokit.js";
import { Figure, FigureError } from "./svgkit.js";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const REPO = join(APP, "../..");

/** The book's own figure scripts, `figures/<chapter>/<id>.ts`. Fixture books name their own folders. */
export const BOOK_FIGURES = join(APP, "figures");

/**
 * One figure script and the files it may write beside it: an SVG for a flat figure, an HTML fragment for an isometric
 * one.
 */
export interface FigureScript {
  readonly id: string;
  readonly chapter: string;
  readonly script: string;
  readonly svg: string;
  readonly fragment: string;
  /** The script's path from the repository root, which the SVG's first line names. */
  readonly source: string;
}

/** A path from the repository root with `/` separators on every platform, for messages and the SVG's header. */
export const fromRepo = (file: string): string => relative(REPO, file).split(sep).join("/");

/**
 * Every figure script under `root`: each `.ts` file in a chapter folder, outside `lib/`. A file elsewhere, or a name
 * that is not kebab-case, throws, so no script is silently skipped.
 */
export function figureScripts(root: string): FigureScript[] {
  if (!existsSync(root)) return [];
  const found: FigureScript[] = [];
  for (const path of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
    // readdirSync names nested files with the platform's separator, so split on both before reading the folders.
    const parts = path.split(/[\\/]/);
    if (!path.endsWith(".ts") || parts[0] === "lib") continue;
    const [chapter = "", file = ""] = parts;
    const id = basename(file, ".ts");
    if (parts.length !== 2 || !KEBAB_ID.test(chapter) || !KEBAB_ID.test(id)) {
      throw new FigureError(
        `${fromRepo(join(root, path))}: a figure script lives at figures/<chapter>/<figure-id>.ts, both kebab-case`,
      );
    }
    const { script, svg, fragment } = figureFiles(root, chapter, id);
    found.push({ id, chapter, script, svg, fragment, source: fromRepo(script) });
  }
  return found;
}

/** A flat or an isometric figure, each naming the file its script writes and drawing it. */
export type DrawnFigure = Figure | IsoFigure;

// An isometric figure settles its painter's order once per drawing, which takes seconds; the site fixture re-exports
// the book fixture's figures, so each drawing is kept by the function that made it and drawn only once per process.
const isometric = new WeakMap<object, IsoFigure>();

/**
 * What a figure script returns: a flat figure from svgkit or an isometric one from isokit, whose id must be the
 * script's file name. A flat figure is drawn afresh each time; an isometric one is kept for the process.
 */
export async function loadFigure(figure: FigureScript): Promise<DrawnFigure> {
  const module = (await import(pathToFileURL(figure.script).href)) as { default?: unknown };
  const draw = module.default;
  if (typeof draw !== "function") {
    throw new FigureError(`${figure.source} must export default a function that returns its Figure or IsoFigure`);
  }
  const drawn: unknown = isometric.get(draw) ?? draw();
  if (!(drawn instanceof Figure) && !(drawn instanceof IsoFigure)) {
    throw new FigureError(`${figure.source}'s default export must return a Figure or an IsoFigure`);
  }
  if (drawn.id !== figure.id) {
    throw new FigureError(`${figure.source} draws figure "${drawn.id}", but its file name says "${figure.id}"`);
  }
  if (drawn instanceof IsoFigure) isometric.set(draw, drawn);
  return drawn;
}

/**
 * Runs one figure script in memory and returns the file it draws now, where its kind says: a flat figure's SVG or an
 * isometric figure's HTML fragment.
 */
export async function drawFigure(figure: FigureScript): Promise<{ readonly path: string; readonly text: string }> {
  const drawn = await loadFigure(figure);
  return { path: figure[drawn.file], text: drawn.draw(figure.source) };
}

/**
 * Every committed SVG or fragment under `root` that no script draws: one with no script beside it, and one of the
 * other kind beside a script, such as an SVG left behind when a flat figure became isometric.
 */
export async function orphanFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const drawn = new Set<string>();
  for (const figure of figureScripts(root)) drawn.add(figure[(await loadFigure(figure)).file]);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".svg") || path.endsWith(".html"))
    .map((path) => join(root, path))
    .filter((file) => !drawn.has(file))
    .sort();
}

/**
 * Every way the committed figures under `root` differ from what their scripts draw now: an SVG or fragment that is
 * missing or stale, naming the script to rerun, and an SVG or fragment that no script draws. An empty list means every
 * figure is current.
 */
export async function staleFigures(root: string): Promise<string[]> {
  const problems: string[] = [];
  for (const figure of figureScripts(root)) {
    const { path, text } = await drawFigure(figure);
    const committed = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (committed === undefined) {
      problems.push(`${fromRepo(path)} is missing: run ${FIGURES_BUILD}, which draws it from ${figure.source}`);
    } else if (committed !== text) {
      problems.push(`${fromRepo(path)} is stale: run ${FIGURES_BUILD}, which redraws it from ${figure.source}`);
    }
  }
  const scripts = new Set(figureScripts(root).map((figure) => figure.script));
  for (const file of await orphanFiles(root)) {
    const script = file.replace(/\.(svg|html)$/, ".ts");
    const name = basename(script);
    problems.push(
      scripts.has(script)
        ? `${fromRepo(file)} is left over: ${name} draws the other kind of file; delete it`
        : `${fromRepo(file)} has no script beside it; delete it or add ${name}`,
    );
  }
  return problems;
}
