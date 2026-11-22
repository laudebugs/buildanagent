// A small drawing helper for the landing page's flat figures. The manual's figure kit (apps/manual/figures/lib/svgkit.ts)
// caps a figure at 520 px and takes its colours from classes the manual's stylesheet defines, so it does not fit a
// 900 px figure that follows the landing page's own custom properties. This helper keeps its two ideas: it writes the
// same bytes every time, and it checks that no label touches a mark it does not belong to.

/** A rectangle: its top-left corner and its size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The width of one character of the figure's monospace labels, as a share of the font size. */
export const CHAR_WIDTH = 0.6;
/** The smallest label the figure may carry, in the figure's own units, which are CSS pixels at its natural size. */
export const MIN_FONT_SIZE = 12;
/** The space two marks must leave between them. */
const CLEARANCE = 2;
/** Half the width of a stroked line, for the box a line occupies. */
const HALF_STROKE = 1.25;

interface Mark {
  readonly id: string;
  readonly rect: Rect;
}

interface Label {
  readonly text: string;
  readonly rect: Rect;
  readonly fontSize: number;
  /** The id of the mark the label sits on, or undefined for a label that stands alone. */
  readonly on: string | undefined;
}

/** The text styles a label can take: its anchor, its colour and its weight. */
export interface TextOptions {
  readonly anchor?: "start" | "middle";
  readonly fill?: string;
  readonly weight?: number;
  /** The mark the label sits on: it may overlap that mark and must lie inside it. */
  readonly on?: string;
}

/** Writes a number the same way every time: two decimals at most, no trailing zeros, no negative zero. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`a coordinate is ${value}, not a finite number`);
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? "0" : String(rounded);
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One flat figure: collects its marks and labels, writes them as an SVG and reports the overlaps it finds. */
export class Drawing {
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly className: string;
  readonly fontSize: number;
  readonly #parts: string[] = [];
  readonly marks: Mark[] = [];
  readonly labels: Label[] = [];

  constructor(options: { width: number; height: number; alt: string; className: string; fontSize?: number }) {
    this.width = options.width;
    this.height = options.height;
    this.alt = options.alt;
    this.className = options.className;
    this.fontSize = options.fontSize ?? 13;
  }

  /** Registers a mark: a box that labels not attached to it must keep clear of. */
  mark(id: string, rect: Rect): void {
    this.marks.push({ id, rect });
  }

  /** A filled polygon with the figure's stroke. It is only drawn: `mark` registers the box labels must respect. */
  face(points: readonly [number, number][], fill: string): void {
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${num(x)} ${num(y)}`).join("");
    this.#parts.push(`<path d="${d}Z" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`);
  }

  /** An empty rectangle with the figure's stroke. */
  box(id: string, rect: Rect): void {
    this.marks.push({ id, rect });
    this.#parts.push(
      `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" ` +
        `fill="none" stroke="currentColor" stroke-width="2"/>`,
    );
  }

  /** A straight accent line through `points`, as a polyline of horizontal and vertical segments. */
  line(id: string, points: readonly [number, number][], width = 2): void {
    points.slice(1).forEach(([x, y], i) => {
      const [x0, y0] = points[i] ?? [x, y];
      this.marks.push({
        id: `${id}-${i}`,
        rect: {
          x: Math.min(x0, x) - HALF_STROKE,
          y: Math.min(y0, y) - HALF_STROKE,
          width: Math.abs(x - x0) + 2 * HALF_STROKE,
          height: Math.abs(y - y0) + 2 * HALF_STROKE,
        },
      });
    });
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${num(x)} ${num(y)}`).join("");
    this.#parts.push(
      `<path d="${d}" fill="none" stroke="var(--a)" stroke-width="${num(width)}" stroke-linejoin="miter"/>`,
    );
  }

  /** A filled accent triangle whose tip is at `tip` and whose back points the other way, along `direction`. */
  head(id: string, tip: readonly [number, number], direction: "right" | "up"): void {
    const [x, y] = tip;
    const points: [number, number][] =
      direction === "right"
        ? [
            [x, y],
            [x - 8, y - 5],
            [x - 8, y + 5],
          ]
        : [
            [x, y],
            [x - 5, y + 8],
            [x + 5, y + 8],
          ];
    const xs = points.map(([px]) => px);
    const ys = points.map(([, py]) => py);
    this.marks.push({
      id,
      rect: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
    });
    const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${num(px)} ${num(py)}`).join("");
    this.#parts.push(`<path d="${d}Z" fill="var(--a)" stroke="none"/>`);
  }

  /** A label whose baseline starts, or is centred, at (x, y). It never carries a stroke. */
  text(text: string, x: number, y: number, options: TextOptions = {}): void {
    const anchor = options.anchor ?? "start";
    const width = [...text].length * this.fontSize * CHAR_WIDTH;
    const left = anchor === "middle" ? x - width / 2 : x;
    this.labels.push({
      text,
      fontSize: this.fontSize,
      on: options.on,
      rect: { x: left, y: y - this.fontSize * 0.8, width, height: this.fontSize * 1.05 },
    });
    const attrs = [
      `x="${num(x)}"`,
      `y="${num(y)}"`,
      anchor === "middle" ? 'text-anchor="middle"' : "",
      `fill="${options.fill ?? "currentColor"}"`,
      'stroke="none"',
      options.weight === undefined ? "" : `font-weight="${options.weight}"`,
    ].filter((attr) => attr !== "");
    this.#parts.push(`<text ${attrs.join(" ")}>${escapeXml(text)}</text>`);
  }

  /** Every overlap, clipping and size problem in the drawing, one sentence each; none means the figure is clean. */
  problems(): string[] {
    const found: string[] = [];
    const inside = (inner: Rect, outer: Rect, slack = 0): boolean =>
      inner.x >= outer.x - slack &&
      inner.y >= outer.y - slack &&
      inner.x + inner.width <= outer.x + outer.width + slack &&
      inner.y + inner.height <= outer.y + outer.height + slack;
    const touches = (a: Rect, b: Rect): boolean =>
      a.x < b.x + b.width + CLEARANCE &&
      b.x < a.x + a.width + CLEARANCE &&
      a.y < b.y + b.height + CLEARANCE &&
      b.y < a.y + a.height + CLEARANCE;
    const canvas = { x: 0, y: 0, width: this.width, height: this.height };
    for (const label of this.labels) {
      if (label.fontSize < MIN_FONT_SIZE)
        found.push(`"${label.text}" is ${label.fontSize}px, under ${MIN_FONT_SIZE}px`);
      if (!inside(label.rect, canvas)) found.push(`"${label.text}" leaves the ${this.width} x ${this.height} canvas`);
      if (label.on !== undefined) {
        const host = this.marks.find((mark) => mark.id === label.on);
        if (host === undefined) found.push(`"${label.text}" names the unknown mark ${label.on}`);
        else if (!inside(label.rect, host.rect)) found.push(`"${label.text}" does not fit inside ${label.on}`);
      }
      for (const mark of this.marks) {
        if (mark.id !== label.on && touches(label.rect, mark.rect)) found.push(`"${label.text}" touches ${mark.id}`);
      }
    }
    this.labels.forEach((a, i) => {
      for (const b of this.labels.slice(i + 1)) {
        if (touches(a.rect, b.rect)) found.push(`"${a.text}" overlaps "${b.text}"`);
      }
    });
    for (const mark of this.marks) {
      if (!inside(mark.rect, canvas)) found.push(`${mark.id} leaves the ${this.width} x ${this.height} canvas`);
    }
    return found;
  }

  /**
   * The SVG file. It is named for screen readers and styled by the page's custom properties (`--cell`, `--bg`, `--a`),
   * which the page sets, so one file serves light and dark. `className` lets the page's stylesheet show one drawing.
   */
  toSvg(): string {
    const head =
      `<svg xmlns="http://www.w3.org/2000/svg" class="${this.className}" viewBox="0 0 ${this.width} ${this.height}" ` +
      `role="img" aria-label="${escapeXml(this.alt)}" ` +
      `style="font-family:var(--font-code);font-size:${this.fontSize}px">`;
    return `${head}\n${this.#parts.map((part) => `  ${part}`).join("\n")}\n</svg>\n`;
  }
}
