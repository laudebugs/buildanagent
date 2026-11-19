import { readFileSync } from "node:fs";
import { HEX_COLOR } from "./contrast.js";

// The book's design tokens: their shape in docs/design/book-tokens.json, the checks the file must pass, and the CSS
// custom properties generated from it. The JSON file is the single source; src/styles/tokens.css is its output.

/** Where the token file lives, relative to this module. */
export const TOKENS_URL = new URL("../../../../docs/design/book-tokens.json", import.meta.url);

/** Where the generated CSS lives, relative to this module. */
export const TOKENS_CSS_URL = new URL("../styles/tokens.css", import.meta.url);

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
  readonly font: { readonly display: FontToken; readonly body: FontToken; readonly code: FontToken };
  readonly size: {
    readonly viewport: FluidSize;
    readonly display: Readonly<Record<"title" | "section" | "chapterLink", FluidSize>>;
    readonly body: Readonly<Record<"lede" | "text" | "note", FluidSize>> & { readonly lineHeight: number };
    readonly code: Readonly<Record<"listing" | "label", FluidSize>>;
  };
  readonly layout: {
    readonly pageWidth: number;
    readonly measure: number;
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

function fontFaces(tokens: BookTokens): string[] {
  const lines: string[] = [];
  for (const font of [tokens.font.display, tokens.font.body, tokens.font.code]) {
    for (const file of font.files) {
      lines.push(
        "@font-face {",
        `  font-family: "${font.cssFamily}";`,
        `  src: url("${file.src}") format("woff2");`,
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
    `  --side-note-width: ${number(tokens.layout.sideNote / 16)}rem;`,
    `  --gutter: ${fluidSize(tokens.layout.gutter, size.viewport)};`,
    "}",
  ];
}

/**
 * The CSS custom properties for the book. Light values sit on `:root` and on any `[data-theme="light"]` element; dark
 * values apply under `prefers-color-scheme: dark` unless the reader chose light, and on any `[data-theme="dark"]`
 * element. The panel tokens follow the same rule, so a panel always matches its page's mode.
 */
export function tokensCss(tokens: BookTokens): string {
  const problems = tokenProblems(tokens);
  if (problems.length > 0) throw new Error(`book-tokens.json cannot generate CSS:\n${problems.join("\n")}`);
  const light: readonly ColorSet[] = ["light", "panelLight"];
  const dark: readonly ColorSet[] = ["dark", "panelDark"];
  return [
    "/* Generated from docs/design/book-tokens.json by apps/manual/scripts/generate-tokens.ts. Do not edit: change the",
    "   JSON file and run `pnpm --filter @buildanagent/manual tokens`. */",
    "",
    ...fontFaces(tokens),
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
