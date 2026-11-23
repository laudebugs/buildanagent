import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { contrastRatio, NON_TEXT_MINIMUM, TEXT_MINIMUM } from "@buildanagent/manual/design/contrast";
import { type ColorSet, colorProperty } from "@buildanagent/manual/design/tokens";
import { test } from "vitest";
import { STARLIGHT_PAIRS, type TokenName } from "../src/design/pairs.js";
import {
  CODE_SCOPES,
  CODE_STYLE_OVERRIDES,
  codeThemes,
  DOCS_TOKENS_CSS_URL,
  PRINT_SELECTOR,
} from "../src/design/theme.js";

// The ratios are computed from the colours the docs' tokens.css ships, so a stale or hand-edited file cannot hide a
// failing pair.
const css = readFileSync(DOCS_TOKENS_CSS_URL, "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tokens.css has a ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z-]+): (#[0-9a-f]{6});/g)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

const shipped = {
  light: block(':root,\n[data-theme="light"]'),
  dark: block('[data-theme="dark"]'),
  darkPreferred: block('  :root:not([data-theme="light"])'),
  print: block(`  ${PRINT_SELECTOR}`),
};
const MODES = ["light", "dark"] as const;
// Browsers leave out background colours when printing unless the reader asks for them, so printed text may sit on the
// paper itself.
const PAPER = "#ffffff";

function color(name: TokenName, mode: "light" | "dark"): string {
  const [where, key = ""] = name.split(".") as ["page" | "panel", string];
  const set: ColorSet = where === "page" ? mode : mode === "light" ? "panelLight" : "panelDark";
  const value = shipped[mode].get(colorProperty(set, key));
  assert.ok(value, `tokens.css sets ${colorProperty(set, key)} in ${mode} mode`);
  return value;
}

test("the dark values under prefers-color-scheme and under [data-theme=dark] are the same", () => {
  assert.deepEqual(shipped.darkPreferred, shipped.dark);
});

test("every pair Starlight's roles create reaches 4.5:1 for text and 3:1 otherwise, in light and dark", () => {
  assert.ok(STARLIGHT_PAIRS.length > 20);
  for (const pair of STARLIGHT_PAIRS) {
    const minimum = pair.kind === "text" ? TEXT_MINIMUM : NON_TEXT_MINIMUM;
    for (const mode of MODES) {
      const ratio = contrastRatio(color(pair.color, mode), color(pair.on, mode));
      assert.ok(
        ratio >= minimum,
        `${pair.role} (${mode}): ${pair.color} on ${pair.on} is ${ratio.toFixed(2)}:1, below ${minimum}:1`,
      );
    }
  }
});

test("each code theme takes its panel's colours, and every syntax colour reaches 4.5:1 on the panel", () => {
  const [dark, light] = codeThemes();
  for (const [mode, theme] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    assert.equal(theme.type, mode);
    const background = color("panel.background", mode);
    assert.equal(theme.colors["editor.background"], background);
    assert.equal(theme.colors["editor.foreground"], color("panel.text", mode));
    const painted = theme.tokenColors.map((entry) => entry.settings.foreground ?? "");
    const expected = ["text", ...Object.keys(CODE_SCOPES)].map((key) => color(`panel.${key}`, mode));
    assert.deepEqual(painted, expected);
    for (const foreground of painted) {
      const ratio = contrastRatio(foreground, background);
      assert.ok(ratio >= TEXT_MINIMUM, `${mode}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("Expressive Code keeps the measured syntax colours instead of shifting them", () => {
  const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
  assert.match(config, /minSyntaxHighlightingColorContrast: 0/);
});

test("printed, the page and the panel take the light colours, after every dark block", () => {
  assert.deepEqual(shipped.print, shipped.light);
  const print = css.indexOf(`@media print {\n  ${PRINT_SELECTOR} {\n    color-scheme: light;`);
  assert.ok(print > css.lastIndexOf('[data-theme="dark"] {'), "the print block comes after the dark blocks");
});

function printed(name: TokenName): string {
  const [where, key = ""] = name.split(".") as ["page" | "panel", string];
  const value = shipped.print.get(colorProperty(where === "page" ? "light" : "panelLight", key));
  assert.ok(value, `the print block sets ${name}`);
  return value;
}

test("printed text reaches 4.5:1 on its background and on bare paper", () => {
  const [, light] = codeThemes();
  const syntax = light.tokenColors.map((entry) => entry.settings.foreground ?? "");
  const pairs = STARLIGHT_PAIRS.filter((pair) => pair.kind === "text");
  const onPaper = pairs.filter((pair) => pair.on === "page.background" || pair.on === "panel.background");
  assert.ok(onPaper.length > 5);
  const checks: [string, string, string][] = [
    ...pairs.map((pair): [string, string, string] => [pair.role, printed(pair.color), printed(pair.on)]),
    ...onPaper.map((pair): [string, string, string] => [`${pair.role} on paper`, printed(pair.color), PAPER]),
    ...syntax.map((color): [string, string, string] => [`syntax ${color} on paper`, color, PAPER]),
  ];
  for (const [role, foreground, background] of checks) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= TEXT_MINIMUM, `${role}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
  }
});

// Starlight's print stylesheet and page frame, and the docs' own mapping. Starlight exports only markdown.css, which
// sits in dist/style/ beside print.css.
const starlightStyle = dirname(createRequire(import.meta.url).resolve("@astrojs/starlight/style/markdown.css"));
const starlightPrint = readFileSync(join(starlightStyle, "print.css"), "utf8");
const pageFrame = readFileSync(join(starlightStyle, "..", "components", "PageFrame.astro"), "utf8");
const mapping = readFileSync(new URL("../src/styles/starlight.css", import.meta.url), "utf8");

/**
 * How each piece of text drawn in a background colour prints. It sits on a fill that bare paper drops, so a print rule
 * must hide it or repaint it: `color` is the colour it then prints in, `"on"` meaning the fill's own colour, on no fill.
 * A rule without `color` hides it.
 */
const PRINTED_FILLS: Readonly<
  Record<string, { css: string; rule: RegExp; color?: TokenName | "on" } | { notPrinted: string }>
> = {
  "the sidebar's current page": { css: pageFrame, rule: /class="sidebar print:hidden"/ },
  "a primary link button": {
    css: starlightPrint,
    rule: /\.sl-link-button\.primary \{\s*background: transparent;\s*border-color: var\(--sl-color-white\);\s*color: var\(--sl-color-white\);/,
    color: "page.text",
  },
  "a banner on the accent": {
    css: starlightPrint,
    rule: /\.sl-banner \{\s*--sl-color-banner-text: var\(--sl-color-white\);\s*background-color: transparent;/,
    color: "page.text",
  },
  "selected text": { notPrinted: "browsers do not print a selection" },
  "the copy button's tooltip": { css: starlightPrint, rule: /\.expressive-code \.copy \{[^}]*display: none;/ },
  ...Object.fromEntries(
    ["marked", "inserted", "deleted"].map((marker) => [
      `a ${marker} line marker's label`,
      {
        css: mapping,
        rule: /@media print \{[^@]*\.expressive-code \.ec-line\.tm-label \.code::before \{\s*background: transparent;\s*color: var\(--ecLineBrdCol\);/,
        color: "on" as const,
      },
    ]),
  ),
};

test("printed, text drawn in a background colour is hidden or repainted, and reaches 4.5:1 on bare paper", () => {
  const fills = STARLIGHT_PAIRS.filter(
    (pair) => pair.kind === "text" && (pair.color === "page.background" || pair.color === "panel.background"),
  );
  assert.deepEqual(fills.map((pair) => pair.role).sort(), Object.keys(PRINTED_FILLS).sort());
  for (const pair of fills) {
    const fill = PRINTED_FILLS[pair.role];
    assert.ok(fill);
    if ("notPrinted" in fill) continue;
    assert.match(fill.css, fill.rule, `${pair.role}: a print rule hides or repaints it`);
    if (fill.color === undefined) continue;
    const foreground = printed(fill.color === "on" ? pair.on : fill.color);
    const ratio = contrastRatio(foreground, PAPER);
    assert.ok(ratio >= TEXT_MINIMUM, `${pair.role} printed: ${foreground} on paper is ${ratio.toFixed(2)}:1`);
  }
});

test("printed code takes the light theme's syntax colours, which Expressive Code numbers second", () => {
  const [dark, light] = codeThemes();
  assert.equal(dark.type, "dark");
  assert.equal(light.type, "light");
  assert.match(
    mapping,
    /@media print \{[^@]*\.expressive-code \.ec-line :where\(span\[style\^="--"\]:not\(\[class\]\)\) \{\s*color: var\(--1, inherit\);/,
  );
});

test("marked, inserted and deleted code use the measured panel colours", () => {
  const markers = CODE_STYLE_OVERRIDES.textMarkers;
  for (const [kind, edge] of [
    ["mark", "amber"],
    ["ins", "olive"],
    ["del", "terracotta"],
  ] as const) {
    assert.equal(markers[`${kind}Background`], "var(--panel-grid)");
    assert.equal(markers[`${kind}BorderColor`], `var(--panel-${edge})`);
    const pair = STARLIGHT_PAIRS.find((entry) => entry.color === `panel.${edge}` && entry.on === "panel.grid");
    assert.ok(pair, `pairs.ts measures ${edge} on the marker background`);
  }
  assert.equal(markers.insDiffIndicatorColor, "var(--panel-olive)");
  assert.equal(markers.delDiffIndicatorColor, "var(--panel-terracotta)");
  assert.equal(markers.lineMarkerLabelColor, "var(--panel-background)");
});
