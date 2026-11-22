import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type BookTokens, readTokens, tokensCss } from "@buildanagent/manual/design/tokens";

// The docs site's theme is the book's: the same token file, the same generator and the same font files. This module
// says where the docs keep their copies and builds the parts Starlight takes as configuration, not as CSS.

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

/** The docs site's tokens file: the book's custom properties, under the docs site's own header. */
export function docsTokensCss(tokens: BookTokens = readTokens()): string {
  return tokensCss(tokens, { header: HEADER });
}

/** Every file under a fonts folder, as paths relative to it with `/` separators, sorted. */
export function fontFiles(folder: URL): string[] {
  const root = fileURLToPath(folder);
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/** Replaces the docs fonts folder with a copy of the book's, so a font the book drops leaves the docs too. */
export function copyFonts(): void {
  rmSync(DOCS_FONTS_URL, { recursive: true, force: true });
  cpSync(BOOK_FONTS_URL, DOCS_FONTS_URL, { recursive: true });
}

/** The two font files every page preloads, the regular faces of the body and display fonts, as the book does. */
export function preloadedFonts(tokens: BookTokens = readTokens()): string[] {
  return [tokens.font.body, tokens.font.display].map((font) => {
    const file = font.files.find((entry) => entry.style === "normal");
    if (file === undefined) throw new Error(`${font.cssFamily} has no roman file to preload`);
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
} as const;
