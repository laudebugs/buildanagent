import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { contrastRatio, NON_TEXT_MINIMUM, roundRatio, TEXT_MINIMUM } from "../src/design/contrast.js";
import { COLOR_SETS, type ColorSet, colorProperty, readTokens, TOKENS_CSS_URL } from "../src/design/tokens.js";

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

function shippedColor(set: ColorSet, key: string): string {
  const mode = set === "light" || set === "panelLight" ? shipped.light : shipped.dark;
  const value = mode.get(colorProperty(set, key));
  assert.ok(value, `tokens.css sets ${colorProperty(set, key)} for ${set}`);
  assert.equal(value, tokens.color[set].values[key]?.toLowerCase(), `${set}.${key} in tokens.css matches the JSON`);
  return value;
}

function qualified(name: string): string {
  const [set, key] = name.split(".") as [ColorSet, string];
  assert.ok(COLOR_SETS.includes(set), `${name} names a colour set`);
  return shippedColor(set, key);
}

test("the dark values under prefers-color-scheme and under [data-theme=dark] are the same", () => {
  assert.deepEqual(shipped.darkPreferred, shipped.dark);
});

test("every text pair on both pages and both panels meets WCAG AA and matches its recorded ratio", () => {
  let pairs = 0;
  for (const set of COLOR_SETS) {
    for (const pair of tokens.color[set].contrast) {
      const ratio = contrastRatio(shippedColor(set, pair.text), shippedColor(set, pair.on));
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
  assert.equal(pairs, 28);
});

// The keys the decorative list names (rule, grid, border) and the backgrounds are the only colours that carry no text.
const decorative = new Set([
  "background",
  ...tokens.color.decorativeOnly.contrast.map((pair) => pair.color.split(".")[1]),
]);

test("every text colour on a page or panel has a recorded pair against its background", () => {
  for (const set of COLOR_SETS) {
    const measured = new Set(tokens.color[set].contrast.map((pair) => pair.text));
    const text = Object.keys(tokens.color[set].values).filter((key) => !decorative.has(key));
    assert.deepEqual(
      text.filter((key) => !measured.has(key)),
      [],
      `${set} has text colours with no contrast pair`,
    );
  }
});

test("focus rings and the box's left rule reach 3:1 in both modes, as recorded", () => {
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
  assert.ok(tokens.color.decorativeOnly.contrast.length > 0);
  for (const pair of tokens.color.decorativeOnly.contrast) {
    const ratio = contrastRatio(qualified(pair.color), qualified(pair.on));
    const name = `${pair.color} on ${pair.on}`;
    assert.equal(
      roundRatio(ratio),
      pair.ratio,
      `${name} is ${roundRatio(ratio)}:1, but the JSON records ${pair.ratio}`,
    );
    assert.ok(ratio < NON_TEXT_MINIMUM, `${name} reaches 3:1, so it need not be decorative only`);
  }
});

test("the contrast formula gives WCAG's reference values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.equal(roundRatio(contrastRatio("#767676", "#ffffff")), 4.54);
});

// A box's only boundary must not be a decorative colour: its left rule takes a token whose pairs in nonText reach 3:1
// on the page in both modes (WCAG 1.4.11).
test("a box's left rule uses a colour recorded at 3:1 or more on the page in both modes", () => {
  const components = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const rule = /\n\.box \{([^}]*)\}/.exec(components)?.[1] ?? "";
  const token = /border-left:[^;]*var\(--color-([a-z-]+)\)/.exec(rule)?.[1];
  assert.ok(token, "the .box rule sets a border-left colour from a --color- token");
  const key = token.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  for (const mode of ["light", "dark"]) {
    const pair = tokens.color.nonText.contrast.find((found) => found.color === `${mode}.${key}`);
    assert.ok(pair, `nonText records ${mode}.${key}, the box's left rule`);
    assert.equal(pair.on, `${mode}.background`);
    assert.ok(contrastRatio(qualified(pair.color), qualified(pair.on)) >= NON_TEXT_MINIMUM);
  }
});

// A table's header rule separates the header from the body, so it takes a colour recorded at 3:1 or more on the page in
// both modes (WCAG 1.4.11), while the row lines use the divider colour, which the JSON records as decorative only. The
// patterns tolerate whitespace, so a reformat of the stylesheet does not fail the test.
test("a table's header rule uses a colour recorded at 3:1 or more, and its row lines the decorative divider", () => {
  const components = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const header = /\.table__scroll\s+thead\s+th\s*\{([^}]*)\}/.exec(components)?.[1];
  assert.ok(header, "components.css has a `.table__scroll thead th` rule");
  const headerBorder = /border-bottom:\s*(\d+)px\s+solid\s+var\(--color-([a-z-]+)\)/.exec(header);
  assert.ok(headerBorder, "the header rule sets a border-bottom width and a --color- token");
  const rows = /\.table__scroll\s+th,\s*\.table__scroll\s+td\s*\{([^}]*)\}/.exec(components)?.[1];
  assert.ok(rows, "components.css has a `.table__scroll th, .table__scroll td` rule");
  const rowBorder = /border-bottom:\s*(\d+)px\s+solid\s+var\(--color-rule\)/.exec(rows);
  assert.ok(rowBorder, "the row lines use the divider colour, --color-rule");
  assert.ok(Number(headerBorder[1]) > Number(rowBorder[1]), "the header rule is heavier than a row line");
  const key = (headerBorder[2] ?? "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  for (const mode of ["light", "dark"]) {
    const pair = tokens.color.nonText.contrast.find((found) => found.color === `${mode}.${key}`);
    assert.ok(pair, `nonText records ${mode}.${key}, the header rule`);
    assert.equal(pair.on, `${mode}.background`);
    assert.ok(contrastRatio(qualified(pair.color), qualified(pair.on)) >= NON_TEXT_MINIMUM);
    assert.ok(tokens.color.decorativeOnly.contrast.some((found) => found.color === `${mode}.rule`));
  }
});

// A reader's highlight (public/scripts/notes.js) is drawn over the page in one of four colours, so its text takes the
// text colour, recorded at 4.5:1 on every colour, and its underline and marker take the accent, recorded at 3:1 or more
// on every colour in both modes. A colour's own background is decorative, below 3:1 on the page, so the underline and the
// marker are what mark a highlight.
const HIGHLIGHT_KEYS = [
  ["amber", "highlight"],
  ["green", "highlightGreen"],
  ["blue", "highlightBlue"],
  ["pink", "highlightPink"],
] as const;

test("every highlight colour has its two names, its token, and its pairs recorded in both modes", () => {
  const components = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");
  for (const [color, key] of HIGHLIGHT_KEYS) {
    const property = colorProperty("light", key);
    const rule = new RegExp(
      `::highlight\\(manual-hl-${color}\\),\\s*::highlight\\(manual-note-${color}\\)\\s*\\{([^}]*)\\}`,
    ).exec(components)?.[1];
    assert.ok(rule, `components.css gives manual-hl-${color} and manual-note-${color} one rule`);
    assert.match(rule, new RegExp(`background-color:\\s*var\\(${property}\\);`));
    for (const mode of ["light", "dark"] as const) {
      const text = tokens.color[mode].contrast.find((pair) => pair.text === "text" && pair.on === key);
      assert.ok(text && text.ratio >= TEXT_MINIMUM, `${mode}: text on ${key} reaches 4.5:1`);
      const line = tokens.color.nonText.contrast.find(
        (pair) => pair.color === `${mode}.accent` && pair.on === `${mode}.${key}`,
      );
      assert.ok(line, `nonText records ${mode}.accent on ${mode}.${key}`);
      assert.ok(
        contrastRatio(qualified(line.color), qualified(line.on)) >= NON_TEXT_MINIMUM,
        `${mode}.${key} keeps the accent at 3:1`,
      );
      const page = tokens.color.decorativeOnly.contrast.find((pair) => pair.color === `${mode}.${key}`);
      assert.ok(page, `${mode}.${key} is recorded as decorative on the page`);
      assert.ok(
        contrastRatio(qualified(page.color), qualified(page.on)) < NON_TEXT_MINIMUM,
        `${mode}.${key} stays below 3:1 on the page`,
      );
    }
  }
});

test("a highlight draws text in the text colour and an accent underline, and a note's is dashed", () => {
  const components = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const names = [
    ...HIGHLIGHT_KEYS.map(([color]) => `manual-hl-${color}`),
    ...HIGHLIGHT_KEYS.map(([color]) => `manual-note-${color}`),
  ];
  const selector = names.map((name) => `::highlight\\(${name}\\)`).join(",\\s*");
  const rule = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(components)?.[1];
  assert.ok(rule, "components.css styles all eight highlight names together");
  assert.match(rule, /(?<![-\w])color:\s*var\(--color-text\);/);
  assert.match(rule, /text-decoration-line:\s*underline;/);
  assert.match(rule, /text-decoration-color:\s*var\(--color-accent\);/);
  const notedSelector = HIGHLIGHT_KEYS.map(([color]) => `::highlight\\(manual-note-${color}\\)`).join(",\\s*");
  const bodies = [...components.matchAll(new RegExp(`${notedSelector}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1] ?? "",
  );
  assert.ok(
    bodies.some((body) => /text-decoration-style:\s*dashed;/.test(body)),
    "the four noted names are dashed",
  );
  // A note's dot takes the text colour, so its number keeps the recorded text-on-highlight pairs, and its accent border
  // is what the recorded accent-on-page pair covers. Each colour's dot fills with that colour's token.
  assert.match(
    components,
    /\.notes-dot\s*\{[^}]*border:\s*1\.5px solid var\(--color-accent\);[^}]*color:\s*var\(--color-text\);/s,
  );
  for (const [color, token] of [
    ["green", "--color-highlight-green"],
    ["blue", "--color-highlight-blue"],
    ["pink", "--color-highlight-pink"],
  ] as const) {
    assert.match(
      components,
      new RegExp(`\\.notes-dot\\[data-color="${color}"\\]\\s*\\{[^}]*background-color:\\s*var\\(${token}\\);`, "s"),
    );
  }
  for (const mode of ["light", "dark"] as const) {
    const onPage = tokens.color[mode].contrast.find((pair) => pair.text === "accent" && pair.on === "background");
    assert.ok(onPage && onPage.ratio >= NON_TEXT_MINIMUM, `${mode}: the dot's accent border reaches 3:1 on the page`);
  }
});
