// The docs' figures: one script per figure in this folder, each writing `<id>.svg` beside itself. The list is explicit,
// like the sidebar, so a figure appears only when someone registers it, and a test fails on a script or an SVG in this
// folder that the list does not name. This module reads no figure kit, so the Markdown plugin can import it cheaply.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Every figure the docs draw, by id. A page places one with `::figure[caption]{id="<id>" alt="…"}`. */
export const FIGURE_IDS = [
  "approval-pause",
  "gateway-adapters",
  "package-map",
  "run-loop",
  "stop-reasons",
  "stream-and-transcript",
] as const;

export type FigureId = (typeof FIGURE_IDS)[number];

/** This folder: the scripts and their SVGs. */
export const FIGURES_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The command that redraws every figure, as every message that asks for a redraw names it. */
export const FIGURES_BUILD = "pnpm --filter @buildanagent/docs figures:build";

/** The files in this folder that are the pipeline itself, not figures. */
export const PIPELINE_FILES = ["build.ts", "draw.ts", "registry.ts"] as const;

const REPO = join(FIGURES_DIR, "../../..");

/** A path from the repository root with `/` separators on every platform, for messages and the SVG's header. */
export const fromRepo = (file: string): string => relative(REPO, file).split(sep).join("/");

export const scriptOf = (id: string): string => join(FIGURES_DIR, `${id}.ts`);
export const svgOf = (id: string): string => join(FIGURES_DIR, `${id}.svg`);

export const isFigureId = (id: string): id is FigureId => (FIGURE_IDS as readonly string[]).includes(id);

/**
 * The files in this folder that no registered figure accounts for: a script or an SVG of an unregistered id, or any
 * other file. An empty list means the folder holds exactly the pipeline and the registered figures.
 */
export function strayFiles(): string[] {
  const expected = new Set<string>([...PIPELINE_FILES, ...FIGURE_IDS.flatMap((id) => [`${id}.ts`, `${id}.svg`])]);
  return readdirSync(FIGURES_DIR)
    .filter((name) => !expected.has(name))
    .sort();
}
