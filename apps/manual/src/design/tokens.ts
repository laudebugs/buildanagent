import { readFileSync } from "node:fs";
import { HEX_COLOR } from "./contrast.js";

// The book's design tokens: their shape in docs/design/book-tokens.json, the checks the file must pass, and the CSS
// custom properties generated from it. The JSON file is the single source; src/styles/tokens.css is its output.

/** Where the token file lives, relative to this module. */
export const TOKENS_URL = new URL("../../../../docs/design/book-tokens.json", import.meta.url);

/** Where the generated CSS lives, relative to this module. */
export const TOKENS_CSS_URL = new URL("../styles/tokens.css", import.meta.url);

/** Where the generated reading-settings CSS lives: the pairings' faces and the text-size steps. */
export const READING_CSS_URL = new URL("../styles/reading.css", import.meta.url);

/** The four colour sets: the page and the code or figure panel, each in a light and a dark mode. */
export const COLOR_SETS = ["light", "dark", "panelLight", "panelDark"] as const;
export type ColorSet = (typeof COLOR_SETS)[number];

/** A text colour measured on a background, both named by their key in the same set. */
export interface TextPair {
  readonly text: string;
  readonly on: string;
  readonly ratio: number;
}

export interface ColorGroup {
  readonly values: Readonly<Record<string, string>>;
  readonly contrast: readonly TextPair[];
}

/** A colour measured on another, both named as `<set>.<key>`: a focus ring for WCAG 1.4.11, or a decorative line. */
export interface ColorPair {
  readonly color: string;
  readonly on: string;
  readonly ratio: number;
}

export interface FontFile {
  readonly src: string;
  readonly style: "normal" | "italic";
  readonly weight: string;
}

export interface FontToken {
  readonly cssFamily: string;
  readonly fallback: string;
  readonly files: readonly FontFile[];
}

/**
 * One typeface pairing a reader can choose. `display` and `body` name a face: `"display"` or `"body"` for the book's
 * own fonts, or a key of {@link ReadingTokens.faces}. `displayWeight` is the weight its headings take.
 */
export interface Pairing {
  readonly id: string;
  readonly label: string;
  readonly display: string;
  readonly body: string;
  readonly displayWeight: number;
}

/** The reader's typeface pairings and text sizes, and the faces only those pairings use. */
export interface ReadingTokens {
  readonly default: string;
  readonly pairings: readonly Pairing[];
  readonly faces: Readonly<Record<string, FontToken>>;
  /** The text-size steps, in percent of the browser's default font size. */
  readonly sizes: readonly number[];
  readonly defaultSize: number;
}

/** A size in px at the phone and desktop widths. */
export interface FluidSize {
  readonly phone: number;
  readonly desktop: number;
}

export interface BookTokens {
  readonly color: Readonly<Record<ColorSet, ColorGroup>> & {
    readonly nonText: { readonly contrast: readonly ColorPair[] };
    readonly decorativeOnly: { readonly contrast: readonly ColorPair[] };
  };
  readonly font: {
    readonly display: FontToken;
    readonly body: FontToken;
    readonly code: FontToken;
    readonly reading: ReadingTokens;
  };
  readonly size: {
    readonly viewport: FluidSize;
    readonly display: Readonly<Record<"title" | "section" | "chapterLink", FluidSize>>;
    readonly body: Readonly<Record<"lede" | "text" | "note", FluidSize>> & { readonly lineHeight: number };
    readonly code: Readonly<Record<"listing" | "label", FluidSize>>;
  };
  readonly layout: {
    readonly pageWidth: number;
    readonly measure: number;
    readonly articleMax: number;
    readonly sideNote: number;
    readonly gutter: FluidSize;
  };
}

/** Reads and parses the token file. */
export function readTokens(url: URL = TOKENS_URL): BookTokens {
  return JSON.parse(readFileSync(url, "utf8")) as BookTokens;
}

function missingKeys(from: ColorGroup, to: ColorGroup): string[] {
  return Object.keys(from.values).filter((key) => !(key in to.values));
}

/**
 * Every reason the token file cannot generate CSS: a colour that is not `#rrggbb`, or a page or panel token that has
 * a value in one mode only, which would leave the other mode showing the wrong colour.
 */
export function tokenProblems(tokens: BookTokens): string[] {
  const problems: string[] = [];
  for (const set of COLOR_SETS) {
    for (const [key, value] of Object.entries(tokens.color[set].values)) {
      if (!HEX_COLOR.test(value)) problems.push(`${set}.${key} is ${value}, not a #rrggbb colour`);
    }
  }
  const twins: readonly [ColorSet, ColorSet][] = [
    ["light", "dark"],
    ["dark", "light"],
    ["panelLight", "panelDark"],
    ["panelDark", "panelLight"],
  ];
  for (const [from, to] of twins) {
    for (const key of missingKeys(tokens.color[from], tokens.color[to])) {
      problems.push(`${from}.${key} has no ${to} value`);
    }
  }
  return problems;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The custom property a colour token becomes: `--color-text-soft` for the page, `--panel-comment` for a panel. */
export function colorProperty(set: ColorSet, key: string): string {
  return set === "light" || set === "dark" ? `--color-${kebab(key)}` : `--panel-${kebab(key)}`;
}

function declarations(tokens: BookTokens, sets: readonly ColorSet[], scheme: string, indent: string): string[] {
  const lines = [`${indent}color-scheme: ${scheme};`];
  for (const set of sets) {
    for (const [key, value] of Object.entries(tokens.color[set].values)) {
      // Lower case, the form Biome formats CSS colours to, so the generated file passes `pnpm check` unchanged.
      lines.push(`${indent}${colorProperty(set, key)}: ${value.toLowerCase()};`);
    }
  }
  return lines;
}

function number(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** A size as rem, scaling linearly with the viewport between the phone and desktop widths and clamped at both. */
export function fluidSize(size: FluidSize, viewport: FluidSize): string {
  if (size.phone === size.desktop) return `${number(size.desktop / 16)}rem`;
  const slope = (size.desktop - size.phone) / (viewport.desktop - viewport.phone);
  const intercept = size.phone - slope * viewport.phone;
  const [min, max] = [size.phone, size.desktop].sort((a, b) => a - b) as [number, number];
  return `clamp(${number(min / 16)}rem, ${number(intercept / 16)}rem + ${number(slope * 100)}vw, ${number(max / 16)}rem)`;
}

/** The folder every font file in book-tokens.json is served from; `fontBase` in {@link TokensCssOptions} replaces it. */
export const FONT_BASE = "/fonts/";

/** What differs between the sites that generate a tokens file: its header comment and where it serves the fonts. */
export interface TokensCssOptions {
  /** The comment's lines, without the comment markers: who writes the file and the command that rewrites it. */
  readonly header?: readonly string[];
  /** The URL folder the fonts are served from, ending in `/`, in place of the `/fonts/` the token file names. */
  readonly fontBase?: string;
}

const BOOK_HEADER = [
  "Generated from docs/design/book-tokens.json by apps/manual/scripts/generate-tokens.ts. Do not edit: change the",
  "JSON file and run `pnpm --filter @buildanagent/manual tokens`.",
];

/** A font file's URL under `fontBase`; a source outside `/fonts/` would be served from nowhere, so it throws. */
export function fontUrl(src: string, fontBase: string = FONT_BASE): string {
  if (!src.startsWith(FONT_BASE)) throw new Error(`font file ${src} is not under ${FONT_BASE}`);
  if (!fontBase.endsWith("/")) throw new Error(`font base ${fontBase} does not end in /`);
  return fontBase + src.slice(FONT_BASE.length);
}

function comment(lines: readonly string[]): string[] {
  if (lines.length === 0) throw new Error("a tokens.css header needs at least one line");
  if (lines.some((line) => line.includes("*/"))) throw new Error("a tokens.css header cannot contain */");
  return lines.map((line, index) => `${index === 0 ? "/* " : "   "}${line}${index === lines.length - 1 ? " */" : ""}`);
}

function fontFaces(fonts: readonly FontToken[], fontBase: string): string[] {
  const lines: string[] = [];
  for (const font of fonts) {
    for (const file of font.files) {
      lines.push(
        "@font-face {",
        `  font-family: "${font.cssFamily}";`,
        `  src: url("${fontUrl(file.src, fontBase)}") format("woff2");`,
        `  font-style: ${file.style};`,
        `  font-weight: ${file.weight};`,
        "  font-display: swap;",
        "}",
        "",
      );
    }
  }
  return lines;
}

function family(font: FontToken): string {
  return `"${font.cssFamily}", ${font.fallback}`;
}

function sharedDeclarations(tokens: BookTokens): string[] {
  const { size } = tokens;
  const sizes: [string, FluidSize][] = [
    ...Object.entries(size.display),
    ...Object.entries(size.body).filter((entry): entry is [string, FluidSize] => typeof entry[1] === "object"),
    ...Object.entries(size.code),
  ];
  return [
    ":root {",
    `  --font-display: ${family(tokens.font.display)};`,
    `  --font-body: ${family(tokens.font.body)};`,
    `  --font-code: ${family(tokens.font.code)};`,
    ...sizes.map(([name, value]) => `  --size-${kebab(name)}: ${fluidSize(value, size.viewport)};`),
    `  --line-height-body: ${size.body.lineHeight};`,
    `  --page-width: ${number(tokens.layout.pageWidth / 16)}rem;`,
    `  --measure: ${number(tokens.layout.measure / 16)}rem;`,
    `  --article-max: ${number(tokens.layout.articleMax / 16)}rem;`,
    `  --side-note-width: ${number(tokens.layout.sideNote / 16)}rem;`,
    `  --gutter: ${fluidSize(tokens.layout.gutter, size.viewport)};`,
    "}",
  ];
}

/**
 * The CSS custom properties for the book. Light values sit on `:root` and on any `[data-theme="light"]` element; dark
 * values apply under `prefers-color-scheme: dark` unless the reader chose light, and on any `[data-theme="dark"]`
 * element. The panel tokens follow the same rule, so a panel always matches its page's mode. Without options it writes
 * the book's own file; another site passes its own header and font folder.
 */
export function tokensCss(tokens: BookTokens, options: TokensCssOptions = {}): string {
  const problems = tokenProblems(tokens);
  if (problems.length > 0) throw new Error(`book-tokens.json cannot generate CSS:\n${problems.join("\n")}`);
  const light: readonly ColorSet[] = ["light", "panelLight"];
  const dark: readonly ColorSet[] = ["dark", "panelDark"];
  return [
    ...comment(options.header ?? BOOK_HEADER),
    "",
    ...fontFaces([tokens.font.display, tokens.font.body, tokens.font.code], options.fontBase ?? FONT_BASE),
    ...sharedDeclarations(tokens),
    "",
    ":root,",
    '[data-theme="light"] {',
    ...declarations(tokens, light, "light", "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    ...declarations(tokens, dark, "dark", "    "),
    "  }",
    "}",
    "",
    '[data-theme="dark"] {',
    ...declarations(tokens, dark, "dark", "  "),
    "}",
    "",
  ].join("\n");
}

/** The face a pairing names: the book's own display or body font, or one of the reading faces. */
export function pairingFace(tokens: BookTokens, name: string): FontToken {
  if (name === "display" || name === "body") return tokens.font[name];
  const face = Object.hasOwn(tokens.font.reading.faces, name) ? tokens.font.reading.faces[name] : undefined;
  if (face === undefined) throw new Error(`a pairing names the face ${name}, which book-tokens.json lacks`);
  return face;
}

/**
 * The file a pairing's text starts with: the upright file of its body face and the upright file of its display face
 * nearest its heading weight. The page preloads these for the chosen pairing (public/scripts/reading-settings.js).
 */
export function pairingPreloads(tokens: BookTokens, pairing: Pairing): string[] {
  const upright = (face: FontToken, weight: number): string => {
    const covers = (file: FontFile): boolean => {
      const [low = 0, high = low] = file.weight.split(" ").map(Number);
      return weight >= low && weight <= high;
    };
    const romans = face.files.filter((file) => file.style === "normal");
    const file = romans.find(covers) ?? romans[0];
    if (file === undefined) throw new Error(`${face.cssFamily} has no upright file`);
    return file.src;
  };
  const files = [
    upright(pairingFace(tokens, pairing.body), 400),
    upright(pairingFace(tokens, pairing.display), pairing.displayWeight),
  ];
  return [...new Set(files)];
}

/**
 * Every file a pairing's text can use: each file of its display face and of its body face, italics and bold included,
 * in that order and without repeats. The settings panel asks the offline worker to save these for a chosen pairing.
 */
export function pairingFiles(tokens: BookTokens, pairing: Pairing): string[] {
  const faces = [pairingFace(tokens, pairing.display), pairingFace(tokens, pairing.body)];
  return [...new Set(faces.flatMap((face) => face.files.map((file) => file.src)))];
}

const READING_HEADER = [
  "Generated from docs/design/book-tokens.json by apps/manual/scripts/generate-tokens.ts. Do not edit: change the",
  "JSON file's font.reading block and run `pnpm --filter @buildanagent/manual tokens`.",
];

/**
 * Problems with the reading block that would let the page reach a face or a size nobody declared: a pairing naming a
 * missing face, a repeated id, an id that is not lower-case letters, a default that is no pairing or that does not use
 * the book's own display and body faces, or a size list without its default.
 */
export function readingProblems(tokens: BookTokens): string[] {
  const reading = tokens.font.reading;
  const problems: string[] = [];
  const ids = reading.pairings.map((pairing) => pairing.id);
  if (new Set(ids).size !== ids.length) problems.push("two pairings share an id");
  if (!ids.includes(reading.default)) problems.push(`the default pairing ${reading.default} is not a pairing`);
  const book = reading.pairings.find((pairing) => pairing.id === reading.default);
  if (book !== undefined && (book.display !== "display" || book.body !== "body")) {
    // readingCss writes no family rule for the default pairing, so the page shows tokens.css's own faces.
    problems.push(`the default pairing ${book.id} must use the book's own display and body faces`);
  }
  for (const pairing of reading.pairings) {
    if (!/^[a-z]+$/.test(pairing.id)) problems.push(`pairing id ${pairing.id} is not lower-case letters`);
    for (const name of [pairing.display, pairing.body]) {
      if (name !== "display" && name !== "body" && !Object.hasOwn(reading.faces, name)) {
        problems.push(`pairing ${pairing.id} names the face ${name}, which font.reading.faces lacks`);
      }
    }
  }
  if (!reading.sizes.includes(reading.defaultSize)) problems.push(`the default size ${reading.defaultSize} is no step`);
  if (reading.sizes.some((size) => !Number.isInteger(size) || size <= 0))
    problems.push("a size is not a whole percent");
  return problems;
}

/**
 * The reading settings' CSS. Every reading face gets its @font-face rule, which a browser downloads only once an
 * element uses that family, and a pairing's families are named only under `:root[data-reading-font="<id>"]`. With no
 * attribute, or the default pairing's, the page keeps tokens.css's families. The default pairing sets the heading
 * weight on `:root`. A size step other than the default sets the root font size, which every rem follows, and
 * `--reading-scale`, which the header divides by to keep its own size.
 */
export function readingCss(tokens: BookTokens, fontBase: string = FONT_BASE): string {
  const problems = readingProblems(tokens);
  if (problems.length > 0) throw new Error(`book-tokens.json cannot generate reading.css:\n${problems.join("\n")}`);
  const reading = tokens.font.reading;
  const fallback = reading.pairings.find((pairing) => pairing.id === reading.default) as Pairing;
  const lines = [
    ...comment(READING_HEADER),
    "",
    ...fontFaces(Object.values(reading.faces), fontBase),
    ":root {",
    `  --weight-display: ${fallback.displayWeight};`,
    "  --reading-scale: 1;",
    "}",
    "",
  ];
  for (const pairing of reading.pairings) {
    if (pairing.id === reading.default) continue;
    lines.push(
      `:root[data-reading-font="${pairing.id}"] {`,
      `  --font-display: ${family(pairingFace(tokens, pairing.display))};`,
      `  --font-body: ${family(pairingFace(tokens, pairing.body))};`,
      `  --weight-display: ${pairing.displayWeight};`,
      "}",
      "",
    );
  }
  // The settings panel shows an "Aa" in each pairing's heading face, whatever pairing the page is in. A face is
  // downloaded once an element uses it, and the panel is not drawn until it opens, so these cost nothing until then.
  for (const pairing of reading.pairings) {
    lines.push(
      `[data-reading-sample="${pairing.id}"] {`,
      `  font-family: ${family(pairingFace(tokens, pairing.display))};`,
      `  font-weight: ${pairing.displayWeight};`,
      "}",
      "",
    );
  }
  for (const size of reading.sizes) {
    if (size === reading.defaultSize) continue;
    lines.push(
      `:root[data-reading-size="${size}"] {`,
      `  --reading-scale: ${number(size / 100)};`,
      `  font-size: ${size}%;`,
      "}",
      "",
    );
  }
  return lines.join("\n");
}
