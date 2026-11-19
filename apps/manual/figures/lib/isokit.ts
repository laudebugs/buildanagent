// The kit every isometric figure script draws with: a thin layer over the anatomy skill vendored in
// .agents/skills/anatomy/ (THIRD-PARTY-NOTICES.md). A script draws its parts with the skill's own kit, puts each one
// into the skill's audit recorder with its true shape, and returns an IsoFigure. The IsoFigure settles the painter's
// order with the skill's depth solver and writes three things from the same drawing: the HTML fragment a chapter
// inlines, one standalone check page per theme for the skill's line check, and the skill's geometry audit.
import { readFileSync } from "node:fs";
import * as auditModule from "../../../../.agents/skills/anatomy/kit/audit.mjs";
import * as kitModule from "../../../../.agents/skills/anatomy/kit/iso-kit.mjs";
import { KEBAB_ID } from "../../src/book/outline-rules.js";
import { readTokens } from "../../src/design/tokens.js";
import { FigureError, MAX_FIGURE_WIDTH, missingGlyphs } from "./svgkit.js";

const APP = new URL("../../", import.meta.url);

type Point2 = [number, number];
type Point3 = [number, number, number];

/** A camera from the kit's `fitProjection`: where the origin lands, the scale and the view angles. */
export interface Projection {
  readonly origin: Point2;
  readonly scale: number;
  readonly azimuth: number;
  readonly elevation: number;
}

/** A solid's paths as the kit's `slabOf`, `cylinder` and `extrude` return them, for `solidSvg`. */
export type SolidPaths = Readonly<Record<string, unknown>>;

/** A recorded shape from the audit's shape constructors. */
export type Shape = Readonly<Record<string, unknown>>;

/** One drawn item in the recorder: its markup and the painter's key the depth solver settles. */
export interface RecordedItem {
  readonly name: string;
  readonly svg?: string;
  key: number;
}

/** The audit recorder from the kit's `recorder`, which every drawn part goes into with its true shape. */
export interface Recorder {
  readonly items: RecordedItem[];
  put(item: { at?: Point3; name?: string; svg?: string; shapes?: Shape[]; bias?: number }): RecordedItem;
  solid(shape: Shape): Shape;
}

type Tone = "hi" | "mid" | "lo" | "faint" | "lit";

/**
 * The part of the anatomy kit (`kit/iso-kit.mjs`) the book's figures use, typed here because the kit is plain
 * JavaScript; `references/kit.md` in the vendored skill documents every function.
 */
export interface AnatomyKit {
  fitProjection(
    points: Point3[],
    width: number,
    height: number,
    options?: { pad?: number; azimuth?: number },
  ): Projection;
  iso(point: Point3, projection: Projection): Point2;
  boxCorners(plan: Plan, z0: number, z1: number): Point3[];
  corners(plan: Plan, inset?: number): Point2[];
  insetPlan(plan: Plan, by: number): Plan;
  slabOf(plan: Plan, z: number, height: number, projection: Projection, steps?: number, bevel?: number): SolidPaths;
  cylinder(
    cx: number,
    cy: number,
    r: number,
    z: number,
    height: number,
    projection: Projection,
    steps?: number,
    bevel?: number,
  ): SolidPaths;
  planOutline(plan: Plan, z: number, projection: Projection, steps?: number): string;
  ring(cx: number, cy: number, radius: number, z: number, projection: Projection, steps?: number): string;
  topTicks(
    from: number,
    to: number,
    step: number,
    every: number,
    edge: number,
    z: number,
    lengths: [number, number],
    projection: Projection,
    axis?: "x" | "y",
  ): { minor: string; major: string };
  topMatrix(at: Point2, z: number, projection: Projection, along?: "x" | "y"): string;
  solidSvg(
    paths: SolidPaths,
    options?: { tone?: Tone; crease?: Tone | "none"; lit?: boolean; flat?: boolean; halo?: boolean },
  ): string;
  lineSvg(d: string, options?: { tone?: Tone; free?: boolean | "start" | "end" }): string;
  dotsSvg(points: Point2[], options?: { size?: number; tone?: Tone }): string;
  faceTextSvg(
    transform: string,
    text: string,
    options?: { size?: number; tone?: Tone; anchor?: "start" | "middle" | "end" },
  ): string;
  groupSvg(children: string | string[], extra?: Record<string, string>): string;
  figureSvg(options: { width: number; height: number; label: string; body: string }): string;
  plateHtml(options: { fig: string; title: string; hint: string; readout: string; body: string }): string;
}

/** The part of the anatomy audit (`kit/audit.mjs`) the book's figures use; `references/kit.md`, section 12. */
export interface AnatomyAudit {
  recorder(projection: Projection): Recorder;
  slab(plan: Plan, z: number, height: number, meta?: { name?: string }): Shape;
  cylinder(cx: number, cy: number, r: number, z: number, height: number, meta?: { name?: string }): Shape;
  settle(recorder: Recorder, projection: Projection): unknown;
  auditOrExit(recorder: Recorder, projection: Projection, options: { argv: string[] }): unknown;
  failures(result: unknown): number;
}

export const kit = kitModule as unknown as AnatomyKit;
export const audit = auditModule as unknown as AnatomyAudit;

/** The two themes a figure is checked in, each with its own panel tokens (anatomy.css maps the kit's palette). */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export interface IsoFigureOptions {
  /** The figure's id, which is also its script's file name. */
  readonly id: string;
  /** The drawing's natural size in CSS pixels; the page never scales it, and on a phone its stage scrolls. */
  readonly width: number;
  readonly height: number;
  /** The card's corners: a short title at top right, the hint at bottom left and the readout at bottom right. */
  readonly title: string;
  readonly hint: string;
  readonly readout: string;
  readonly projection: Projection;
  readonly recorder: Recorder;
}

/** The text a figure shows a reader: its corners, the labels drawn in it and the readouts its parts carry. */
function shownText(options: IsoFigureOptions, body: string): string[] {
  const drawn = [...body.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((match) => match[1] ?? "");
  const readouts = [...body.matchAll(/ data-iso-readout="([^"]*)"/g)].map((match) => match[1] ?? "");
  return [options.title, options.hint, options.readout, ...drawn, ...readouts];
}

/**
 * An isometric figure, drawn and recorded. `fragment()` writes what a chapter inlines, `page()` a standalone page in
 * one theme for `scripts/lines.mjs`, and `audit()` runs the skill's geometry audit, printing `audit passed` or the
 * problems it found.
 */
export class IsoFigure {
  readonly id: string;
  readonly #options: IsoFigureOptions;
  #body: string | undefined;

  constructor(options: IsoFigureOptions) {
    const { id, width } = options;
    if (!KEBAB_ID.test(id)) throw new FigureError(`figure id "${id}" is not kebab-case`);
    if (width > MAX_FIGURE_WIDTH) {
      throw new FigureError(`figure "${id}" is ${width} wide; no figure may be wider than ${MAX_FIGURE_WIDTH}`);
    }
    this.id = id;
    this.#options = options;
  }

  /** The drawing: every recorded item in the painter's order the skill's depth solver settles. */
  #drawing(): string {
    if (this.#body !== undefined) return this.#body;
    const { recorder, projection } = this.#options;
    audit.settle(recorder, projection);
    const items = [...recorder.items].sort((a, b) => a.key - b.key);
    const body = items.map((item) => item.svg ?? "").join("");
    for (const text of shownText(this.#options, body)) {
      const missing = missingGlyphs(text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
      if (missing.length > 0) {
        throw new FigureError(`figure "${this.id}": "${text}" uses ${missing.join(", ")}, which the code font lacks`);
      }
    }
    this.#body = body;
    return body;
  }

  /**
   * The HTML fragment a chapter inlines: the kit's card around the kit's drawing, at the drawing's natural size. Its
   * header names the script, which the inliner checks, and the figure corner holds "Fig" until the inliner writes the
   * figure's number there.
   */
  fragment(source: string): string {
    const { width, height, title, hint, readout } = this.#options;
    const svg = kit
      .figureSvg({ width, height, label: title, body: this.#drawing() })
      .replace(/^<svg /, `<svg width="${width}" height="${height}" `);
    const card = kit.plateHtml({ fig: "Fig", title, hint, readout, body: svg });
    return `<!-- Generated by apps/manual/figures/lib/isokit.ts from ${source} for figure "${this.id}". Redraw it with figures:build. -->\n${card}\n`;
  }

  /**
   * A standalone page that shows the fragment in one theme with the book's panel colours, for the skill's line check.
   * It inlines its styles, which the book's pages never do, because it is a check page that no reader loads.
   */
  page(source: string, theme: Theme): string {
    const tokens = readFileSync(new URL("src/styles/tokens.css", APP), "utf8").replace(/@font-face\s*\{[^}]*\}/g, "");
    const styles = ["base.css", "components.css", "anatomy.css"].map((file) =>
      readFileSync(new URL(`src/styles/${file}`, APP), "utf8"),
    );
    const figure = this.fragment(source).replace(/^<!--[^\n]*-->\n/, "");
    return [
      "<!doctype html>",
      `<html lang="en" data-theme="${theme}">`,
      `<head><meta charset="utf-8"><title>${this.id} (${theme})</title><style>${tokens}\n${styles.join("\n")}\nbody{margin:0;padding:24px;background:var(--panel-background)}</style></head>`,
      `<body>${figure}</body>`,
      "</html>",
      "",
    ].join("\n");
  }

  /** Runs the skill's audit on the recorded shapes and prints its report; returns how many problems it found. */
  audit(): number {
    this.#drawing();
    const { recorder, projection } = this.#options;
    // auditOrExit marks a failure in process.exitCode, as the skill's own `node build.mjs --audit` exits; the caller
    // decides how to exit, so the code is put back.
    const exitCode = process.exitCode;
    const result = audit.auditOrExit(recorder, projection, { argv: ["--audit"] });
    process.exitCode = exitCode;
    return result === null ? 0 : audit.failures(result);
  }
}

/** A plan on the floor: a rounded rectangle in world units, as the kit's `slabOf` takes it. */
export interface Plan {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly r: number;
}

export interface PartOptions {
  /** The outline's tone; the kit's hierarchy is base `lo`, structure `mid` and subject `hi`. */
  readonly tone?: "hi" | "mid" | "lo" | "faint";
  /** The one part the reader should watch, drawn in the accent. */
  readonly lit?: boolean;
  readonly bevel?: number;
  /** Lines and marks drawn on the part, after its faces, such as ticks, rings or an engraved label. */
  readonly marks?: string;
  /** Attributes on the group that holds the part, such as the `data-iso-step` a figure's motion reads. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Draws and records parts in one call, so every part's recorded shape is the shape drawn: a slab or a cylinder stood
 * on the floor, drawn with the kit and recorded for the audit under `name`. A name that starts with `stand.` is
 * ground, as the audit's default ground rule reads it; every other part must rest on one that leads to the ground.
 */
export class IsoParts {
  readonly projection: Projection;
  readonly recorder: Recorder;

  constructor(projection: Projection, recorder: Recorder) {
    this.projection = projection;
    this.recorder = recorder;
  }

  #put(name: string, at: [number, number, number], solid: string, shape: Shape, options: PartOptions): void {
    const marks = options.marks ?? "";
    const attributes = options.attributes ?? {};
    const svg =
      Object.keys(attributes).length === 0 && marks === ""
        ? solid
        : kit.groupSvg([solid, marks], { "data-part": name, ...attributes });
    this.recorder.put({ at, name, svg, shapes: [this.recorder.solid(shape)] });
  }

  slab(name: string, plan: Plan, z: number, height: number, options: PartOptions = {}): void {
    const { tone = "mid", lit = false, bevel = 0 } = options;
    const solid = kit.solidSvg(kit.slabOf(plan, z, height, this.projection, 8, bevel), { tone, lit });
    const at: [number, number, number] = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height];
    this.#put(name, at, solid, audit.slab(plan, z, height, { name }), options);
  }

  cylinder(
    name: string,
    centre: [number, number],
    radius: number,
    z: number,
    height: number,
    options: PartOptions = {},
  ): void {
    const { tone = "mid", lit = false, bevel = 0 } = options;
    const [cx, cy] = centre;
    const solid = kit.solidSvg(kit.cylinder(cx, cy, radius, z, height, this.projection, 32, bevel), { tone, lit });
    this.#put(name, [cx, cy, z + height], solid, audit.cylinder(cx, cy, radius, z, height, { name }), options);
  }

  /**
   * A label engraved on a part's top face at `z`, sized so it renders at `px` CSS pixels. The figure keeps its natural
   * size on every screen, so a label smaller than the phone label size in book-tokens.json throws.
   */
  label(text: string, at: [number, number], z: number, px = 12): string {
    const phone = readTokens().size.code.label.phone;
    if (px < phone) throw new FigureError(`label "${text}" is ${px}px; a figure label is at least ${phone}px`);
    // The label lies on the top face, so one unit of its font size spans the shorter of the screen lengths one world
    // unit along x and along y projects to; dividing by that span keeps every glyph at least `px` tall on screen.
    const [ox, oy] = kit.iso([0, 0, z], this.projection);
    const span = Math.min(
      ...[kit.iso([1, 0, z], this.projection), kit.iso([0, 1, z], this.projection)].map(([x, y]) =>
        Math.hypot(x - ox, y - oy),
      ),
    );
    const size = Number((px / span).toFixed(3));
    return kit.faceTextSvg(kit.topMatrix(at, z, this.projection, "x"), text, { size, tone: "hi" });
  }
}
