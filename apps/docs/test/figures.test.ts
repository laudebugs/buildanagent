import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readTokens } from "@buildanagent/manual/design/tokens";
import { toHtml } from "hast-util-to-html";
import { describe, test } from "vitest";
import { drawFigure } from "../figures/draw.js";
import { FIGURE_IDS, FIGURES_BUILD, PIPELINE_FILES, scriptOf, strayFiles, svgOf } from "../figures/registry.js";
import { figureSvg } from "../src/plugins/figure-svg.js";

// The figures in figures/: each committed SVG is what its script draws now, and no figure holds a colour that is not
// a theme token. A colour reaches a figure only through the book's fig-* classes, which colour with panel tokens.

/** A colour written out: a hex value, a colour function, or a colour property or attribute. */
const COLOUR =
  /(?<![\w&])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:fill|stroke|color|stop-color|flood-color)\s*[=:]|\bstyle=/;

test("the folder holds the pipeline and the registered figures, and nothing else", () => {
  assert.deepEqual(strayFiles(), [], `register these in figures/registry.ts or delete them`);
  for (const name of PIPELINE_FILES) assert.ok(existsSync(new URL(`../figures/${name}`, import.meta.url)), name);
  for (const id of FIGURE_IDS) {
    assert.ok(existsSync(scriptOf(id)), `figures/${id}.ts is missing`);
    assert.ok(existsSync(svgOf(id)), `figures/${id}.svg is missing: run ${FIGURES_BUILD}`);
  }
});

/**
 * The ways a file breaks XML well-formedness that the sanitiser's element check does not already cover, since it reads
 * only the drawing: a comment holding `--` or ending in `-`, a `<` or a bare `&` inside the style, or a tag outside the
 * header, the root, the style and the drawing. A browser forgives each of them inline, but an XML parser refuses the
 * standalone file.
 */
function notWellFormed(svg: string): string | undefined {
  for (const [, body = ""] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (body.includes("--") || body.endsWith("-")) return `the comment <!--${body.slice(0, 60)}--> holds --`;
  }
  const [, style] = /<style>\n([\s\S]*?)\n<\/style>/.exec(svg) ?? [];
  if (style === undefined) return "it has no <style>";
  if (style.includes("<")) return "its style holds a <";
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(style)) return "its style holds a bare &";
  const tags =
    svg
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<style>[\s\S]*?<\/style>/, "")
      .match(/<[^>]*>/g) ?? [];
  const open: string[] = [];
  for (const tag of tags) {
    const closing = /^<\/([a-z]+)>$/.exec(tag);
    if (closing !== null) {
      if (open.pop() !== closing[1]) return `its ${tag} closes no open element`;
    } else {
      const start = /^<([a-z]+)(?: [^<>]*?)?(\/?)>$/.exec(tag);
      if (start === null) return `it holds ${tag.slice(0, 40)}, which is not a tag`;
      if (start[2] === "") open.push(start[1] ?? "");
    }
  }
  return open.length > 0 ? `its <${open.at(-1)}> is never closed` : undefined;
}

test("the well-formedness check finds a -- in a comment", () => {
  const svg = readFileSync(svgOf("run-loop"), "utf8");
  assert.match(notWellFormed(svg.replace("Do not edit:", "Do not edit -- ")) ?? "", /holds --/);
  assert.match(notWellFormed(svg.replace(" -->\n", " --->\n")) ?? "", /holds --/);
});

describe.each(FIGURE_IDS.map((id) => [id] as const))("%s", (id) => {
  test("its committed SVG is well-formed XML", () => {
    assert.equal(notWellFormed(readFileSync(svgOf(id), "utf8")), undefined, `figures/${id}.svg is not well-formed`);
  });

  test("its committed SVG is what its script draws now", async () => {
    const committed = readFileSync(svgOf(id), "utf8");
    assert.ok(committed === (await drawFigure(id)), `figures/${id}.svg is stale: run ${FIGURES_BUILD}`);
  });

  test("its script writes no colour", () => {
    const script = readFileSync(scriptOf(id), "utf8");
    assert.equal(COLOUR.exec(script)?.[0], undefined, `figures/${id}.ts writes a colour; use a tone or fill name`);
  });

  test("its drawing holds no colour, and its standalone style only the panel tokens", () => {
    const svg = readFileSync(svgOf(id), "utf8");
    const [, style = "", drawing = ""] = /<style>\n([^<]*)\n<\/style>\n([\s\S]*)$/.exec(svg) ?? [];
    assert.ok(drawing !== "", "the file has a <style> and a drawing after it");
    assert.equal(COLOUR.exec(drawing)?.[0], undefined, "the drawing writes a colour");
    // The style, which the page drops, lets the file render on its own: its colours must be the tokens' own values.
    const tokens = readTokens();
    const values = new Set(
      (["panelLight", "panelDark"] as const).flatMap((set) =>
        Object.values(tokens.color[set].values).map((value) => value.toLowerCase()),
      ),
    );
    const written = [...style.matchAll(/:(#[0-9a-fA-F]{3,8})\b/g)].map((match) => match[1] ?? "");
    assert.ok(written.length > 0, "the style defines the panel tokens");
    for (const value of written) assert.ok(values.has(value), `${value} is not a panel token's value`);
    assert.doesNotMatch(style, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/, "the style uses a colour function");
  });

  test("what the page inlines holds no colour", () => {
    const html = toHtml(figureSvg(readFileSync(svgOf(id), "utf8"), { figureId: id, alt: "x" }), { space: "svg" });
    assert.equal(COLOUR.exec(html)?.[0], undefined);
  });
});

test("the colour check catches each way to write a colour", () => {
  for (const sample of ['fill="#a3401c"', "stroke: red", "rgb(1, 2, 3)", "oklch(0.5 0.1 30)", 'style="x"', "#fff"]) {
    assert.match(sample, COLOUR, sample);
  }
  assert.doesNotMatch('class="fig-line fig-line--accent" d="M1 2"', COLOUR);
});

describe("the figure frame's stylesheet", () => {
  const css = readFileSync(new URL("../src/styles/figures.css", import.meta.url), "utf8");

  test("keeps the drawing at its natural size and scrolls the stage where the column is narrower", () => {
    assert.match(css, /\.docs-figure \.figure__stage--scroll \{[^}]*overflow-x: auto;/);
    assert.match(css, /\.docs-figure \.figure__stage--scroll svg\.fig \{[^}]*width: auto;\s*max-width: none;/);
    assert.match(css, /\.docs-figure \.figure__scroll-hint \{[^}]*visibility: hidden;/);
    assert.match(css, /animation-timeline: --figure-scroll;/);
    assert.match(css, /@media \(max-width: 40rem\) \{\s*\.docs-figure \.figure__stage--scroll \{/);
  });

  test("gives the marks system colours under forced colours", () => {
    assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*fill: CanvasText;[\s\S]*stroke: CanvasText;/);
  });

  test("names under forced colours every book class that sets a fill or a stroke", () => {
    const book = readFileSync(
      createRequire(import.meta.url).resolve("@buildanagent/manual/styles/figures.css"),
      "utf8",
    );
    const coloured = [...book.matchAll(/\.(fig-[a-z0-9-]+) \{([^}]*)\}/g)]
      .filter(([, , body = ""]) => /(?:^|\s)(?:fill|stroke):\s*var\(/.test(body))
      .map(([, name = ""]) => name);
    assert.ok(coloured.includes("fig-amber") && coloured.includes("fig-paper"), "the book's coloured classes are read");
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    const missing = coloured.filter((name) => !new RegExp(`\\.docs-figure \\.${name}[,\\s]`).test(forced));
    assert.deepEqual(missing, [], "add these classes to the forced-colours block of src/styles/figures.css");
  });

  test("is loaded after the book's figure marks", () => {
    const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
    assert.match(config, /"@buildanagent\/manual\/styles\/figures\.css",\s*"\.\/src\/styles\/figures\.css",/);
    assert.match(config, /remarkPlugins: \[[^\]]*figureDirective[^\]]*\]/);
  });
});
