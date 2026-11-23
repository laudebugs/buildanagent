import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { CODE_STYLE_OVERRIDES } from "../src/design/theme.js";

// Rules every docs stylesheet and component keeps, read from the source: colours come only from the generated tokens,
// nothing loads from another origin, and the decorative tokens never colour text, focus rings or meaningful lines.
const src = new URL("../src/", import.meta.url);
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.(css|astro)$/.test(path) && path !== "styles/tokens.css")
  .map((path) => ({ path, text: readFileSync(new URL(path, src), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const DECORATIVE = /var\(--(color-rule|color-highlight(-blue|-green|-pink)?|panel-grid|panel-border)\)/;
const DECORATIVE_PROPERTIES = /^(border(-[a-z]+)*|background(-[a-z]+)*|column-rule(-color)?)$/;

function declarations(text: string): { property: string; value: string }[] {
  return [...text.matchAll(/(--[a-z0-9-]+|[a-z-]+)\s*:([^;{}]*)/g)].map((match) => ({
    property: match[1] ?? "",
    value: match[2] ?? "",
  }));
}

// Starlight's own stylesheets and components, which use the --sl-* variables the mapping sets.
// Its exported markdown.css sits in dist/style/, so dist/ is two folders up.
const starlightMarkdown = createRequire(import.meta.url).resolve("@astrojs/starlight/style/markdown.css");
const starlightRoot = join(dirname(starlightMarkdown), "..");
const starlight = readdirSync(starlightRoot, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.(css|astro)$/.test(path))
  .map((path) => readFileSync(join(starlightRoot, path), "utf8"))
  .join("\n");
// Starlight's search sets --pagefind-ui-* from its own variables, and only Pagefind's stylesheet paints them. It is
// resolved from Starlight's folder, the way Starlight's Search component imports it.
const pagefind = readFileSync(createRequire(starlightMarkdown).resolve("@pagefind/default-ui/css/ui.css"), "utf8");

/**
 * Whether a stylesheet paints a variable only as a border, a background or a box shadow. A use as another custom
 * property's value is followed to that property's own uses, so a chain counts by where it ends; a cycle, any other
 * use, or no use at all, which means the painting happens in a stylesheet the test does not read, makes the variable
 * more than decorative.
 */
function onlyDecorative(variable: string, css: string, path: readonly string[] = []): boolean {
  if (path.includes(variable)) return false;
  // Custom property names hold only letters, digits and hyphens, none of which a regular expression treats specially.
  const used = new RegExp(`var\\(\\s*${variable}\\s*[,)]`);
  const uses = declarations(css).filter(({ value }) => used.test(value));
  return (
    uses.length > 0 &&
    uses.every(({ property }) =>
      property.startsWith("--")
        ? onlyDecorative(property, css, [...path, variable])
        : DECORATIVE_PROPERTIES.test(property) || property === "box-shadow",
    )
  );
}

test("no docs stylesheet or component writes a hex colour; every colour comes from tokens.css", () => {
  assert.ok(files.some(({ path }) => path === "styles/starlight.css"));
  for (const { path, text } of files) assert.doesNotMatch(text, HEX, `${path} has a hex colour`);
  assert.doesNotMatch(JSON.stringify(CODE_STYLE_OVERRIDES), HEX, "the code panels' style overrides have a hex colour");
});

test("no docs stylesheet loads anything from another origin", () => {
  for (const { path, text } of files) {
    assert.doesNotMatch(text, /@import|url\(\s*["']?(https?:)?\/\//, `${path} loads from another origin`);
  }
});

test("the starlight mapping sets colours with var() only", () => {
  const css = files.find(({ path }) => path === "styles/starlight.css")?.text ?? "";
  for (const { property, value } of declarations(css)) {
    if (!property.startsWith("--sl-color")) continue;
    assert.match(value.trim(), /^var\(--(color|panel)-[a-z-]+\)$/, `${property} is ${value.trim()}`);
  }
});

// A Starlight variable that Starlight also uses for a meaningful mark, and the rule in starlight.css that repaints it.
const REPAINTED: Readonly<Record<string, RegExp>> = {
  // Printed, a file tree outlines its highlighted entry in the pale accent.
  "--sl-color-accent-low":
    /@media print\s*\{\s*starlight-file-tree \.highlight\s*\{\s*outline-color: var\(--color-accent\);/,
};

test("the rule, highlight, grid and border tokens appear only where nothing is read against them", () => {
  const mapping = files.find(({ path }) => path === "styles/starlight.css")?.text ?? "";
  for (const [variable, rule] of Object.entries(REPAINTED)) {
    assert.match(mapping, rule, `starlight.css repaints Starlight's meaningful use of ${variable}`);
  }
  // A custom property that names a decorative token is judged by where Starlight and the docs' own styles paint it.
  const everything = [starlight, pagefind, ...files.map(({ text }) => text)].join("\n");
  for (const { path, text } of files) {
    for (const { property, value } of declarations(text)) {
      if (!DECORATIVE.test(value)) continue;
      if (property.startsWith("--")) {
        assert.ok(
          property in REPAINTED || onlyDecorative(property, everything),
          `${path}: ${property} is drawn as more than a border or background`,
        );
      } else {
        assert.match(property, DECORATIVE_PROPERTIES, `${path}: ${property} uses a decorative-only token`);
      }
    }
  }
});

test("a decorative variable is followed through the custom properties that name it", () => {
  const border = "a { border-color: var(--sl-color-gray-5); background: var(--sl-color-gray-5, red); }";
  assert.ok(onlyDecorative("--sl-color-gray-5", border));
  const chained = ":root { --sl-color-foo: var(--sl-color-gray-5); } a { color: var(--sl-color-foo); }";
  assert.ok(!onlyDecorative("--sl-color-gray-5", chained), "a chain that ends in text colour is not decorative");
  const chainedBorder =
    ":root { --sl-color-foo: var(--sl-color-gray-5); } a { border-top: 1px solid var(--sl-color-foo); }";
  assert.ok(onlyDecorative("--sl-color-gray-5", chainedBorder), "a chain that ends in a border is decorative");
  const cycle = ":root { --a: var(--sl-color-gray-5); --b: var(--a); --a: var(--b); }";
  assert.ok(!onlyDecorative("--sl-color-gray-5", cycle), "a cycle is not decorative");
  assert.ok(!onlyDecorative("--sl-color-gray-5", "a { outline-color: var(--sl-color-gray-5); }"));
  assert.ok(!onlyDecorative("--sl-color-gray-5", "a { fill: var( --sl-color-gray-5 ); }"), "spacing inside var()");
  const longer = "a { border-color: var(--sl-color-gray-5); color: var(--sl-color-gray-50); }";
  assert.ok(onlyDecorative("--sl-color-gray-5", longer), "a longer name is another");
  assert.ok(!onlyDecorative("--sl-color-gray-5", "a { color: red; }"), "a variable nothing reads is not known");
  const unread = ":root { --pagefind-ui-tag: var(--sl-color-gray-5); }";
  assert.ok(!onlyDecorative("--sl-color-gray-5", unread), "a chain that ends where nothing reads it is not known");
});

test("headings use the display face at its one weight", () => {
  const css = files.find(({ path }) => path === "styles/starlight.css")?.text ?? "";
  assert.match(
    css,
    /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6,\s*\.site-title\s*\{\s*font-family: var\(--font-display\);\s*font-weight: 400;/,
  );
});

test("inline code inside a link keeps the link's colour", () => {
  const css = files.find(({ path }) => path === "styles/starlight.css")?.text ?? "";
  assert.match(css, /\.sl-markdown-content a code:not\(:where\(\.not-content \*\)\) \{\s*color: inherit;/);
});

test("the pagination links are compact: a rule border, no shadow, label and note sizes, a 44px tap height", () => {
  const css = files.find(({ path }) => path === "styles/starlight.css")?.text ?? "";
  const link = css.match(/\.pagination-links a \{([^}]*)\}/)?.[1] ?? "";
  assert.match(link, /box-shadow: none;/);
  assert.match(link, /border-color: var\(--color-rule\);/);
  assert.match(link, /font-size: var\(--size-label\);/);
  assert.match(link, /min-height: 2\.75rem;/);
  assert.match(css, /\.pagination-links \.link-title \{[^}]*font-size: var\(--size-note\);/);
});
