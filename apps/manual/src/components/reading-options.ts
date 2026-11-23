// What the reading settings panel (ReadingSettings.astro) shows, worked out at build time from book-tokens.json: each
// typeface pairing with its faces, the font files it can use and their size, and each text-size step with its name.
// public/scripts/reading-panel.js reads these from the markup, so the names live here once.
import { statSync } from "node:fs";
import { join } from "node:path";
import { type BookTokens, pairingFace, pairingFiles } from "../design/tokens.js";

/** One typeface pairing as the panel lists it. */
export interface PairingOption {
  readonly id: string;
  readonly label: string;
  /** The heading face and the body face, as "Instrument Serif + Literata", or one name when both are the same face. */
  readonly faces: string;
  /** Every font file the pairing's text can use, which the offline worker saves when a reader picks the pairing. */
  readonly files: readonly string[];
  /** The files' total size in bytes, as the build serves them from `public/`. */
  readonly bytes: number;
  readonly isDefault: boolean;
}

/** One text-size step as the panel lists it. */
export interface SizeOption {
  readonly size: number;
  /** The step's name: Small, Default, Large, Larger or Largest. */
  readonly name: string;
  /** What the panel shows for the step, as "115% · Large". */
  readonly label: string;
  readonly isDefault: boolean;
}

/**
 * The names of the five size steps, from the smallest to the largest. The default step is called Default, because a
 * reader who comes back to it wants to know it is where they started; the others name the size it gives.
 */
export const SIZE_NAMES: Readonly<Record<number, string>> = Object.freeze({
  90: "Small",
  100: "Default",
  115: "Large",
  130: "Larger",
  150: "Largest",
});

/** What the panel shows for a size step, as "115% · Large". Throws for a step that has no name. */
export function sizeLabel(size: number): string {
  const name = SIZE_NAMES[size];
  if (name === undefined) throw new Error(`the text size ${size}% has no name in SIZE_NAMES`);
  return `${size}% · ${name}`;
}

/** The size steps of book-tokens.json, each with its name and label. */
export function sizeOptions(tokens: BookTokens): SizeOption[] {
  const reading = tokens.font.reading;
  return reading.sizes.map((size) => ({
    size,
    name: SIZE_NAMES[size] ?? sizeLabel(size),
    label: sizeLabel(size),
    isDefault: size === reading.defaultSize,
  }));
}

/** The pairings of book-tokens.json, with their files and the bytes those files take in `publicDir`. */
export function pairingOptions(tokens: BookTokens, publicDir: string): PairingOption[] {
  const reading = tokens.font.reading;
  return reading.pairings.map((pairing) => {
    const display = pairingFace(tokens, pairing.display).cssFamily;
    const body = pairingFace(tokens, pairing.body).cssFamily;
    const files = pairingFiles(tokens, pairing);
    return {
      id: pairing.id,
      label: pairing.label,
      faces: display === body ? display : `${display} + ${body}`,
      files,
      bytes: files.reduce((sum, src) => sum + statSync(join(publicDir, src)).size, 0),
      isDefault: pairing.id === reading.default,
    };
  });
}
