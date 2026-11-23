import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toHtml } from "hast-util-to-html";
import { describe, test } from "vitest";
import { svgOf } from "../figures/registry.js";
import { figureSvg, UnsafeFigureError } from "../src/plugins/figure-svg.js";

// The sanitiser reads a committed figure SVG as untrusted markup. Each case below plants one construct the figure kit
// never writes in a real committed file, and the check must refuse it. Nothing is stripped: a refused file fails the
// build, so these cases prove the check fails closed.
const committed = readFileSync(svgOf("run-loop"), "utf8");
const options = { figureId: "run-loop", alt: "The loop" };

/** The committed file with `markup` added to the end of its drawing, inside the root `<svg>`. */
const withDrawing = (markup: string): string => committed.replace(/<\/svg>\n$/, `${markup}\n</svg>\n`);
/** The committed file with its first box's tag rewritten by `edit`. */
const withRect = (edit: (tag: string) => string): string => committed.replace(/<rect [^>]*\/>/, edit);

const refuses = (text: string, message: RegExp) =>
  assert.throws(
    () => figureSvg(text, options),
    (error: unknown) => {
      assert.ok(error instanceof UnsafeFigureError, `expected an UnsafeFigureError, got ${String(error)}`);
      assert.match(error.message, message);
      return true;
    },
  );

test("accepts each committed figure and keeps only the kit's drawing, named by the alt text", () => {
  const svg = figureSvg(committed, options);
  const html = toHtml(svg, { space: "svg" });
  assert.match(html, /^<svg viewBox="0 0 320 290" width="320" height="290" class="fig" data-figure="run-loop"/);
  assert.match(html, /role="img" aria-label="The loop"/);
  assert.doesNotMatch(html, /<style|@font-face|data:|<!--/, "the standalone style and the header never reach the page");
  assert.match(html, /<text x="[\d.]+" y="[\d.]+" text-anchor="middle" class="fig-text">model call<\/text>/);
  const map = readFileSync(svgOf("package-map"), "utf8");
  assert.doesNotThrow(() => figureSvg(map, { figureId: "package-map", alt: "x" }));
});

test("escapes the alt text and decodes the kit's entities in labels", () => {
  const svg = figureSvg(committed.replace(">done<", ">a &amp; b &lt;c&gt;<"), { ...options, alt: 'a "b" <c>' });
  const html = toHtml(svg, { space: "svg" });
  assert.match(html, /aria-label="a &#x22;b&#x22; <c>"/);
  assert.match(html, />a &#x26; b &#x3C;c></);
});

describe("refuses script and event handlers", () => {
  test("a <script> element", () => refuses(withDrawing("<script>alert(1)</script>"), /<script> element/));
  test("an upper-case <SCRIPT>", () => refuses(withDrawing("<SCRIPT>alert(1)</SCRIPT>"), /not an element the kit/));
  test("a namespaced <svg:script>", () => refuses(withDrawing("<svg:script>x</svg:script>"), /not an element/));
  test("an onload handler on a box", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect onload="alert(1)" ')),
      /onload attribute/,
    ));
  test("an onclick handler on the root", () =>
    refuses(committed.replace('class="fig"', 'class="fig" onclick="alert(1)"'), /<svg> tag is not the one/));
  test("a handler with upper-case letters", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect onMouseOver="x" ')),
      /which the kit never writes/,
    ));
});

describe("refuses links and outside references", () => {
  test("an <a> with an outside href", () =>
    refuses(withDrawing('<a href="https://example.com/">x</a>'), /<a> element/));
  test("a javascript: href on an allowed element", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect href="javascript:alert(1)" ')),
      /href attribute/,
    ));
  test("an xlink:href", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect xlink:href="https://example.com/x.svg#a" ')),
      /xlink/,
    ));
  test("a <use> of another file", () => refuses(withDrawing('<use href="other.svg#part"/>'), /<use> element/));
  test("an <image>", () => refuses(withDrawing('<image href="https://example.com/x.png"/>'), /<image> element/));
  test("a data: URI", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect filter="url(data:image/svg+xml,x)" ')),
      /filter/,
    ));
  test("a url() in a class", () =>
    refuses(
      withRect((tag) => tag.replace('class="fig-paper', 'class="url(https://x) fig-paper')),
      /class/,
    ));
  test("a <foreignObject>", () =>
    refuses(withDrawing("<foreignObject><div>x</div></foreignObject>"), /<foreignObject>/));
});

describe("refuses style and colour of its own", () => {
  test("a <style> in the drawing", () => refuses(withDrawing("<style>rect{fill:red}</style>"), /<style> element/));
  test("a <style> that imports", () =>
    refuses(withDrawing('<style>@import url("https://example.com/x.css");</style>'), /<style> element/));
  test("markup hidden in the standalone style", () =>
    refuses(committed.replace("\n</style>", "</style><script>alert(1)</script><style>\n</style>"), /svgkit/));
  test("a style attribute", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect style="background:url(https://x)" ')),
      /style attribute/,
    ));
  test("a fill attribute", () =>
    refuses(
      withRect((tag) => tag.replace("<rect ", '<rect fill="#ff0000" ')),
      /fill/,
    ));
  test("a class figures.css does not define", () =>
    refuses(
      withRect((tag) => tag.replace('class="fig-paper', 'class="evil fig-paper')),
      /class "evil"/,
    ));
});

describe("refuses markup the kit never writes", () => {
  test("a comment", () => refuses(withDrawing("<!-- x -->"), /not an element the kit/));
  test("a CDATA section", () => refuses(withDrawing("<![CDATA[x]]>"), /not an element the kit/));
  test("a processing instruction", () => refuses(withDrawing('<?xml-stylesheet href="x.css"?>'), /not an element/));
  test("a doctype with an entity", () =>
    refuses(`<!DOCTYPE svg [<!ENTITY x "y">]>\n${committed}`, /not a file that figures:build wrote/));
  test("an entity the kit never writes", () => refuses(committed.replace(">done<", ">&x;<"), /&x;/));
  test("a numeric character reference", () => refuses(committed.replace(">done<", ">&#60;<"), /&#60;/));
  test("a bare &", () => refuses(committed.replace(">done<", ">a & b<"), /entity the kit never writes/));
  test("an attribute in single quotes", () =>
    refuses(
      withRect((tag) => tag.replace(/rx="4"/, "rx='4'")),
      /holds/,
    ));
  test("an attribute written twice", () =>
    refuses(
      withRect((tag) => tag.replace('rx="4"', 'rx="4" rx="5"')),
      /twice/,
    ));
  test("path data with anything but numbers and the kit's commands", () =>
    refuses(committed.replace(/d="M/, 'd="javascript:M'), /d="javascript/));
  test("a <tspan> inside a label", () =>
    refuses(committed.replace(">done<", "><tspan>done</tspan><"), /<tspan> element/));
  test("text outside a <text>", () => refuses(withDrawing("loose text"), /text outside a <text>/));
  test("a group left open", () => refuses(withDrawing('<g id="run-loop--part">'), /never closed/));
  test("a box left open", () =>
    refuses(
      withRect((tag) => tag.replace("/>", ">")),
      /left open/,
    ));
  test("an id without the figure's prefix", () => refuses(withDrawing('<g id="other"></g>'), /does not start with/));
  test("a file drawn for another figure", () =>
    refuses(committed.replace('data-figure="run-loop"', 'data-figure="package-map"'), /drawn for figure/));
  test("a header that names another script", () =>
    refuses(committed.replace("figures/run-loop.ts", "figures/package-map.ts"), /header names/));
  test("a file svgkit did not write", () => refuses('<svg xmlns="http://www.w3.org/2000/svg"></svg>', /svgkit/));
  // XML forbids "--" inside a comment, so a header with one is not well-formed and an XML parser refuses the file.
  test("a header that holds --", () =>
    refuses(
      committed.replace(
        "run the figures:build script of @buildanagent/docs",
        "run pnpm --filter @buildanagent/docs figures:build",
      ),
      /not a file that figures:build wrote/,
    ));
  test("a figure id that holds --", () =>
    refuses(committed.replaceAll("run-loop", "run--loop"), /not a file that figures:build wrote/));
});
