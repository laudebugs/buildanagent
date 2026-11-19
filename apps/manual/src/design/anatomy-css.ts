import { readFileSync } from "node:fs";

// The anatomy skill's figure styles in the book's colours. The skill's kit/iso.css sets a grey palette on `.iso` and
// draws every part through `--anatomy-*` custom properties. This module keeps the kit's rules for the parts and maps
// each `--anatomy-*` colour to the book's panel tokens, once for each mode, so an isometric figure sits on the figure
// panel like a flat figure does: in light mode on the light panel (`panelLight`), in dark mode on C1 Ember
// (`panelDark`). Every colour is a panel or page token, or a `color-mix()` of two, so no hex value leaves tokens.css.

/** The vendored kit stylesheet, relative to this module. */
export const KIT_CSS_URL = new URL("../../../../.agents/skills/anatomy/kit/iso.css", import.meta.url);

/** Where the generated stylesheet lives, relative to this module. */
export const ANATOMY_CSS_URL = new URL("../styles/anatomy.css", import.meta.url);

const mix = (a: string, share: number, b: string): string => `color-mix(in srgb, var(${a}) ${share}%, var(${b}))`;
const PANEL = "--panel-background";
const PAGE = "--color-background";
const TEXT = "--panel-text";
const COMMENT = "--panel-comment";
const ACCENT = "--panel-terracotta";

/**
 * Each `--anatomy-*` colour the kit's rules read, in each mode. The kit's tone ladder keeps its order: `hi` is the
 * panel text and `mid` the panel comment colour, both AA on their panel, while `lo` and `faint` are mixes toward the
 * panel for textures that carry no meaning alone. The one lit part takes the panel's terracotta highlight, as the
 * kit's lit part takes white in dark and black in light. Faces and tops lighten toward the page colour in both modes,
 * because the page is lighter than the panel in light mode and lighter than Ember in dark mode; the side shades darken
 * toward the text in light mode and lighten toward the page in dark mode, as the kit's own two palettes do. The book
 * has no blue, so the kit's three channel colours take terracotta, olive and amber.
 */
export const ANATOMY_PALETTE: Readonly<Record<string, { readonly light: string; readonly dark: string }>> = {
  "--anatomy-text": { light: `var(${TEXT})`, dark: `var(${TEXT})` },
  "--anatomy-strong": { light: `var(${TEXT})`, dark: `var(${TEXT})` },
  "--anatomy-muted": { light: `var(${COMMENT})`, dark: `var(${COMMENT})` },
  "--anatomy-card": { light: "transparent", dark: "transparent" },
  "--anatomy-paper": { light: `var(${PANEL})`, dark: `var(${PANEL})` },
  "--anatomy-face": { light: `var(${PAGE})`, dark: mix(PANEL, 50, PAGE) },
  "--anatomy-top": { light: mix(PANEL, 40, PAGE), dark: mix(PANEL, 40, PAGE) },
  "--anatomy-shade-0": { light: mix(PANEL, 84, TEXT), dark: `var(${PANEL})` },
  "--anatomy-shade-1": { light: mix(PANEL, 89, TEXT), dark: mix(PANEL, 85, PAGE) },
  "--anatomy-shade-2": { light: mix(PANEL, 93, TEXT), dark: mix(PANEL, 72, PAGE) },
  "--anatomy-shade-3": { light: mix(PANEL, 97, TEXT), dark: mix(PANEL, 60, PAGE) },
  "--anatomy-lit-top": { light: `var(${PAGE})`, dark: mix(PAGE, 80, ACCENT) },
  "--anatomy-lit-shade": { light: mix(PANEL, 88, ACCENT), dark: mix(PANEL, 80, ACCENT) },
  "--anatomy-hi": { light: `var(${TEXT})`, dark: `var(${TEXT})` },
  "--anatomy-mid": { light: `var(${COMMENT})`, dark: `var(${COMMENT})` },
  "--anatomy-lo": { light: mix(COMMENT, 60, PANEL), dark: mix(COMMENT, 55, PANEL) },
  "--anatomy-faint": { light: mix(COMMENT, 35, PANEL), dark: mix(COMMENT, 30, PANEL) },
  "--anatomy-lit": { light: `var(${ACCENT})`, dark: `var(${ACCENT})` },
  "--anatomy-halo": { light: `var(${COMMENT})`, dark: `var(${PANEL})` },
  "--anatomy-halo-opacity": { light: ".3", dark: ".9" },
  "--anatomy-dot": { light: `var(${TEXT})`, dark: `var(${TEXT})` },
  "--anatomy-red": { light: `var(${ACCENT})`, dark: `var(${ACCENT})` },
  "--anatomy-green": { light: "var(--panel-olive)", dark: "var(--panel-olive)" },
  "--anatomy-blue": { light: "var(--panel-amber)", dark: "var(--panel-amber)" },
};

/** The kit's non-colour properties, the same in both modes: its line weight, its easing and the book's code face. */
const ANATOMY_CONSTANTS: Readonly<Record<string, string>> = {
  "--anatomy-weight": ".6px",
  "--anatomy-ease": "cubic-bezier(.32,.72,0,1)",
  "--anatomy-mono": "var(--font-code)",
};

/**
 * The kit rules the book leaves out: its two palettes (replaced by the mapping above), its own card, corners, legend
 * and swatches (the book's figure frame and caption replace them, styled in components.css), and its phone media
 * query, because the book's stage scrolls instead of reflowing the card.
 */
const DROPPED = [/^\.iso\{/, /^\.iso\[data-theme/, /^\.iso-(figure|plate|legend|keys?|swatch)/, /^@media \(max-width/];

/** The rules of the vendored kit stylesheet the book keeps: one rule per line, after its two palette blocks. */
export function kitRules(css: string = readFileSync(KIT_CSS_URL, "utf8")): string[] {
  const lines = css.split("\n");
  // The two palette blocks span several lines each; every other rule is one line.
  const rules: string[] = [];
  let depth = 0;
  let block = "";
  for (const line of lines) {
    block += block === "" ? line : `\n${line}`;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth > 0) continue;
    if (block.trim() !== "" && !DROPPED.some((pattern) => pattern.test(block.trim()))) rules.push(block.trim());
    block = "";
  }
  if (depth !== 0) throw new Error("the kit's iso.css has an unclosed rule");
  return rules;
}

function declarations(mode: "light" | "dark"): string {
  const palette = Object.entries(ANATOMY_PALETTE).map(([name, value]) => `  ${name}: ${value[mode]};`);
  return palette.join("\n");
}

/** The generated stylesheet: the palette for each mode under the same selectors tokens.css uses, then the kit rules. */
export function anatomyCss(css?: string): string {
  const constants = Object.entries(ANATOMY_CONSTANTS).map(([name, value]) => `  ${name}: ${value};`);
  return [
    "/* Generated from .agents/skills/anatomy/kit/iso.css by apps/manual/scripts/generate-anatomy-css.ts. Do not edit:",
    "   change the palette in src/design/anatomy-css.ts and run `pnpm --filter @buildanagent/manual anatomy:css`. The",
    "   kit rules below come from the anatomy skill, MIT, copyright 2026 Ryan (THIRD-PARTY-NOTICES.md). */",
    "",
    ":root {",
    ...constants,
    "}",
    "",
    ':root,\n[data-theme="light"] {',
    declarations("light"),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    declarations("dark").replace(/^ {2}/gm, "    "),
    "  }",
    "}",
    "",
    '[data-theme="dark"] {',
    declarations("dark"),
    "}",
    "",
    ...kitRules(css),
    "",
  ].join("\n");
}
