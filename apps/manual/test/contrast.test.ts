import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { contrastRatio, NON_TEXT_MINIMUM, roundRatio, TEXT_MINIMUM } from "../src/design/contrast.js";
import { COLOUR_SETS, type ColourSet, colourProperty, readTokens, TOKENS_CSS_URL } from "../src/design/tokens.js";

// The ratios are recomputed from the colours the generated CSS actually ships, not only from the JSON file, so a
// stale or hand-edited tokens.css cannot hide a failing pair.
const tokens = readTokens();
const css = readFileSync(TOKENS_CSS_URL, "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tokens.css has a ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z-]+): (#[0-9a-f]{6});/g)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

const shipped = {
  light: block(':root,\n[data-theme="light"]'),
  darkPreferred: block('  :root:not([data-theme="light"])'),
  dark: block('[data-theme="dark"]'),
};

function shippedColour(set: ColourSet, key: string): string {
  const mode = set === "light" || set === "panelLight" ? shipped.light : shipped.dark;
  const value = mode.get(colourProperty(set, key));
  assert.ok(value, `tokens.css sets ${colourProperty(set, key)} for ${set}`);
  assert.equal(value, tokens.color[set].values[key]?.toLowerCase(), `${set}.${key} in tokens.css matches the JSON`);
  return value;
}

function qualified(name: string): string {
  const [set, key] = name.split(".") as [ColourSet, string];
  assert.ok(COLOUR_SETS.includes(set), `${name} names a colour set`);
  return shippedColour(set, key);
}

test("the dark values under prefers-color-scheme and under [data-theme=dark] are the same", () => {
  assert.deepEqual(shipped.darkPreferred, shipped.dark);
});

test("every text pair on both pages and both panels meets WCAG AA and matches its recorded ratio", () => {
  let pairs = 0;
  for (const set of COLOUR_SETS) {
    for (const pair of tokens.color[set].contrast) {
      const ratio = contrastRatio(shippedColour(set, pair.text), shippedColour(set, pair.on));
      const name = `${set}: ${pair.text} on ${pair.on}`;
      assert.ok(ratio >= TEXT_MINIMUM, `${name} is ${ratio.toFixed(2)}:1, below ${TEXT_MINIMUM}:1`);
      assert.equal(
        roundRatio(ratio),
        pair.ratio,
        `${name} is ${roundRatio(ratio)}:1, but the JSON records ${pair.ratio}`,
      );
      pairs += 1;
    }
  }
  assert.equal(pairs, 20);
});

test("every text colour on a page or panel has a recorded pair against its background", () => {
  for (const set of COLOUR_SETS) {
    const measured = new Set(tokens.color[set].contrast.map((pair) => pair.text));
    const decorative = ["background", "rule", "grid", "border"];
    const text = Object.keys(tokens.color[set].values).filter((key) => !decorative.includes(key));
    assert.deepEqual(
      text.filter((key) => !measured.has(key)),
      [],
      `${set} has text colours with no contrast pair`,
    );
  }
});

test("focus rings reach 3:1 on the page and the panel in both modes, as recorded", () => {
  for (const pair of tokens.color.nonText.contrast) {
    const ratio = contrastRatio(qualified(pair.color), qualified(pair.on));
    const name = `${pair.color} on ${pair.on}`;
    assert.ok(ratio >= NON_TEXT_MINIMUM, `${name} is ${ratio.toFixed(2)}:1, below ${NON_TEXT_MINIMUM}:1`);
    assert.equal(
      roundRatio(ratio),
      pair.ratio,
      `${name} is ${roundRatio(ratio)}:1, but the JSON records ${pair.ratio}`,
    );
  }
});

test("the decorative colours match their recorded ratios and stay below 3:1", () => {
  for (const [name, recorded] of Object.entries(tokens.color.decorativeOnly)) {
    if (name.startsWith("$")) continue;
    const [colour, on] = name.split(" on ") as [string, string | undefined];
    const background = on ?? `${colour.split(".")[0]}.background`;
    const ratio = contrastRatio(qualified(colour), qualified(background));
    assert.equal(roundRatio(ratio), recorded, `${name} is ${roundRatio(ratio)}:1, but the JSON records ${recorded}`);
    assert.ok(ratio < NON_TEXT_MINIMUM, `${name} reaches 3:1, so it need not be decorative only`);
  }
});

test("the contrast formula gives WCAG's reference values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.equal(roundRatio(contrastRatio("#767676", "#ffffff")), 4.54);
});
