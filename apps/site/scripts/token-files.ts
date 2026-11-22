// The files the site derives from the book's design tokens. The path below reaches into the manual because L12a has not
// yet exported its tokens module; L12a's `@buildanagent/manual` export replaces the relative import. The maintainability
// checks (check:deps, check:unused, check:duplicates) cover packages/ only, so none of them sees this import.
import { readTokens, tokensCss } from "../../manual/src/design/tokens.js";

/** The header the manual's generator writes, which names the manual's script and command. */
const MANUAL_HEADER = `/* Generated from docs/design/book-tokens.json by apps/manual/scripts/generate-tokens.ts. Do not edit: change the
   JSON file and run \`pnpm --filter @buildanagent/manual tokens\`. */`;

/** The same header naming the site's own script and command. */
const SITE_HEADER = `/* Generated from docs/design/book-tokens.json by apps/site/scripts/generate-tokens.ts. Do not edit: change the
   JSON file and run \`pnpm --filter @buildanagent/site tokens\`. */`;

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
  const css = tokensCss(tokens).replace(MANUAL_HEADER, SITE_HEADER);
  if (css === tokensCss(tokens)) throw new Error("the manual's tokens.css header changed: update MANUAL_HEADER");
  const themeColors = { light: tokens.color.light.values.background, dark: tokens.color.dark.values.background };
  return [
    { path: "src/styles/tokens.css", content: css },
    { path: "src/landing/theme-colors.json", content: `${JSON.stringify(themeColors, null, 2)}\n` },
  ];
}
