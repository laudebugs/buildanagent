import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// What the sticky header's files promise each other, read from the source: the phone query CSS and script share, the
// header heights, the empty settings slot and the offsets that keep other pieces clear of the header. The browser behaviour
// is checked by scripts/header-check.mjs.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const headerCss = strip(read("src/styles/header.css"));
const layoutCss = strip(read("src/styles/layout.css"));
const script = read("src/scripts/header.ts");
const component = read("src/components/SiteHeader.astro");

test("the script and the stylesheet name the same phone query", () => {
  const query = /const PHONE = "([^"]+)"/.exec(script)?.[1];
  assert.ok(query, "header.ts defines PHONE");
  const media = [...headerCss.matchAll(/@media \(max-width[^{]*\{/g)].map((m) => m[0].slice(7, -2));
  assert.ok(media.length >= 2, "the root height and the phone rules both use the query");
  for (const text of media) assert.equal(text, query);
});

test("the header is 56px on a desktop and 52px on a phone, and the page clears it", () => {
  assert.match(headerCss, /:root\s*\{\s*--header-height: 56px;/);
  assert.match(headerCss, /\(pointer: coarse\)\s*\{\s*:root\s*\{\s*--header-height: 52px;/);
  assert.match(headerCss, /html\s*\{\s*scroll-padding-top: calc\(var\(--header-height\) \+ 12px\);/);
  assert.match(headerCss, /\.site-header\s*\{[^}]*position: sticky;[^}]*top: 0;[^}]*height: var\(--header-height\);/);
});

test("only the sticky header's stylesheet uses a viewport-width query", () => {
  assert.doesNotMatch(layoutCss, /@media[^{]*width/);
  assert.doesNotMatch(strip(read("src/styles/components.css")), /@media[^{]*width/);
});

test("the chapter rails stick below the header", () => {
  const sticky = [...layoutCss.matchAll(/position: sticky;\s*top: ([^;]+);/g)].map((m) => m[1]);
  assert.equal(sticky.length, 2);
  for (const top of sticky) assert.equal(top, "calc(var(--header-height) + 1.5rem)");
});

test("the settings slot is an empty wrapper that is not drawn, and a named slot fills it", () => {
  assert.match(component, /<div class="site-header__slot" data-slot="settings"><slot name="settings" \/><\/div>/);
  assert.match(headerCss, /\.site-header__slot:empty\s*\{\s*display: none;/);
});

test("the menu button and the search button name what they control and start hidden", () => {
  for (const attribute of ["data-menu-button", "data-search-toggle"]) {
    const button = new RegExp(`<button[^>]*${attribute}[^>]*>`).exec(component)?.[0] ?? "";
    assert.match(button, /aria-expanded="false"/, attribute);
    assert.match(button, /aria-controls="site-(menu|header-search)"/, attribute);
    assert.match(button, /aria-label="[^"]+"/, attribute);
    assert.match(button, /\bhidden\b/, attribute);
  }
  assert.match(component, /<nav[^>]*id="site-menu"[^>]*hidden/);
  assert.match(component, /id="site-header-search"/);
});

test("the progress line is decoration: a transform on the accent colour, hidden in print", () => {
  const layout = read("src/layouts/ChapterLayout.astro");
  assert.match(layout, /class="reading-progress" aria-hidden="true" data-reading-progress/);
  assert.match(
    headerCss,
    /\.reading-progress__bar\s*\{[^}]*background-color: var\(--color-accent\);[^}]*transform: scaleX\(0\);[^}]*transform-origin: left;/,
  );
  assert.match(headerCss, /@media print\s*\{\s*\.reading-progress\s*\{\s*display: none;/);
  assert.doesNotMatch(headerCss, /\bwidth: \d+%/);
});

test("the header and the progress line loop no timer and ask for no network", () => {
  assert.doesNotMatch(script, /setInterval|setTimeout|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.match(script, /addEventListener\("scroll", schedule, \{ passive: true \}\)/);
});

test("a skip link shows above the header", () => {
  const base = strip(read("src/styles/base.css"));
  const z = (selector: string, css: string) =>
    Number(new RegExp(`${selector}\\s*\\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);
  assert.ok(z("\\.skip-link", base) > z("\\.site-header", headerCss));
  assert.ok(z("\\.reading-progress", headerCss) > z("\\.site-header", headerCss));
});
