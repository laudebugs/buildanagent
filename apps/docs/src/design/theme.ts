import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type BookTokens,
  type ColorSet,
  colorProperty,
  type FontToken,
  readTokens,
  tokensCss,
} from "@buildanagent/manual/design/tokens";

// The docs site's theme is the book's: the same token file, the same generator and the same font files. This module
// says where the docs keep their copies and builds the parts Starlight takes as configuration, not as CSS. One thing
// differs: the docs set their body text in IBM Plex Sans, a family the book does not use, so the docs own its files.

/** Where the generated tokens file lives. Starlight loads it through `customCss`. */
export const DOCS_TOKENS_CSS_URL = new URL("../styles/tokens.css", import.meta.url);

/** The docs site's copy of the book's fonts, served at `/fonts/`. */
export const DOCS_FONTS_URL = new URL("../../public/fonts/", import.meta.url);

// The book serves its fonts from its own public/fonts/, two folders up from the tokens module. The package exports
// that module, so the path follows the package wherever pnpm links it.
const require = createRequire(import.meta.url);

/** The book's fonts folder, the source the docs copy is made from. */
export const BOOK_FONTS_URL = new URL(
  "../../public/fonts/",
  pathToFileURL(require.resolve("@buildanagent/manual/design/tokens")),
);

const HEADER = [
  "Generated from docs/design/book-tokens.json by apps/docs/scripts/generate-tokens.ts. Do not edit: change the JSON",
  "file and run `pnpm --filter @buildanagent/docs tokens`.",
];

/** The colour sets a printed page takes: the light page and the light panel, whatever mode the reader chose. */
export const PRINT_COLOR_SETS: readonly ColorSet[] = ["light", "panelLight"];

/**
 * The selector of the print block. Starlight's print stylesheet forces light colours by resetting its own variables,
 * but the mapping in starlight.css points them back at the tokens, so the tokens themselves must turn light on paper.
 * The two selectors match every element the dark blocks above match, at the same specificity, and come after them.
 */
export const PRINT_SELECTOR = ':root:not([data-theme="light"]),\n  [data-theme]';

function printBlock(tokens: BookTokens): string[] {
  const lines = ["@media print {", `  ${PRINT_SELECTOR} {`, "    color-scheme: light;"];
  for (const set of PRINT_COLOR_SETS) {
    for (const [key, value] of Object.entries(tokens.color[set].values)) {
      lines.push(`    ${colorProperty(set, key)}: ${value.toLowerCase()};`);
    }
  }
  return [...lines, "  }", "}", ""];
}

/** The docs' own copy of IBM Plex Sans, served at `/fonts/ibm-plex-sans/`. IBM's files, unchanged. */
export const PLEX_FONTS_URL = new URL("ibm-plex-sans/", DOCS_FONTS_URL);

/** The pin of the IBM Plex Sans files: where they came from and the SHA-256 of each. */
export const PLEX_PIN_URL = new URL("../../fonts/ibm-plex-sans.json", import.meta.url);

/** One file of the pin. */
export interface PlexFile {
  readonly name: string;
  readonly style: "normal" | "italic";
  readonly weight: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** What `fonts/ibm-plex-sans.json` records about the IBM Plex Sans files the docs serve. */
export interface PlexPin {
  readonly family: string;
  readonly package: string;
  readonly version: string;
  readonly published: string;
  /** The day the release was pinned, at least a week after `published`. */
  readonly pinned: string;
  readonly registry: string;
  readonly integrity: string;
  readonly gitHead: string;
  readonly repository: string;
  readonly license: string;
  readonly copyright: string;
  readonly folder: string;
  readonly licenseFile: { readonly from: string; readonly name: string; readonly sha256: string };
  readonly files: readonly PlexFile[];
  readonly unicodeRange: string;
}

/** Reads the pin of the IBM Plex Sans files. */
export function readPlexPin(): PlexPin {
  return JSON.parse(readFileSync(PLEX_PIN_URL, "utf8")) as PlexPin;
}

/** The family name of the metric-matched stand-in the browser draws while Plex loads. */
export const PLEX_FALLBACK_FAMILY = "IBM Plex Sans Fallback";

/** The body font's fallback chain: the stand-in first, then the system's own sans faces. */
export const BODY_FALLBACK = `"${PLEX_FALLBACK_FAMILY}", system-ui, -apple-system, "Segoe UI", sans-serif`;

/**
 * The stand-in faces. Each lays text out in Arial or an Arial-compatible face at the width and line box of the Plex
 * face it stands for, so the swap to Plex moves no line. `sizeAdjust` is Plex's width over Arial's, measured over the
 * characters of the docs' prose; the ascent and descent are Plex's hhea values (1.025 and 0.275 em) divided by it, and
 * the line gap is zero in both. The README says how the numbers were measured.
 */
export const PLEX_FALLBACKS = [
  { style: "normal", weight: 400, local: ["Arial", "Liberation Sans", "Helvetica"], sizeAdjust: 100 },
  {
    style: "italic",
    weight: 400,
    local: ["Arial Italic", "Liberation Sans Italic", "Helvetica Oblique"],
    sizeAdjust: 98.4,
  },
  { style: "normal", weight: 600, local: ["Arial Bold", "Liberation Sans Bold", "Helvetica Bold"], sizeAdjust: 96.4 },
] as const;

const PLEX_ASCENT = 1.025;
const PLEX_DESCENT = 0.275;

function percent(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}

/** The docs' body font as the tokens name it, with the pin's files; the book's tokens have no such font. */
export function plexFont(pin: PlexPin = readPlexPin()): FontToken {
  return {
    cssFamily: pin.family,
    fallback: BODY_FALLBACK,
    files: pin.files.map((file) => ({
      src: `/fonts/ibm-plex-sans/${file.name}`,
      style: file.style,
      weight: String(file.weight),
    })),
  };
}

/**
 * The `@font-face` rules for the body font: each Plex file with the pin's unicode range, then the stand-in faces. The
 * range is derived from the one IBM's CSS gives the Latin1 subset, minus U+2074, which no shipped file maps, and with
 * IBM's two pieces of U+00A0-00FF joined. The book's generator writes no unicode range or size metrics, so the docs
 * write these.
 */
export function plexFontFaces(pin: PlexPin = readPlexPin()): string[] {
  const lines: string[] = [];
  for (const file of plexFont(pin).files) {
    lines.push(
      "@font-face {",
      `  font-family: "${pin.family}";`,
      `  src: url("${file.src}") format("woff2");`,
      `  font-style: ${file.style};`,
      `  font-weight: ${file.weight};`,
      "  font-display: swap;",
      // Biome wraps a value this long onto its own line, so the generator writes the formatted form.
      "  unicode-range:",
      `    ${pin.unicodeRange};`,
      "}",
      "",
    );
  }
  for (const face of PLEX_FALLBACKS) {
    lines.push(
      "@font-face {",
      `  font-family: "${PLEX_FALLBACK_FAMILY}";`,
      `  src: ${face.local.map((name) => `local("${name}")`).join(", ")};`,
      `  font-style: ${face.style};`,
      `  font-weight: ${face.weight};`,
      `  size-adjust: ${percent(face.sizeAdjust)};`,
      `  ascent-override: ${percent((PLEX_ASCENT * 10000) / face.sizeAdjust)};`,
      `  descent-override: ${percent((PLEX_DESCENT * 10000) / face.sizeAdjust)};`,
      "  line-gap-override: 0%;",
      "}",
      "",
    );
  }
  return lines;
}

/**
 * The book's tokens with the docs' body font in place of the book's own. The display and code fonts, the colours and
 * the sizes stay the book's, so the docs differ from the book in one font only (the owner's choice, 2026-11-24).
 */
export function docsTokens(tokens: BookTokens = readTokens()): BookTokens {
  return { ...tokens, font: { ...tokens.font, body: plexFont() } };
}

/**
 * The docs site's tokens file: the book's custom properties, under the docs site's own header, then a print block
 * that gives paper the light colours in either mode.
 */
export function docsTokensCss(tokens: BookTokens = readTokens()): string {
  const docs = docsTokens(tokens);
  // The book's generator writes the body font's rules without a unicode range or a stand-in face, so it gets the body
  // font with no files and the docs' own rules go in before the custom properties.
  const generated = tokensCss(
    { ...docs, font: { ...docs.font, body: { ...docs.font.body, files: [] } } },
    { header: HEADER },
  );
  return [insertBeforeRoot(generated, `${plexFontFaces().join("\n")}\n`), ...printBlock(tokens)].join("\n");
}

const ROOT_ANCHOR = ":root {";

/**
 * Puts `text` before the first `:root {` block of the book generator's output. It throws when the output has no such
 * block, so a change to the book's generator fails the docs build instead of mangling the CSS.
 */
export function insertBeforeRoot(generated: string, text: string): string {
  const at = generated.indexOf(ROOT_ANCHOR);
  if (at === -1) {
    throw new Error(
      `the book's token output has no "${ROOT_ANCHOR}" block to put the docs' Plex @font-face rules before`,
    );
  }
  return `${generated.slice(0, at)}${text}${generated.slice(at)}`;
}

/** The names of the folders directly under a fonts folder, sorted; none when the folder is missing. */
export function fontFolders(folder: URL): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every file under a fonts folder, as paths relative to it with `/` separators, sorted. */
export function fontFiles(folder: URL): string[] {
  const root = fileURLToPath(folder);
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/**
 * The book's font folders the docs serve: those of the display and code fonts the tokens name. The body font is not
 * the book's, so its folder is the docs' own and stays out.
 */
export function docsFontFolders(tokens: BookTokens = readTokens()): string[] {
  const docs = docsTokens(tokens);
  const folders = [docs.font.display, docs.font.code].flatMap((font) =>
    font.files.map((file) => file.src.split("/")[2] ?? ""),
  );
  return [...new Set(folders)].sort();
}

/** The book's font files the docs serve: every file in {@link docsFontFolders}, as {@link fontFiles} lists them. */
export function bookFontFilesForDocs(): string[] {
  const folders = docsFontFolders();
  return fontFiles(BOOK_FONTS_URL).filter((file) => folders.includes(file.split("/")[0] ?? ""));
}

/** The docs' own font folder, which {@link copyFonts} leaves in place. */
export const PLEX_FOLDER = "ibm-plex-sans";

/**
 * Replaces the book's copies in the docs fonts folder with fresh ones. Everything else at the folder's top level goes,
 * stray files included, so a font the book drops leaves too; only the docs' own Plex folder stays as it is. A missing
 * folder is created.
 */
export function copyFonts(target: URL = DOCS_FONTS_URL, source: URL = BOOK_FONTS_URL): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === PLEX_FOLDER && entry.isDirectory()) continue;
    rmSync(new URL(entry.name, target), { recursive: true, force: true });
  }
  for (const folder of docsFontFolders()) {
    cpSync(new URL(`${folder}/`, source), new URL(`${folder}/`, target), { recursive: true });
  }
}

/** Whether a CSS `font-weight` value, one weight or a variable font's `low high` range, includes `weight`. */
export function weightIncludes(value: string, weight: number): boolean {
  const [low, high = low] = value.trim().split(/\s+/).map(Number);
  return low !== undefined && high !== undefined && low <= weight && weight <= high;
}

/** The two font files every page preloads: the body font's regular face and the display font's roman. */
export function preloadedFonts(tokens: BookTokens = readTokens()): string[] {
  const docs = docsTokens(tokens);
  return [docs.font.body, docs.font.display].map((font) => {
    const file = font.files.find((entry) => entry.style === "normal" && weightIncludes(entry.weight, 400));
    if (file === undefined) throw new Error(`${font.cssFamily} has no regular file to preload`);
    return file.src;
  });
}

/** A TextMate theme as Expressive Code takes it: plain data, so Starlight can serialise it into its config. */
export interface CodeTheme {
  readonly name: string;
  readonly type: "light" | "dark";
  readonly colors: Readonly<Record<string, string>>;
  readonly tokenColors: readonly {
    readonly scope?: readonly string[];
    readonly settings: { readonly foreground?: string; readonly background?: string; readonly fontStyle?: string };
  }[];
}

/** The TextMate scopes each panel colour paints, after the book's listings: amber keywords, olive strings. */
export const CODE_SCOPES = {
  comment: ["comment", "punctuation.definition.comment"],
  amber: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.operator.new", "keyword.control"],
  olive: ["string", "string.template", "punctuation.definition.string", "string.quoted", "markup.inline.raw"],
  terracotta: [
    "constant.numeric",
    "constant.language",
    "entity.name.type",
    "entity.other.inherited-class",
    "support.type",
    "support.class",
    "entity.name.class",
  ],
} as const;

function codeTheme(tokens: BookTokens, type: "light" | "dark"): CodeTheme {
  const panel = tokens.color[type === "light" ? "panelLight" : "panelDark"].values;
  const value = (key: string): string => {
    const color = panel[key];
    if (color === undefined) throw new Error(`the ${type} panel has no ${key} colour`);
    return color.toLowerCase();
  };
  return {
    name: `buildanagent-${type}`,
    type,
    colors: {
      "editor.background": value("background"),
      "editor.foreground": value("text"),
      "editorLineNumber.foreground": value("comment"),
    },
    tokenColors: [
      { settings: { foreground: value("text"), background: value("background") } },
      { scope: CODE_SCOPES.comment, settings: { foreground: value("comment"), fontStyle: "italic" } },
      { scope: CODE_SCOPES.amber, settings: { foreground: value("amber") } },
      { scope: CODE_SCOPES.olive, settings: { foreground: value("olive") } },
      { scope: CODE_SCOPES.terracotta, settings: { foreground: value("terracotta") } },
    ],
  };
}

/** Expressive Code's two themes, from the book's `panelDark` and `panelLight` colours; the dark one comes first. */
export function codeThemes(tokens: BookTokens = readTokens()): [CodeTheme, CodeTheme] {
  return [codeTheme(tokens, "dark"), codeTheme(tokens, "light")];
}

/**
 * Expressive Code's frame and text colours. They name the panel tokens, so a code block switches with the page's
 * theme the same way the rest of the page does, and the code face is the book's.
 */
export const CODE_STYLE_OVERRIDES = {
  borderColor: "var(--panel-border)",
  borderRadius: "0.25rem",
  codeBackground: "var(--panel-background)",
  codeForeground: "var(--panel-text)",
  codeFontFamily: "var(--font-code)",
  uiFontFamily: "var(--font-body)",
  focusBorder: "var(--color-accent)",
  frames: {
    editorBackground: "var(--panel-background)",
    terminalBackground: "var(--panel-background)",
    editorTabBarBackground: "var(--panel-background)",
    editorTabBarBorderBottomColor: "var(--panel-border)",
    editorActiveTabBackground: "var(--panel-background)",
    editorActiveTabForeground: "var(--panel-text)",
    editorActiveTabIndicatorTopColor: "var(--color-accent)",
    terminalTitlebarBackground: "var(--panel-background)",
    terminalTitlebarForeground: "var(--panel-text)",
    terminalTitlebarBorderBottomColor: "var(--panel-border)",
    terminalTitlebarDotsForeground: "var(--panel-comment)",
    inlineButtonForeground: "var(--panel-text)",
    inlineButtonBorder: "var(--panel-comment)",
    tooltipSuccessBackground: "var(--color-accent)",
    tooltipSuccessForeground: "var(--color-background)",
    frameBoxShadowCssValue: "none",
  },
  // Marked, inserted and deleted code sits on the panel's grid shade, which every syntax colour reaches 4.5:1 on in
  // both modes; the kind shows in the edge and the diff sign, in the panel's amber, olive and terracotta, and a line
  // marker's label is the panel background on that edge. Expressive Code's own marker colours are translucent and
  // unmeasured, and its contrast correction is off (see astro.config.mjs), so every marker colour is a token here.
  textMarkers: {
    markBackground: "var(--panel-grid)",
    markBorderColor: "var(--panel-amber)",
    insBackground: "var(--panel-grid)",
    insBorderColor: "var(--panel-olive)",
    insDiffIndicatorColor: "var(--panel-olive)",
    delBackground: "var(--panel-grid)",
    delBorderColor: "var(--panel-terracotta)",
    delDiffIndicatorColor: "var(--panel-terracotta)",
    lineMarkerLabelColor: "var(--panel-background)",
  },
} as const;
