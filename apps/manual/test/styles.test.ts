import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// Rules every stylesheet and component keeps, read from the source: colours come only from the generated tokens, and
// the decorative tokens never colour text, focus rings or lines that carry meaning.
const src = new URL("../src/", import.meta.url);
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.(css|astro)$/.test(path) && path !== "styles/tokens.css")
  .map((path) => ({ path, text: readFileSync(new URL(path, src), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

const DECORATIVE = /var\(--(color-rule|panel-grid|panel-border)\)/;
// Borders, backgrounds and column rules are the dividers, panel edges and grid lines the tokens may draw.
const DECORATIVE_PROPERTIES = /^(border(-[a-z]+)*|background(-[a-z]+)*|column-rule(-color)?)$/;

function declarations(text: string): { property: string; value: string }[] {
  return [...text.matchAll(/([a-z-]+)\s*:([^;{}]*)/g)].map((match) => ({
    property: match[1] ?? "",
    value: match[2] ?? "",
  }));
}

test("the rule, grid and border tokens appear only on borders and backgrounds", () => {
  assert.ok(files.length > 0);
  for (const { path, text } of files) {
    for (const { property, value } of declarations(text)) {
      if (!DECORATIVE.test(value)) continue;
      assert.match(property, DECORATIVE_PROPERTIES, `${path}: ${property} uses a decorative-only token`);
    }
  }
});

test("no stylesheet or component writes a hex colour; every colour comes from tokens.css", () => {
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /(?<![\w&])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/, `${path} has a hex colour`);
  }
});

test("no stylesheet loads anything from another origin", () => {
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /@import|url\(\s*["']?(https?:)?\/\//, `${path} loads from another origin`);
  }
});

// The gallery shows the chapter layout inside each theme's section, so the columns must follow the width of their
// container; a viewport media query would switch them on at widths the section does not have.
// Prose keeps the measure while listings, figures, tables, tabs and boxes take the whole column beside the sidebar.
test("prose keeps the measure and listings, figures, tables, tabs and boxes break out to the whole column", () => {
  const all = files
    .filter(({ path }) => path.endsWith(".css"))
    .map(({ text }) => text)
    .join("\n");
  assert.match(all, /\.article > \*\s*\{\s*max-width: var\(--measure\);/);
  assert.match(
    all,
    /\.article > :is\(figure, \.listing-replay, \.tabs, \.box\)\s*\{\s*max-width: none;\s*clear: right;/,
  );
});

test("the chapter layout switches its columns with container queries, not viewport media queries", () => {
  const css = files.filter(({ path }) => path.endsWith(".css"));
  const all = css.map(({ text }) => text).join("\n");
  assert.match(all, /\.layout\s*\{\s*container:\s*layout\s*\/\s*inline-size;/);
  for (const { path, text } of css) {
    assert.doesNotMatch(text, /@media[^{]*width/, `${path} switches on the viewport's width`);
  }
  assert.match(all, /@container layout \(min-width: 64rem\)\s*\{\s*\.chapter-body/);
  assert.match(all, /\.article\s*\{\s*container: article \/ inline-size;/);
  assert.match(all, /@container article \(min-width: 59\.5rem\)\s*\{\s*\.article \.sidenote/);
  assert.match(
    all,
    /@container layout \(min-width: 83rem\)\s*\{\s*\.chapter-body\s*\{\s*grid-template-columns: 11rem minmax\(0, 1fr\) 15rem;/,
  );
  assert.match(all, /@container listing-replay \(min-width: 52rem\)\s*\{\s*\.listing-replay > \*/);
});

// A run beside its listing is exactly as tall as the listing card: size containment keeps a long run from stretching
// the row, and the row's stretch gives the run the card's height, never less than 18rem. Under its listing the run has
// a fixed height, not a maximum, so revealing an event never moves the page below it. Printed, no height limit stays.
test("a run matches its listing's height side by side, keeps a fixed height stacked and drops both limits in print", () => {
  const css = readFileSync(new URL("styles/components.css", src), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string, from = 0): string => {
    const start = css.indexOf(`${selector} {`, from);
    assert.ok(start >= 0, `no rule for ${selector}`);
    return css.slice(start, css.indexOf("}", start));
  };
  const stacked = rule(".replay");
  assert.match(stacked, /block-size: min\(24rem, 70svh\);/);
  assert.doesNotMatch(stacked, /max-block-size/);

  const query = css.indexOf("@container listing-replay (min-width: 52rem)");
  assert.ok(query >= 0);
  const beside = rule(".listing-replay > .replay", query);
  assert.match(beside, /contain: size;/);
  assert.match(beside, /block-size: auto;/);
  assert.match(beside, /min-block-size: 18rem;/);

  const print = css.indexOf("@media print");
  assert.ok(print >= 0);
  const printed = rule(".listing-replay > .replay", print);
  assert.match(printed, /contain: none;/);
  assert.match(printed, /block-size: auto;/);
  assert.match(printed, /min-block-size: 0;/);
  assert.match(rule(".replay__scroll", print), /overflow: visible;/);
});

test("a table scrolls inside its own region, which shows a focus ring", () => {
  const css = readFileSync(new URL("styles/components.css", src), "utf8");
  assert.match(css, /\.table__scroll\s*\{\s*overflow-x: auto;/);
  assert.match(css, /\.table__scroll:focus-visible\s*\{\s*outline: 2px solid var\(--color-accent\);/);
});

test("a page with no chapter centres one column the width of the measure", () => {
  const css = readFileSync(new URL("styles/layout.css", src), "utf8");
  assert.match(css, /\.page--single\s*\{\s*max-width: calc\(var\(--measure\) \+ 2 \* var\(--gutter\)\);/);
  for (const page of ["index", "glossary", "sources", "search", "404"]) {
    const text = readFileSync(new URL(`pages/${page}.astro`, src), "utf8");
    assert.match(text, /<div class="page page--single">/, `${page}.astro`);
  }
});

// From 83rem "On this page" sits in a sticky rail of its own right of the article and "All chapters" keeps the left
// column. Breakouts stay inside the article's column, so they can never pass under the rail; printed, both go.
test("on a wide page the page's headings move to a sticky right rail, and print drops the navigation", () => {
  const css = readFileSync(new URL("styles/layout.css", src), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const wide = css.slice(css.indexOf("@container layout (min-width: 83rem)"), css.indexOf("@media print"));
  assert.match(wide, /\.chapter-body > \.sidebar\s*\{\s*display: contents;/);
  assert.match(
    wide,
    /\.chapter-body > \.sidebar > \.sidebar__section\s*\{\s*position: sticky;\s*top: 1\.5rem;\s*grid-row: 1;/,
  );
  assert.match(wide, /\.sidebar__chapters\s*\{\s*grid-column: 1;/);
  assert.match(wide, /\.sidebar__on-page\s*\{\s*grid-column: 3;/);
  assert.match(wide, /\.chapter-body > \.article\s*\{\s*grid-column: 2;\s*grid-row: 1;/);
  // No breakout spans past the article's column.
  assert.doesNotMatch(css, /grid-column: (2|1) \/ (-1|4)/);
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.chapter-body > \.sidebar\s*\{\s*display: none;/);
  assert.match(print, /\.chapter-body > \.article\s*\{\s*grid-column: 1;/);
});

// A chapter page is only as wide as the sidebar, the capped article, the rail and their gaps, and is centred like
// every page; the cap leaves room for the measure, a gap and a side note, so side notes still float beside the prose.
test("a chapter page caps its article at --article-max and is only as wide as its columns", () => {
  const css = readFileSync(new URL("styles/layout.css", src), "utf8");
  assert.match(
    css,
    /\.page\.layout\s*\{\s*max-width: calc\(11rem \+ var\(--article-max\) \+ 15rem \+ 2 \* 2\.5rem \+ 2 \* var\(--gutter\)\);/,
  );
  const tokens = readFileSync(new URL("styles/tokens.css", src), "utf8");
  assert.match(tokens, /--article-max: 59\.5rem;/);
  // 59.5rem is the measure, the 2.5rem gap and the side note, the width at which a side note floats.
  assert.match(tokens, /--measure: 42rem;/);
  assert.match(tokens, /--side-note-width: 15rem;/);
});

// The title runs to the article's right edge: the whole page width, less the "On this page" rail and its gap once the
// rail is there (from 83rem, where the grid gives it a column).
test("the chapter title stretches to where the article ends, with no character cap", () => {
  const layout = files.find(({ path }) => path === "styles/layout.css")?.text ?? "";
  assert.doesNotMatch(layout, /\.chapter-head__title\s*\{[^}]*max-width:\s*\d+ch/);
  assert.match(
    layout,
    /@container layout \(min-width: 83rem\)\s*\{\s*\.chapter-head__title\s*\{\s*max-width:\s*calc\(100% - 15rem - 2\.5rem\);/,
  );
  assert.match(
    layout,
    /@container layout \(min-width: 83rem\)\s*\{\s*\.chapter-body\s*\{\s*grid-template-columns:\s*11rem minmax\(0, 1fr\) 15rem;/,
  );
});
