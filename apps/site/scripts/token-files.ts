// The files the site derives from the book's design tokens. The path below reaches into the manual because L12a has not
// yet exported its tokens module; L12a's `@buildanagent/manual` export replaces the relative import.
import { readTokens, tokensCss } from "../../manual/src/design/tokens.js";

/** A generated file: its path under apps/site and its exact content. */
export interface TokenFile {
  readonly path: string;
  readonly content: string;
}

/**
 * The generated stylesheet and the two page colours a `theme-color` meta tag needs, which a stylesheet cannot supply
 * to the head. Both come from docs/design/book-tokens.json.
 */
export function tokenFiles(): TokenFile[] {
  const tokens = readTokens();
  const themeColors = { light: tokens.color.light.values.background, dark: tokens.color.dark.values.background };
  return [
    { path: "src/styles/tokens.css", content: tokensCss(tokens) },
    { path: "src/landing/theme-colors.json", content: `${JSON.stringify(themeColors, null, 2)}\n` },
  ];
}
