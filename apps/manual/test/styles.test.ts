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
// Prose keeps the measure while listings, figures, tables and tabs take the whole column beside the sidebar.
test("prose keeps the measure and listings, figures, tables and tabs break out to the whole column", () => {
  const all = files
    .filter(({ path }) => path.endsWith(".css"))
    .map(({ text }) => text)
    .join("\n");
  assert.match(all, /\.article > \*\s*\{\s*max-width: var\(--measure\);/);
  assert.match(all, /\.article > :is\(figure, \.listing-replay, \.tabs\)\s*\{\s*max-width: none;\s*clear: right;/);
});

test("the chapter layout switches its columns with container queries, not viewport media queries", () => {
  const css = files.filter(({ path }) => path.endsWith(".css"));
  const all = css.map(({ text }) => text).join("\n");
  assert.match(all, /\.layout\s*\{\s*container:\s*layout\s*\/\s*inline-size;/);
  for (const { path, text } of css) {
    assert.doesNotMatch(text, /@media[^{]*width/, `${path} switches on the viewport's width`);
  }
  assert.match(all, /@container layout \(min-width: 64rem\)\s*\{\s*\.chapter-body/);
  assert.match(all, /@container layout \(min-width: 73rem\)\s*\{\s*\.article \.sidenote/);
  assert.match(all, /@container listing-replay \(min-width: 52rem\)\s*\{\s*\.listing-replay > \*/);
});
