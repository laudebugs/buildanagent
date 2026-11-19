import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { audit, IsoFigure, IsoParts, kit } from "../figures/lib/isokit.js";
import { FigureError } from "../figures/lib/svgkit.js";
import { inlineFragment } from "../src/book/figures.js";
import { loadBook } from "../src/book/load.js";
import { ANATOMY_CSS_URL, ANATOMY_PALETTE, anatomyCss, kitRules } from "../src/design/anatomy-css.js";
import { FIXTURE_DIR, fixtureInputs, renderLikeAstro } from "./book-fixture.js";

// Isometric figures (BK10, BK11): the fragment allowlist, id prefixing, the palette the book maps onto the anatomy
// kit, the IsoFigure rules and the fixture's two samples as a chapter renders them. figures:audit, which needs
// headless Chrome, proves the samples' geometry and line ends; it runs in the book's CI job, not here.

const SAMPLE = fileURLToPath(new URL("./fixtures/book/figures/first/loop-bench.html", import.meta.url));
const sample = () => readFileSync(SAMPLE, "utf8");

/** A small figure drawn with the kit: one slab on the ground, with `extra` markup slipped into its drawing. */
function tiny(id = "tiny", extra = ""): string {
  const P = kit.fitProjection(
    [
      [0, 0, 0],
      [40, 40, 10],
    ],
    120,
    80,
  );
  const R = audit.recorder(P);
  new IsoParts(P, R).slab("stand.block", { x: 0, y: 0, w: 40, d: 40, r: 2 }, 0, 10, {
    marks: kit.groupSvg([extra], { id: `${id}--part` }),
  });
  const figure = new IsoFigure({
    id,
    width: 120,
    height: 80,
    title: "Tiny",
    hint: "Look",
    readout: "1",
    projection: P,
    recorder: R,
  });
  return figure.fragment(`apps/manual/figures/x/${id}.ts`);
}

test("a fragment inlines as a div that the chapter's figure holds, its drawing hidden and its corner numbered", () => {
  const html = inlineFragment(sample(), { figureId: "loop-bench", number: "Figure 1.4" });
  assert.match(html, /^<div class="iso-figure" data-figure="loop-bench"><div class="iso-plate">/);
  assert.match(html, /<span class="iso-plate-corner" data-corner="fig">Figure 1\.4<\/span>/);
  assert.match(
    html,
    /<svg width="480" height="260" xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="iso-svg" viewBox="0 0 480 260" aria-hidden="true">/,
  );
  assert.match(html, /<\/svg><\/div><\/div>$/);
  assert.doesNotMatch(html, /<figure|<!--|role=|aria-label=|style=/);
  // The first step's part is lit in the static markup, so the page is complete before any script runs.
  assert.match(html, /data-iso-step="0" data-iso-readout="step 1 of 3 · context"><g class="iso-solid" data-lit="">/);
});

test("two fragments on one page share no id once each takes its own prefix", () => {
  const fragment = tiny();
  const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  const one = inlineFragment(fragment, { figureId: "tiny", idPrefix: "a-" });
  const two = inlineFragment(fragment, { figureId: "tiny", idPrefix: "b-" });
  assert.deepEqual(ids(one), ["a-tiny--part"]);
  assert.deepEqual(ids(two), ["b-tiny--part"]);
  assert.throws(
    () => inlineFragment(fragment.replace('id="tiny--part"', 'id="part"'), { figureId: "tiny" }),
    /its id "part" does not start with "tiny--"/,
  );
});

test("a fragment drawn for another figure, or not by isokit, is refused", () => {
  assert.throws(() => inlineFragment(tiny(), { figureId: "other" }), /drawn for figure "tiny", not "other"/);
  assert.throws(
    () => inlineFragment('<figure class="iso-figure"></figure>\n', { figureId: "tiny" }),
    /not written by figures\/lib\/isokit\.ts/,
  );
});

test("a step's readout may name an API term with an underscore, such as tool_result", () => {
  const readout = "4/6 · tool_result: 21C";
  const html = inlineFragment(tiny("tiny", `<g data-iso-readout="${readout}"></g>`), { figureId: "tiny" });
  assert.match(html, /data-iso-readout="4\/6 · tool_result: 21C"/);
});

test("the fragment allowlist refuses anything the kit does not write", () => {
  const inline = (extra: string) => inlineFragment(tiny("tiny", extra), { figureId: "tiny" });
  const cases: [string, RegExp][] = [
    ['<script>alert("x")</script>', /a <script> element, which the fragment allowlist does not take/],
    ["<style>path{fill:red}</style>", /a <style> element/],
    ['<foreignObject width="1" height="1"></foreignObject>', /a <foreignObject> element/],
    ['<image href="https://example.com/x.png"/>', /an? <image> element/],
    ['<iframe src="https://example.com/"></iframe>', /an? <iframe> element/],
    ['<a href="https://example.com/"><path d="M0 0"/></a>', /an? <a> element/],
    ['<use href="#tiny--part"/>', /an? <use> element/],
    ['<path d="M0 0" onclick="alert(1)"/>', /its <path> has an event handler, onclick/],
    [
      '<path d="M0 0" style="fill:red"/>',
      /its <path> has a style attribute, which the fragment allowlist does not take/,
    ],
    ['<path d="M0 0" href="#tiny--part"/>', /its <path> has a href attribute/],
    ['<path d="M0 0" fill="url(https://example.com/#x)"/>', /its <path> has a fill attribute/],
    ['<g transform="url(#x)"></g>', /its <g> has transform="url\(#x\)", which is not a value the kit writes/],
    ['<path d="M0 0 url(x)"/>', /its <path> has d="M0 0 url\(x\)"/],
    ['<circle cx="1" cy="1" r="calc(1px)"/>', /its <circle> has r="calc\(1px\)"/],
    ["<!-- a comment -->", /not an element the kit writes/],
    ["<![CDATA[x]]>", /not an element the kit writes/],
    ["<text>&nbsp;</text>", /an entity the kit never writes/],
    ['<svg viewBox="0 0 1 1"></svg>', /more than one <svg>/],
    ["<div></div>", /a <div> inside its <svg>/],
    ["<g>", /closes no open element|is never closed/],
    // Values: an entity in an attribute, and data-* attributes outside the closed set iso-figures.ts and the kit use.
    ['<path d="M0 0" class="iso-line&#x20;x"/>', /its <path>'s class holds an entity the kit never writes/],
    ['<g data-iso-readout="&lt;b&gt;"></g>', /data-iso-readout="&lt;b&gt;", which is not a value the kit writes/],
    ['<g data-iso-step="javascript:alert(1)"></g>', /data-iso-step="javascript:alert\(1\)"/],
    ['<g data-tone="javascript:x"></g>', /data-tone="javascript:x", which is not a value the kit writes/],
    ['<g data-href="https://example.com/"></g>', /its <g> has a data-href attribute, which the fragment allowlist/],
    ["<g>stray words</g>", /text in its drawing outside a <text> element/],
    ['<path d="M0 0"><g></g></path>', /its <path> holds a <g>/],
  ];
  for (const [extra, message] of cases) assert.throws(() => inline(extra), message, extra);
  assert.throws(
    () =>
      inlineFragment(tiny().replace('<svg width="120"', '<svg onload="alert(1)" width="120"'), { figureId: "tiny" }),
    /its <svg> has an event handler, onload/,
  );
  // HTML ignores "/>" on a div or span, so a self-closing tag outside the drawing would swallow what follows it.
  assert.throws(
    () =>
      inlineFragment(tiny().replace('<div class="iso-plate">', '<div class="iso-plate"><span/>'), { figureId: "tiny" }),
    /its <span\/> closes itself outside the <svg>/,
  );
  assert.throws(
    () =>
      inlineFragment(tiny().replace('class="iso-plate"', 'class="iso-plate" style="color:red"'), { figureId: "tiny" }),
    /its <div> has a style attribute/,
  );
  assert.throws(
    () =>
      inlineFragment(
        tiny().replace(
          '<figure class="iso-figure">',
          '<figure class="iso-figure"><span>x</span></figure><figure class="iso-figure">',
        ),
        {
          figureId: "tiny",
        },
      ),
    /a second <figure>|outside its <figure/,
  );
});

test("an isometric figure keeps the flat figures' width limit, label size and glyph rule", () => {
  const P = kit.fitProjection([[0, 0, 0]], 100, 100);
  const options = { title: "T", hint: "H", readout: "R", projection: P, recorder: audit.recorder(P) };
  assert.throws(
    () => new IsoFigure({ id: "wide", width: 521, height: 10, ...options }),
    /no figure may be wider than 520/,
  );
  assert.throws(() => new IsoFigure({ id: "Wide", width: 10, height: 10, ...options }), /not kebab-case/);
  assert.throws(
    () => new IsoParts(P, audit.recorder(P)).label("tool", [0, 0], 0, 10),
    (error: unknown) =>
      error instanceof FigureError && /label "tool" is 10px; a figure label is at least 12px/.test(error.message),
  );
  const glyph = new IsoFigure({ id: "glyph", width: 10, height: 10, ...options, readout: "loop ↺" });
  assert.throws(() => glyph.fragment("x.ts"), /"loop ↺" uses ↺, which the code font lacks/);
});

test("the geometry audit counts a part that floats above the ground", () => {
  const P = kit.fitProjection(
    [
      [0, 0, 0],
      [40, 40, 20],
    ],
    120,
    80,
  );
  const R = audit.recorder(P);
  const parts = new IsoParts(P, R);
  parts.slab("stand.block", { x: 0, y: 0, w: 40, d: 40, r: 2 }, 0, 10);
  parts.slab("floating", { x: 10, y: 10, w: 10, d: 10, r: 1 }, 14, 4);
  const figure = new IsoFigure({
    id: "float",
    width: 120,
    height: 80,
    title: "T",
    hint: "H",
    readout: "R",
    projection: P,
    recorder: R,
  });
  const exitCode = process.exitCode;
  assert.equal(figure.audit(), 1);
  assert.equal(process.exitCode, exitCode, "the audit leaves the process's exit code to its caller");
});

test("the committed anatomy.css is what the generator writes from the vendored kit", () => {
  assert.equal(
    readFileSync(ANATOMY_CSS_URL, "utf8"),
    anatomyCss(),
    "src/styles/anatomy.css is stale: run pnpm --filter @buildanagent/manual anatomy:css",
  );
});

test("the book maps every anatomy colour the kit's rules read to its panel tokens, in both modes", () => {
  const rules = kitRules().join("\n");
  const read = new Set([...rules.matchAll(/var\((--anatomy-[a-z0-9-]+)/g)].map((match) => match[1]));
  for (const name of read) {
    if (["--anatomy-weight", "--anatomy-ease", "--anatomy-mono"].includes(name ?? "")) continue;
    assert.ok(name && name in ANATOMY_PALETTE, `${name} has a book colour`);
  }
  for (const [name, { light, dark }] of Object.entries(ANATOMY_PALETTE)) {
    for (const value of [light, dark]) {
      assert.match(value, /^(var\(--(panel|color)-[a-z-]+\)|color-mix\(.*\)|transparent|\.\d+)$/, `${name}: ${value}`);
      assert.doesNotMatch(value, /--(panel-grid|panel-border|color-rule)/, `${name} uses a decorative token`);
    }
  }
  // The kit's own grey palettes, its card and its phone media query stay out of the book.
  assert.doesNotMatch(rules, /^\.iso\{|^\.iso-plate|@media \(max-width/m);
  const css = anatomyCss();
  assert.match(css, /:root,\n\[data-theme="light"\] \{\n {2}--anatomy-text: var\(--panel-text\);/);
  assert.match(css, /\[data-theme="dark"\] \{\n[^}]*--anatomy-paper: var\(--panel-background\);/);
});

test("a chapter inlines both isometric samples, alt text first, and the analogy passes the register", async () => {
  const book = loadBook(fixtureInputs(FIXTURE_DIR));
  const html = await renderLikeAstro(book, "first");
  assert.match(
    html,
    /<figure id="fig-tally-counter" class="numbered figure"[^>]*data-analogy="tally-counter"><div class="panel figure__panel"><div class="figure__stage figure__stage--scroll panel--grid" tabindex="0" role="group" aria-labelledby="fig-tally-counter--caption"><p class="visually-hidden">A hand tally counter on a small bench\./,
  );
  assert.match(
    html,
    /<span class="iso-plate-corner" data-corner="fig">Figure 1\.2<\/span><span class="iso-plate-corner" data-corner="title">Tally counter/,
  );
  assert.match(
    html,
    /<p id="fig-tally-counter--breaks" class="figure__breaks"><span class="label">Where it breaks<\/span> A tally counter only counts/,
  );
  assert.match(html, /<div class="iso-figure" data-figure="loop-bench">/);
  assert.match(html, /<p class="figure__scroll-hint">Scroll sideways to see the whole figure →<\/p>/);
});
