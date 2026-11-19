import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";
import { drawFigure, FIGURE_ROOTS, figureScripts, staleFigures } from "../figures/lib/registry.js";
import { Figure, FigureError, missingGlyphs, num } from "../figures/lib/svgkit.js";
import { inlineSvg } from "../src/book/figures.js";

// The staleness test redraws every figure in memory and compares it with the committed SVG byte for byte, as the
// garment textbook's figure_staleness.py does; the unit tests check each rule the figure kit enforces.

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("the figure roots hold the book's sample and the fixture book's analogy illustration", () => {
  const ids = FIGURE_ROOTS.flatMap((root) => figureScripts(root).map((figure) => `${figure.chapter}/${figure.id}`));
  assert.deepEqual(ids, ["call-workflow-loop/who-decides", "first/ticket-rail"]);
});

for (const root of FIGURE_ROOTS) {
  test(`every committed figure under ${root.split("/apps/manual/")[1]} is what its script draws now`, async () => {
    assert.deepEqual(await staleFigures(root), []);
  });
}

test("changing a figure script without rerunning figures:build makes its SVG stale, naming the script", async () => {
  const root = mkdtempSync(join(tmpdir(), "figures-"));
  dirs.push(root);
  cpSync(FIGURE_ROOTS[1] ?? "", root, { recursive: true });
  const script = join(root, "first/ticket-rail.ts");
  const kit = join(FIGURE_ROOTS[0] ?? "", "lib/svgkit.ts");
  writeFileSync(
    script,
    readFileSync(script, "utf8")
      .replace(/from "[^"]*svgkit\.js"/, `from "${kit}"`)
      .replace('"the ticket rail"', '"the order rail"'),
  );
  const problems = await staleFigures(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /ticket-rail\.svg is stale: run pnpm --filter @buildanagent\/manual figures:build/);
  assert.match(problems[0] ?? "", /which redraws it from .*first\/ticket-rail\.ts$/);
});

test("an SVG without a script beside it is reported", async () => {
  const root = mkdtempSync(join(tmpdir(), "figures-"));
  dirs.push(root);
  cpSync(FIGURE_ROOTS[1] ?? "", root, { recursive: true });
  rmSync(join(root, "first/ticket-rail.ts"));
  assert.deepEqual(
    (await staleFigures(root)).map((problem) => problem.replace(/^.*first\//, "")),
    ["ticket-rail.svg has no script beside it; delete it or add ticket-rail.ts"],
  );
});

test("drawing the same figure twice writes the same bytes", async () => {
  const [figure] = figureScripts(FIGURE_ROOTS[0] ?? "");
  assert.ok(figure);
  assert.equal(await drawFigure(figure), await drawFigure(figure));
});

const figure = () => new Figure({ id: "sample", width: 200, height: 100 });

test("a label with a glyph outside the embedded font throws, naming the glyph", () => {
  assert.deepEqual(missingGlyphs("loop ↺ again"), ["↺"]);
  assert.throws(
    () => figure().text({ x: 100, y: 50 }, "loop ↺"),
    (error: unknown) =>
      error instanceof FigureError &&
      /label "loop ↺" uses "↺" \(U\+21BA\), which the embedded font lacks/.test(error.message),
  );
  // The arrows and box-drawing characters the subset keeps are allowed.
  assert.doesNotThrow(() => figure().text({ x: 100, y: 50 }, "call → tool"));
});

test("labels are measured in the embedded font, and one too wide for its box throws", () => {
  const f = figure();
  // The code font is monospaced at 0.6 em, and components.css sets labels at 12px.
  assert.equal(f.measure("model"), 36);
  assert.throws(
    () => f.box({ x: 10, y: 10, width: 60, height: 40 }, { label: "a long label" }),
    /label "a long label" is 86\.4 wide, but its box leaves 44; widen the box or shorten it/,
  );
});

test("a mark outside the canvas throws", () => {
  assert.throws(
    () => figure().box({ x: 150, y: 10, width: 60, height: 40 }),
    /a box at \(210, 50\) lies outside the 200×100 canvas/,
  );
  assert.throws(() => figure().text({ x: 2, y: 50 }, "edge"), /label "edge" at \(-12\.4, 40\.4\) lies outside/);
});

test("labels may not overlap each other or be crossed by a line", () => {
  const f = figure();
  f.text({ x: 100, y: 50 }, "model");
  assert.throws(() => f.text({ x: 104, y: 52 }, "tool"), /label "tool" overlaps label "model"/);
  assert.throws(
    () =>
      f.line([
        { x: 60, y: 46 },
        { x: 140, y: 46 },
      ]),
    /a line from \(60, 46\) crosses label "model"/,
  );
  const g = figure();
  g.curve({ x: 20, y: 90 }, { x: 100, y: 0 }, { x: 180, y: 90 });
  assert.throws(() => g.text({ x: 100, y: 50 }, "crossed"), /the curve from \(20, 90\) crosses label "crossed"/);
});

test("connect() draws an arrow between facing edges and refuses boxes that overlap or share no band", () => {
  const f = figure();
  const a = f.box({ x: 10, y: 10, width: 50, height: 40 });
  const b = f.box({ x: 120, y: 30, width: 50, height: 40 });
  f.connect(a, b);
  const svg = f.toSvg("figures/x/sample.ts");
  // The shaft runs along the middle of the shared band (y 30 to 50) and stops inside the head, whose tip is b's edge.
  assert.match(svg, /<path d="M60 40 L113\.37 40" class="fig-line"\/>/);
  assert.match(svg, /<path d="M120 40 L112\.63 36\.88 L112\.63 43\.12 Z" class="fig-head"\/>/);
  assert.throws(() => f.connect(a, { x: 40, y: 20, width: 50, height: 40 }), /they overlap/);
  assert.throws(() => f.connect(a, { x: 120, y: 55, width: 50, height: 40 }), /share a horizontal band/);
  assert.throws(() => f.arrow({ x: 10, y: 80 }, { x: 20, y: 80 }), /shorter than twice its head/);
});

test("ids start with the figure's id and appear once", () => {
  const f = figure();
  assert.equal(f.idFor("loop"), "sample--loop");
  assert.throws(() => f.idFor("loop"), /the id "sample--loop" is used twice/);
  assert.throws(() => f.idFor("Loop"), /id name "Loop" is not kebab-case/);
  assert.throws(() => new Figure({ id: "Sample", width: 10, height: 10 }), /figure id "Sample" is not kebab-case/);
});

test("numbers are written with at most two decimals and never as negative zero", () => {
  assert.deepEqual([num(1), num(1.006), num(2.5), num(-0.001), num(1 / 3)], ["1", "1.01", "2.5", "0", "0.33"]);
  assert.throws(() => num(Number.NaN), /a coordinate is NaN/);
});

test("a figure file embeds the code font and the panel tokens for both modes, colours only through classes", () => {
  const f = figure();
  f.group("parts", () => f.box({ x: 10, y: 10, width: 80, height: 40 }, { label: "a & b" }));
  const svg = f.toSvg("figures/x/sample.ts");
  assert.match(svg, /^<!-- Generated by figures\/x\/sample\.ts with apps\/manual\/figures\/lib\/svgkit\.ts\./);
  // XML forbids "--" inside a comment.
  assert.doesNotMatch(svg.split("\n")[0]?.slice(4, -3) ?? "", /--/);
  const woff2 = readFileSync(new URL("../public/fonts/manual-code/manual-code-roman.woff2", import.meta.url));
  assert.ok(svg.includes(`url(data:font/woff2;base64,${woff2.toString("base64")})`));
  assert.match(svg, /svg\{--font-code:"Manual Code"[^}]*--panel-text:#2a1e16/);
  assert.match(svg, /@media \(prefers-color-scheme:dark\)\{svg\{[^}]*--panel-text:#f2e8dc/);
  assert.match(svg, /\.fig-paper\{fill:var\(--panel-background\)/);
  assert.match(svg, /<g id="sample--parts">/);
  assert.match(svg, />a &amp; b<\/text>/);
  const drawing = svg.slice(svg.indexOf("</style>"));
  assert.doesNotMatch(drawing, /(fill|stroke|style)="/);
});

test("inlining drops the style, names the drawing and can prefix every id", () => {
  const f = figure();
  f.group("parts", () => f.text({ x: 100, y: 50 }, "model"));
  const svg = f.toSvg("figures/x/sample.ts");
  const inlined = inlineSvg(svg, { figureId: "sample", alt: 'A box, "model"' });
  assert.doesNotMatch(inlined, /<style|<!--|base64/);
  assert.match(inlined, /^<svg [^>]* data-figure="sample" role="img" aria-label="A box, &quot;model&quot;">/);
  assert.match(inlineSvg(svg, { figureId: "sample", alt: "x", idPrefix: "dark-" }), /<g id="dark-sample--parts">/);
  assert.throws(() => inlineSvg(svg, { figureId: "other", alt: "x" }), /drawn for figure "sample", not "other"/);
  assert.throws(
    () => inlineSvg(svg.replace('id="sample--parts"', 'id="parts"'), { figureId: "sample", alt: "x" }),
    /its id "parts" does not start with "sample--"/,
  );
  assert.throws(
    () => inlineSvg("<svg></svg>", { figureId: "sample", alt: "x" }),
    /not written by figures\/lib\/svgkit\.ts/,
  );
});

test("the fixture's figure scripts live where the registry expects them", () => {
  const [ticket] = figureScripts(FIGURE_ROOTS[1] ?? "");
  assert.equal(ticket?.source, "apps/manual/test/fixtures/book/figures/first/ticket-rail.ts");
  assert.equal(fileURLToPath(new URL("./fixtures/book/figures/first/ticket-rail.svg", import.meta.url)), ticket?.svg);
});
