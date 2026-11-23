// The files the site derives from the book's design tokens, through the manual's `design/tokens` export.
import { readTokens, tokensCss } from "@buildanagent/manual/design/tokens";

/** The header comment's lines, naming the site's own script and command. */
const SITE_HEADER = [
  "Generated from docs/design/book-tokens.json by apps/site/scripts/generate-tokens.ts. Do not edit: change the",
  "JSON file and run `pnpm --filter @buildanagent/site tokens`.",
];

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
  const css = tokensCss(tokens, { header: SITE_HEADER, fontBase: "/fonts/" });
  const themeColors = { light: tokens.color.light.values.background, dark: tokens.color.dark.values.background };
  return [
    { path: "src/styles/tokens.css", content: css },
    { path: "src/landing/theme-colors.json", content: `${JSON.stringify(themeColors, null, 2)}\n` },
  ];
}
