import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";
import { BOOK_FIGURES, drawFigure, figureScripts, staleFigures } from "../figures/lib/registry.js";
import { Figure, FigureError, MAX_FIGURE_WIDTH, missingGlyphs, num } from "../figures/lib/svgkit.js";
import { inlineSvg } from "../src/book/figures.js";
import { readTokens } from "../src/design/tokens.js";

// The staleness test redraws every figure in memory and compares it with the committed SVG byte for byte, as the
// garment textbook's figure_staleness.py does; the unit tests check each rule the figure kit enforces.

const app = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_FIGURES = fileURLToPath(new URL("./fixtures/book/figures/", import.meta.url));
const SITE_FIGURES = fileURLToPath(new URL("./fixtures/site/figures/", import.meta.url));
// The folders the package's figures:build script names: the book's own and the two fixture books'.
const ROOTS = [BOOK_FIGURES, FIXTURE_FIGURES, SITE_FIGURES];

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("the book's figures hold its chapters' figures, and the fixtures hold their own, isometric ones too", () => {
  const ids = (root: string) => figureScripts(root).map((figure) => `${figure.chapter}/${figure.id}`);
  assert.deepEqual(ids(BOOK_FIGURES), [
    "approvals-guardrails-and-injection/paused-run",
    "approvals-guardrails-and-injection/second-signature",
    "call-workflow-loop/loop-bench",
    "call-workflow-loop/ticket-rail",
    "call-workflow-loop/who-decides",
    "events-and-hooks/six-moments",
    "events-and-hooks/toll-booths",
    "memory-and-sessions/patients-chart",
    "memory-and-sessions/state-places",
    "permissions-sandboxes-and-credentials/credential-added",
    "permissions-sandboxes-and-credentials/glovebox",
    "permissions-sandboxes-and-credentials/permission-pipeline",
    "stopping-and-structured-output/default-caps",
    "stopping-and-structured-output/jelly-mould",
    "talking-to-a-model/resent-history",
    "talking-to-a-model/stream-fold",
    "talking-to-a-model/taxi-meter",
    "testing-offline-and-a-first-agent/mock-seams",
    "tools/tool-round-trip",
    "tools/vending-machine",
  ]);
  assert.deepEqual(ids(FIXTURE_FIGURES), ["first/loop-bench", "first/tally-counter", "first/ticket-rail"]);
  assert.deepEqual(ids(SITE_FIGURES), [
    "call-workflow-loop/loop-bench",
    "call-workflow-loop/tally-counter",
    "call-workflow-loop/ticket-rail",
    "call-workflow-loop/who-decides",
  ]);
});

test("the package's figures:build script redraws every folder this test checks", () => {
  const scripts = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).scripts as Record<string, string>;
  const named = (scripts["figures:build"] ?? "").split(" ").slice(2);
  assert.deepEqual(
    named,
    ROOTS.map((root) => relative(app, root).split(sep).join("/").replace(/\/$/, "")),
  );
});

// Every folder holds isometric figures (the book's own since Chapter 1's loop bench), whose painter's order takes a few
// seconds to settle once per run (the registry keeps each drawing), so each check gets a longer limit than Vitest's
// default 5 seconds on a loaded machine, such as CI running every package's tests at once.
for (const root of ROOTS) {
  const folder = relative(app, root).split(sep).join("/");
  test(`every committed figure under ${folder} is what its script draws now`, async () => {
    assert.deepEqual(await staleFigures(root), []);
  }, 60_000);
}

/**
 * Copies Chapter 1's flat ticket rail, script and SVG, into `root`, where the fixture book keeps its re-export of it;
 * the test rewrites the script's import of svgkit.
 */
function copyTicketRail(root: string): void {
  mkdirSync(join(root, "first"));
  for (const file of ["ticket-rail.ts", "ticket-rail.svg"]) {
    cpSync(join(BOOK_FIGURES, "call-workflow-loop", file), join(root, "first", file));
  }
}

test("changing a figure script without rerunning figures:build makes its SVG stale, naming the script", async () => {
  const root = mkdtempSync(join(tmpdir(), "figures-"));
  dirs.push(root);
  copyTicketRail(root);
  const script = join(root, "first/ticket-rail.ts");
  const kit = join(BOOK_FIGURES, "lib/svgkit.ts");
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
  copyTicketRail(root);
  rmSync(join(root, "first/ticket-rail.ts"));
  assert.deepEqual(
    (await staleFigures(root)).map((problem) => problem.replace(/^.*first\//, "")),
    ["ticket-rail.svg has no script beside it; delete it or add ticket-rail.ts"],
  );
});

test("an SVG left beside an isometric figure, or a fragment beside a flat one, is reported", async () => {
  const root = mkdtempSync(join(tmpdir(), "figures-"));
  dirs.push(root);
  copyTicketRail(root);
  // The copied isometric script imports isokit by its absolute path, and the folder is a module scope, so the copy
  // loads the same IsoFigure class the registry checks against.
  writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
  const rail = join(root, "first/ticket-rail.ts");
  const svgkit = join(BOOK_FIGURES, "lib/svgkit.js");
  writeFileSync(rail, readFileSync(rail, "utf8").replace(/from "[^"]*svgkit\.js"/, `from "${svgkit}"`));
  const bench = join(FIXTURE_FIGURES, "first/loop-bench");
  const isokit = join(BOOK_FIGURES, "lib/isokit.js");
  writeFileSync(
    join(root, "first/loop-bench.ts"),
    readFileSync(`${bench}.ts`, "utf8").replace(/from "[^"]*isokit\.js"/, `from "${isokit}"`),
  );
  cpSync(`${bench}.html`, join(root, "first/loop-bench.html"));
  writeFileSync(join(root, "first/loop-bench.svg"), "<svg></svg>\n");
  writeFileSync(join(root, "first/ticket-rail.html"), "<figure></figure>\n");
  // The copied fragment names the copy's path in its header, so it is stale too; only the left-over files matter here.
  const leftOver = (await staleFigures(root))
    .filter((problem) => !problem.includes(" is stale: "))
    .map((problem) => problem.replace(/^.*first\//, ""));
  assert.deepEqual(leftOver, [
    "loop-bench.svg is left over: loop-bench.ts draws an HTML fragment, not this file; delete it",
    "ticket-rail.html is left over: ticket-rail.ts draws an SVG, not this file; delete it",
  ]);
}, 60_000);

// A flat figure, because the registry keeps each isometric drawing for the process, so drawing one twice would compare
// the kept drawing with itself.
test("drawing the same flat figure twice writes the same bytes", async () => {
  const figure = figureScripts(BOOK_FIGURES).find((script) => script.id === "ticket-rail");
  assert.ok(figure);
  assert.deepEqual(await drawFigure(figure), await drawFigure(figure));
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
  const ticket = figureScripts(FIXTURE_FIGURES).find((script) => script.id === "ticket-rail");
  assert.equal(ticket?.source, "apps/manual/test/fixtures/book/figures/first/ticket-rail.ts");
  assert.equal(fileURLToPath(new URL("./fixtures/book/figures/first/ticket-rail.svg", import.meta.url)), ticket?.svg);
});

// A kit SVG with one thing slipped into its drawing, as a hand edit or a crafted file might.
function crafted(insert: string): string {
  const f = figure();
  f.group("parts", () => f.text({ x: 100, y: 50 }, "model"));
  return f.toSvg("figures/x/sample.ts").replace("</svg>", `${insert}\n</svg>`);
}

test("inlining lets through only the elements and attributes the kit writes", () => {
  const inline = (svg: string) => inlineSvg(svg, { figureId: "sample", alt: "x" });
  const cases: [string, RegExp][] = [
    ['<script>alert("x")</script>', /a <script> element, which the figure kit never draws/],
    ['<foreignObject width="10" height="10"></foreignObject>', /a <foreignObject> element/],
    ['<image href="https://example.com/x.png"/>', /a <image> element/],
    ["<style>text{fill:red}</style>", /a <style> element/],
    ['<rect x="1" y="1" width="2" height="2" onclick="alert(1)"/>', /its <rect> has an event handler, onclick/],
    [
      '<path d="M0 0" href="https://example.com/"/>',
      /its <path> links to https:\/\/example\.com\/, not to an id in it/,
    ],
    ['<path d="M0 0" xlink:href="#other--x"/>', /links to #other--x, not to an id in it/],
    ['<rect x="1" y="1" width="2" height="2" style="fill:red"/>', /a style attribute, which the kit never writes/],
    ["<!-- a comment -->", /not an element the kit writes/],
    ["<g>", /its <g> is never closed/],
    ["<text>&nbsp;</text>", /an entity the kit never writes/],
    ["<rect x=1 />", /its <rect> tag is malformed/],
  ];
  for (const [insert, message] of cases) assert.throws(() => inline(crafted(insert)), message, insert);
  assert.throws(
    () => inline(crafted("").replace('class="fig"', 'class="fig" onload="alert(1)"')),
    /its <svg> has a onload attribute/,
  );
});

test("inlining rewrites #id links with the id prefix, as it does ids", () => {
  const svg = crafted('<path d="M0 0" href="#sample--parts"/>');
  assert.match(inlineSvg(svg, { figureId: "sample", alt: "x", idPrefix: "dark-" }), /href="#dark-sample--parts"/);
});

test("no figure may be wider than the stage shows whole at desktop widths", () => {
  assert.equal(MAX_FIGURE_WIDTH, 520);
  assert.doesNotThrow(() => new Figure({ id: "wide", width: 520, height: 10 }));
  assert.throws(
    () => new Figure({ id: "wider", width: 521, height: 10 }),
    /figure "wider" is 521 wide; no figure may be wider than 520/,
  );
});

// On a 360 px phone the figure keeps its natural size and its panel scrolls, so a label renders at its CSS size,
// which must not fall under the approved phone label size.
test("labels render at no less than the phone label size, because a figure never shrinks", () => {
  const css = readFileSync(join(app, "src/styles/components.css"), "utf8");
  const labelPx = Number(/\.fig-text \{[^}]*font-size: (\d+)px/.exec(css)?.[1]);
  assert.ok(labelPx >= readTokens().size.code.label.phone, `labels are ${labelPx}px`);
  const natural = /\.figure__stage--scroll svg\.fig \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(natural, /width: auto;/);
  assert.match(natural, /max-width: none;/);
  assert.match(css, /\.figure__stage--scroll \{[^}]*overflow-x: auto;/);
});

test("the scroll hint follows the stage's own overflow through its scroll timeline, not a guessed width", () => {
  const css = readFileSync(join(app, "src/styles/components.css"), "utf8");
  assert.match(css, /\.figure__stage--scroll \{[^}]*scroll-timeline: --figure-scroll inline;/);
  assert.match(css, /\.figure__panel \.figure__scroll-hint \{\s*animation-timeline: --figure-scroll;/);
  assert.doesNotMatch(css, /@container figure-panel/);
});
