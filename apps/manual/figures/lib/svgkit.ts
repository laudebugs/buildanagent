// Adapted from scripts/figures/svgkit.py in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// The kit every flat figure script draws with. It takes the garment kit's ideas: an embedded font subset, a text()
// that refuses a glyph outside it, escaped labels, and arrows whose shaft starts on one box's edge and whose head lands
// on the next. It adds checks the garment kit left to a browser audit: every mark stays inside the canvas, labels
// fit their boxes and never overlap, and every id starts with the figure's id. Colours come from the `fig-*` classes
// in src/styles/components.css, which use T2's panel tokens, so an inlined figure follows the page's theme.
import { readFileSync } from "node:fs";
import { escapeXml } from "../../src/book/figures.js";
import { KEBAB_ID } from "../../src/book/outline-rules.js";
import { type COLOR_SETS, colorProperty, readTokens } from "../../src/design/tokens.js";
import { woff2Advances } from "../../src/design/woff2.js";

const APP = new URL("../../", import.meta.url);
const COMPONENTS_CSS = new URL("src/styles/components.css", APP);

/** A drawing broke one of the kit's rules; the message names the figure and what to change. */
export class FigureError extends Error {
  override readonly name = "FigureError";
}

/** A point in the figure's own units, which are CSS pixels at the figure's natural size. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle: its top-left corner and its size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The colour of a line, a box's outline or a label: panel text, the muted comment colour, or terracotta. */
export type Tone = "text" | "muted" | "accent";

/** The fill of a dot: one of the panel's mark colours. Text never sits on a fill, whose contrast nobody measured. */
export type Fill = "text" | "amber" | "olive" | "terracotta";

/** A label's size and weight, each a `fig-text` class in components.css. */
export type TextStyle = "label" | "heading";

/**
 * A number in the SVG: rounded to two decimals, with trailing zeros dropped and no negative zero, so the same
 * drawing always writes the same bytes.
 */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new FigureError(`a coordinate is ${value}, not a finite number`);
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

interface CodeFont {
  readonly file: Uint8Array;
  readonly family: string;
  readonly weight: string;
  readonly advances: ReadonlyMap<number, number>;
}

let codeFont: CodeFont | undefined;

/**
 * The upright code font the page serves, read from the committed subset in public/fonts/ that T2's tokens name
 * (fonts/sources.json records where it came from). Figures embed this exact file, and the page draws their labels with
 * it, so a glyph the subset lacks is a glyph no reader sees.
 */
export function figureFont(): CodeFont {
  if (codeFont !== undefined) return codeFont;
  const code = readTokens().font.code;
  const upright = code.files.find((file) => file.style === "normal");
  if (upright === undefined) throw new FigureError("book-tokens.json names no upright code font");
  const file = new Uint8Array(readFileSync(new URL(`public${upright.src}`, APP)));
  codeFont = { file, family: code.cssFamily, weight: upright.weight, advances: woff2Advances(file) };
  return codeFont;
}

/** The characters of `text` that the embedded font cannot draw, each once, in order. */
export function missingGlyphs(text: string): string[] {
  const { advances } = figureFont();
  return [...new Set([...text].filter((char) => !advances.has(char.codePointAt(0) ?? 0)))];
}

const describe = (char: string): string =>
  `"${char}" (U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")})`;

/** The `.fig-*` rules of components.css, comments removed and whitespace collapsed, for a standalone figure. */
export function figureRules(): string {
  const css = readFileSync(COMPONENTS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/(\.fig-[\w-]+(?:\s*,\s*\.fig-[\w-]+)*)\s*\{([^}]*)\}/g)];
  return rules
    .map(([, selector = "", body = ""]) => {
      const declarations = body
        .split(";")
        .map((line) => line.trim().replace(/\s*:\s*/, ":"))
        .filter(Boolean);
      return `${selector.replace(/\s+/g, "")}{${declarations.join(";")}}`;
    })
    .join("\n");
}

/** The font size, in px, that components.css gives one `fig-text` class. */
function cssFontSize(rules: string, selector: string): number | undefined {
  const rule = rules.split("\n").find((line) => line.startsWith(`${selector}{`));
  const size = rule?.match(/font-size:(\d+(?:\.\d+)?)px/)?.[1];
  return size === undefined ? undefined : Number(size);
}

const STYLE_CLASSES: Readonly<Record<TextStyle, string>> = { label: "fig-text", heading: "fig-text fig-text--heading" };
const TONE_TEXT: Readonly<Record<Tone, string>> = { text: "", muted: " fig-text--muted", accent: " fig-text--accent" };
const TONE_LINE: Readonly<Record<Tone, string>> = { text: "", muted: " fig-line--muted", accent: " fig-line--accent" };
const TONE_PAPER: Readonly<Record<Tone, string>> = {
  text: "",
  muted: " fig-paper--muted",
  accent: " fig-paper--accent",
};
const TONE_HEAD: Readonly<Record<Tone, string>> = {
  text: "fig-head",
  muted: "fig-head--muted",
  accent: "fig-head--accent",
};
const FILL_CLASS: Readonly<Record<Fill, string>> = {
  text: "fig-head",
  amber: "fig-amber",
  olive: "fig-olive",
  terracotta: "fig-terracotta",
};

/** How far an arrowhead reaches back from its tip, and the half-angle of its point. */
const HEAD = 8;
const HEAD_ANGLE = 0.4;
/** The space a label keeps from its box's sides, and the line height of a label with several lines. */
const BOX_PADDING = 8;
const LINE_HEIGHT = 1.35;

export interface FigureOptions {
  /** The figure's id: the `{#id}` the chapter gives it, and the file name of its script. */
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/**
 * One flat figure. Each method draws one mark and checks it, throwing a `FigureError` that names the figure when a
 * mark would leave the canvas, a label would not fit, a label would overlap another label or be crossed by a line, or
 * a label holds a glyph the embedded font lacks. `toSvg()` writes the file.
 */
export class Figure {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly #parts: string[] = [];
  readonly #ids = new Set<string>();
  readonly #labels: { readonly text: string; readonly rect: Rect }[] = [];
  /** Every line, curve and arrow shaft drawn so far, as the straight segments a label must stay clear of. */
  readonly #strokes: { readonly what: string; readonly from: Point; readonly to: Point }[] = [];
  readonly #rules = figureRules();
  readonly #sizes: Readonly<Record<TextStyle, number>>;

  constructor({ id, width, height }: FigureOptions) {
    if (!KEBAB_ID.test(id)) throw new FigureError(`figure id "${id}" is not kebab-case`);
    if (!(width > 0 && height > 0)) throw new FigureError(`figure "${id}" needs a positive width and height`);
    this.id = id;
    this.width = width;
    this.height = height;
    const label = cssFontSize(this.#rules, ".fig-text");
    const heading = cssFontSize(this.#rules, ".fig-text--heading") ?? label;
    if (label === undefined || heading === undefined) {
      throw new FigureError("components.css gives .fig-text no font-size in px, so labels cannot be measured");
    }
    this.#sizes = { label, heading };
  }

  /** Records a stroke's segments, failing when one crosses a label already drawn. */
  #stroke(what: string, points: readonly Point[]): void {
    for (let i = 1; i < points.length; i += 1) {
      const [from, to] = [points[i - 1] as Point, points[i] as Point];
      const label = this.#labels.find(({ rect }) => crosses(from, to, rect));
      if (label !== undefined) this.#fail(`${what} crosses label "${label.text}"`);
      this.#strokes.push({ what, from, to });
    }
  }

  #fail(message: string): never {
    throw new FigureError(`figure "${this.id}": ${message}`);
  }

  #inside(point: Point, what: string): void {
    num(point.x);
    num(point.y);
    if (point.x < 0 || point.y < 0 || point.x > this.width || point.y > this.height) {
      this.#fail(`${what} at (${num(point.x)}, ${num(point.y)}) lies outside the ${this.width}×${this.height} canvas`);
    }
  }

  /** An id for a part of this figure: `<figure id>--<name>`. Kebab-case ids never hold "--", so no two figures clash. */
  idFor(name: string): string {
    if (!KEBAB_ID.test(name)) this.#fail(`id name "${name}" is not kebab-case`);
    const id = `${this.id}--${name}`;
    if (this.#ids.has(id)) this.#fail(`the id "${id}" is used twice`);
    this.#ids.add(id);
    return id;
  }

  /** The width a label takes in the embedded font at a style's size. */
  measure(text: string, style: TextStyle = "label"): number {
    const { advances } = figureFont();
    const ems = [...text].reduce((sum, char) => sum + (advances.get(char.codePointAt(0) ?? 0) ?? 0), 0);
    return ems * this.#sizes[style];
  }

  /**
   * One line of text with its baseline at `at`. Throws on a glyph the embedded font lacks, naming it, and on a label
   * that leaves the canvas or overlaps an earlier one. Returns the box the label covers.
   */
  text(
    at: Point,
    text: string,
    options: { readonly anchor?: "start" | "middle" | "end"; readonly style?: TextStyle; readonly tone?: Tone } = {},
  ): Rect {
    const { anchor = "middle", style = "label", tone = "text" } = options;
    if (text.trim() === "") this.#fail("a label is empty");
    const missing = missingGlyphs(text);
    if (missing.length > 0) {
      this.#fail(`label "${text}" uses ${missing.map(describe).join(", ")}, which the embedded font lacks`);
    }
    const size = this.#sizes[style];
    const width = this.measure(text, style);
    const left = anchor === "start" ? at.x : anchor === "middle" ? at.x - width / 2 : at.x - width;
    // A label covers its ascenders above the baseline and its descenders below it.
    const rect = { x: left, y: at.y - size * 0.8, width, height: size * 1.05 };
    this.#inside({ x: rect.x, y: rect.y }, `label "${text}"`);
    this.#inside({ x: rect.x + rect.width, y: rect.y + rect.height }, `label "${text}"`);
    const clash = this.#labels.find((label) => overlaps(label.rect, rect));
    if (clash !== undefined) this.#fail(`label "${text}" overlaps label "${clash.text}"`);
    const crossing = this.#strokes.find((stroke) => crosses(stroke.from, stroke.to, rect));
    if (crossing !== undefined) this.#fail(`${crossing.what} crosses label "${text}"`);
    this.#labels.push({ text, rect });
    const anchorAttr = anchor === "start" ? "" : ` text-anchor="${anchor}"`;
    this.#parts.push(
      `<text x="${num(at.x)}" y="${num(at.y)}"${anchorAttr} class="${STYLE_CLASSES[style]}${TONE_TEXT[tone]}">${escapeXml(text)}</text>`,
    );
    return rect;
  }

  /**
   * A paper-coloured box with an outline in `tone`, and an optional label of one or more lines centred in it. Throws
   * when the box leaves the canvas or a label line is wider or taller than the box leaves room for.
   */
  box(
    rect: Rect,
    options: {
      readonly tone?: Tone;
      readonly dashed?: boolean;
      readonly label?: string | readonly string[];
      readonly style?: TextStyle;
      readonly labelTone?: Tone;
    } = {},
  ): Rect {
    const { tone = "text", dashed = false, style = "label", labelTone = "text" } = options;
    this.#inside({ x: rect.x, y: rect.y }, "a box");
    this.#inside({ x: rect.x + rect.width, y: rect.y + rect.height }, "a box");
    if (!(rect.width > 0 && rect.height > 0)) this.#fail("a box needs a positive width and height");
    this.#parts.push(
      `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" rx="4" class="fig-paper${TONE_PAPER[tone]}${dashed ? " fig-line--dashed" : ""}"/>`,
    );
    const lines =
      options.label === undefined ? [] : typeof options.label === "string" ? [options.label] : options.label;
    if (lines.length > 0) this.#labelIn(rect, lines, style, labelTone);
    return rect;
  }

  #labelIn(rect: Rect, lines: readonly string[], style: TextStyle, tone: Tone): void {
    const size = this.#sizes[style];
    const room = rect.width - 2 * BOX_PADDING;
    for (const line of lines) {
      const width = this.measure(line, style);
      if (width > room) {
        this.#fail(
          `label "${line}" is ${num(width)} wide, but its box leaves ${num(room)}; widen the box or shorten it`,
        );
      }
    }
    const step = size * LINE_HEIGHT;
    const tall = (lines.length - 1) * step + size;
    if (tall > rect.height - BOX_PADDING) {
      this.#fail(
        `the ${lines.length} label lines need ${num(tall)} of height, but the box is ${num(rect.height)} tall`,
      );
    }
    // Centre the block of lines: the first baseline sits one cap height (about 0.7 em) below the block's top.
    const top = rect.y + (rect.height - tall) / 2;
    lines.forEach((line, index) => {
      this.text({ x: rect.x + rect.width / 2, y: top + index * step + size * 0.85 }, line, { style, tone });
    });
  }

  /** A stroked line through two or more points, each inside the canvas and none repeating the one before it. */
  line(points: readonly Point[], options: { readonly tone?: Tone; readonly dashed?: boolean } = {}): void {
    const { tone = "text", dashed = false } = options;
    if (points.length < 2) this.#fail("a line needs at least two points");
    points.forEach((point, index) => {
      this.#inside(point, "a line's point");
      const before = points[index - 1];
      if (before !== undefined && num(before.x) === num(point.x) && num(before.y) === num(point.y)) {
        this.#fail(`a line repeats the point (${num(point.x)}, ${num(point.y)})`);
      }
    });
    this.#stroke(`a line from (${num(points[0]?.x ?? 0)}, ${num(points[0]?.y ?? 0)})`, points);
    const d = points.map((point, index) => `${index === 0 ? "M" : "L"}${num(point.x)} ${num(point.y)}`).join(" ");
    this.#parts.push(`<path d="${d}" class="fig-line${TONE_LINE[tone]}${dashed ? " fig-line--dashed" : ""}"/>`);
  }

  /** A filled arrowhead with its tip at `tip`, pointing along `angle` (radians). */
  #head(tip: Point, angle: number, tone: Tone): void {
    const back = angle + Math.PI;
    const corner = (turn: number): Point => ({
      x: tip.x + HEAD * Math.cos(back + turn),
      y: tip.y + HEAD * Math.sin(back + turn),
    });
    const [left, right] = [corner(HEAD_ANGLE), corner(-HEAD_ANGLE)];
    this.#inside(left, "an arrowhead");
    this.#inside(right, "an arrowhead");
    this.#parts.push(
      `<path d="M${num(tip.x)} ${num(tip.y)} L${num(left.x)} ${num(left.y)} L${num(right.x)} ${num(right.y)} Z" class="${TONE_HEAD[tone]}"/>`,
    );
  }

  /**
   * A straight arrow from `from` to the tip at `to`. The shaft stops inside the head, so its end never shows past the
   * tip; an arrow shorter than twice its head throws, because the head would swallow it.
   */
  arrow(from: Point, to: Point, options: { readonly tone?: Tone; readonly dashed?: boolean } = {}): void {
    const { tone = "text" } = options;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 2 * HEAD) this.#fail(`an arrow ${num(length)} long is shorter than twice its head (${2 * HEAD})`);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const inset = HEAD * Math.cos(HEAD_ANGLE) * 0.9;
    const end = { x: to.x - inset * Math.cos(angle), y: to.y - inset * Math.sin(angle) };
    this.line([from, end], options);
    this.#head(to, angle, tone);
  }

  /**
   * An arrow from the edge of one box to the facing edge of another, along the middle of the span they share. Throws
   * when the boxes overlap, or share no span across the gap between them, so a moved box cannot leave an arrow
   * pointing at nothing.
   */
  connect(from: Rect, to: Rect, options: { readonly tone?: Tone; readonly dashed?: boolean } = {}): void {
    const right = (rect: Rect) => rect.x + rect.width;
    const bottom = (rect: Rect) => rect.y + rect.height;
    const across = (a0: number, a1: number, b0: number, b1: number): number | undefined => {
      const [start, end] = [Math.max(a0, b0), Math.min(a1, b1)];
      return end - start >= 2 * HEAD ? (start + end) / 2 : undefined;
    };
    if (right(from) <= to.x || right(to) <= from.x) {
      const y = across(from.y, bottom(from), to.y, bottom(to));
      if (y === undefined) this.#fail("connect() needs the two boxes to share a horizontal band");
      const forward = right(from) <= to.x;
      this.arrow({ x: forward ? right(from) : from.x, y }, { x: forward ? to.x : right(to), y }, options);
      return;
    }
    if (bottom(from) <= to.y || bottom(to) <= from.y) {
      const x = across(from.x, right(from), to.x, right(to));
      if (x === undefined) this.#fail("connect() needs the two boxes to share a vertical band");
      const down = bottom(from) <= to.y;
      this.arrow({ x, y: down ? bottom(from) : from.y }, { x, y: down ? to.y : bottom(to) }, options);
      return;
    }
    this.#fail("connect() needs a gap between the two boxes, but they overlap");
  }

  /**
   * A quadratic curve from `from` through the pull of `control` to `to`, ending in an arrowhead unless `arrow` is
   * false. The head points along the curve's last direction, from the control point to the tip.
   */
  curve(
    from: Point,
    control: Point,
    to: Point,
    options: { readonly tone?: Tone; readonly dashed?: boolean; readonly arrow?: boolean } = {},
  ): void {
    const { tone = "text", dashed = false, arrow = true } = options;
    for (const point of [from, control, to]) this.#inside(point, "a curve's point");
    let end = to;
    const angle = Math.atan2(to.y - control.y, to.x - control.x);
    if (arrow) {
      const inset = HEAD * Math.cos(HEAD_ANGLE) * 0.9;
      end = { x: to.x - inset * Math.cos(angle), y: to.y - inset * Math.sin(angle) };
    }
    // The curve is checked against labels as 16 straight pieces, close enough at a figure's scale.
    const at = (t: number): Point => ({
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
    });
    this.#stroke(
      `the curve from (${num(from.x)}, ${num(from.y)})`,
      Array.from({ length: 17 }, (_, i) => at(i / 16)),
    );
    this.#parts.push(
      `<path d="M${num(from.x)} ${num(from.y)} Q${num(control.x)} ${num(control.y)} ${num(end.x)} ${num(end.y)}" class="fig-line${TONE_LINE[tone]}${dashed ? " fig-line--dashed" : ""}"/>`,
    );
    if (arrow) this.#head(to, angle, tone);
  }

  /** A filled dot, such as a pin or a marker. */
  dot(center: Point, radius: number, fill: Fill = "text"): void {
    this.#inside({ x: center.x - radius, y: center.y - radius }, "a dot");
    this.#inside({ x: center.x + radius, y: center.y + radius }, "a dot");
    this.#parts.push(
      `<circle cx="${num(center.x)}" cy="${num(center.y)}" r="${num(radius)}" class="${FILL_CLASS[fill]}"/>`,
    );
  }

  /** Draws `draw`'s marks inside a group with the id `<figure id>--<name>`, for a figure part a later step can name. */
  group(name: string, draw: () => void): void {
    this.#parts.push(`<g id="${this.idFor(name)}">`);
    draw();
    this.#parts.push("</g>");
  }

  /**
   * The figure as a standalone SVG file. Its `<style>` embeds the code font as a data URI and defines the panel
   * tokens for both modes, so the file renders correctly on its own, as in a pull request's diff. The build drops
   * that `<style>` when it inlines the figure, because the page serves the same font and tokens from its own
   * stylesheets. `source` is the script's path from the repository root. The header comment never holds "--",
   * which XML forbids in a comment.
   */
  toSvg(source: string): string {
    const font = figureFont();
    const tokens = readTokens();
    const properties = (set: (typeof COLOR_SETS)[number]) =>
      Object.entries(tokens.color[set].values)
        .map(([key, value]) => `${colorProperty(set, key)}:${value.toLowerCase()}`)
        .join(";");
    const style = [
      `@font-face{font-family:"${font.family}";src:url(data:font/woff2;base64,${Buffer.from(font.file).toString("base64")}) format("woff2");font-weight:${font.weight}}`,
      `svg{--font-code:"${font.family}",${tokens.font.code.fallback};${properties("panelLight")};background-color:var(--panel-background)}`,
      `@media (prefers-color-scheme:dark){svg{${properties("panelDark")}}}`,
      this.#rules,
    ].join("\n");
    return [
      `<!-- Generated by ${source} with apps/manual/figures/lib/svgkit.ts. Do not edit: run the figures:build script of @buildanagent/manual. -->`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(this.width)} ${num(this.height)}" width="${num(this.width)}" height="${num(this.height)}" class="fig" data-figure="${this.id}">`,
      `<style>\n${style}\n</style>`,
      ...this.#parts,
      "</svg>",
      "",
    ].join("\n");
  }
}

/** Whether the segment from `a` to `b` passes through the rectangle, by clipping it to the rectangle's slabs. */
function crosses(a: Point, b: Point, rect: Rect): boolean {
  let [low, high] = [0, 1];
  const slabs: [number, number, number][] = [
    [a.x, b.x - a.x, rect.x],
    [a.y, b.y - a.y, rect.y],
  ];
  const sizes = [rect.width, rect.height];
  for (const [index, [start, delta, min]] of slabs.entries()) {
    const max = min + (sizes[index] ?? 0);
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const [t0, t1] = [(min - start) / delta, (max - start) / delta].sort((x, y) => x - y) as [number, number];
    low = Math.max(low, t0);
    high = Math.min(high, t1);
    if (low > high) return false;
  }
  return true;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
