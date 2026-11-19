// WCAG 2.x contrast, computed from sRGB hex colours (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio).

/** The minimum contrast for body text under WCAG 2.x level AA (success criterion 1.4.3). */
export const TEXT_MINIMUM = 4.5;

/** The minimum contrast for focus rings, control borders and meaningful figure lines (success criterion 1.4.11). */
export const NON_TEXT_MINIMUM = 3;

/** A `#rrggbb` colour, the only form the token file uses. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a `#rrggbb` colour, from 0 for black to 1 for white. */
export function relativeLuminance(hex: string): number {
  if (!HEX_COLOR.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** The contrast ratio of two `#rrggbb` colours, from 1 to 21; the order of the arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** A ratio rounded to two decimals, the precision `book-tokens.json` records. */
export function roundRatio(ratio: number): number {
  return Math.round(ratio * 100) / 100;
}
