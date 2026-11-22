import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrastRatio, NON_TEXT_MINIMUM, TEXT_MINIMUM } from "@buildanagent/manual/design/contrast";
import { type ColorSet, colorProperty } from "@buildanagent/manual/design/tokens";
import { test } from "vitest";
import { STARLIGHT_PAIRS, type TokenName } from "../src/design/pairs.js";
import { CODE_SCOPES, codeThemes, DOCS_TOKENS_CSS_URL } from "../src/design/theme.js";

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
};
const MODES = ["light", "dark"] as const;

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
