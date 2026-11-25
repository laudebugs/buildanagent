import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SITE_CHROME, siteChromeLinks } from "@buildanagent/manual/site-chrome";
import { describe, inject, test } from "vitest";
import { layers, NARROW_WIDTH } from "../figures/layers.js";
import { Drawing } from "../figures/lib/draw.js";
import { tokenFiles } from "../scripts/token-files.js";
import { copy, repository } from "../src/landing/copy.js";
import { ROOT } from "./build.js";

const OUT = inject("siteOut");
const html = readFileSync(join(OUT, "index.html"), "utf8");

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const escapeAttr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Every stylesheet the page loads, inline or linked, as one string. */
function cssOf(page: string): string {
  const linked = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(([, href]) =>
    readFileSync(join(OUT, href ?? ""), "utf8"),
  );
  const inline = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, css]) => css ?? "");
  return [...linked, ...inline].join("\n");
}

interface CssRule {
  readonly selectors: readonly string[];
  readonly declarations: Readonly<Record<string, string>>;
  /** The viewport width from which the rule applies: the `min-width` of the @media block around it, or 0. */
  readonly minWidth: number;
}

/** Reads a stylesheet's rules, one level of @media deep, in source order. It handles only what site.css uses. */
function parseCss(css: string, minWidth = 0): CssRule[] {
  const rules: CssRule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    for (; close < text.length && depth > 0; close++) depth += text[close] === "{" ? 1 : text[close] === "}" ? -1 : 0;
    const prelude = text.slice(index, open).trim();
    const body = text.slice(open + 1, close - 1);
    const media = /^@media\s*\(\s*min-width:\s*(\d+)px\s*\)$/.exec(prelude);
    if (media !== null) rules.push(...parseCss(body, Number(media[1])));
    else if (!prelude.startsWith("@")) {
      const declarations = Object.fromEntries(
        body
          .split(";")
          .map((line) => line.split(/:(.*)/s).map((part) => part.trim()))
          .filter(([name, value]) => name !== "" && value !== undefined && value !== "")
          .map(([name, value]) => [name, value]),
      );
      rules.push({ selectors: prelude.split(",").map((selector) => selector.trim()), declarations, minWidth });
    }
    index = close;
  }
  return rules;
}

describe("the landing page", () => {
  test("has exactly one h1, the headline", () => {
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    assert.ok(h1.includes(copy.hero.headlineBefore));
    assert.match(h1, new RegExp(`<em>${copy.hero.headlineEmphasis}</em>`));
  });

  test("opens its first paragraph with 50 words or fewer", () => {
    const lead = /<p class="lead">([^<]*)<\/p>/.exec(html)?.[1] ?? "";
    assert.equal(lead, copy.hero.lead);
    assert.ok(lead.split(/\s+/).length <= 50);
  });

  test("links Docs, Manual, Site and GitHub in the header, in order, from the shared site-chrome source", () => {
    const nav = /<nav aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const links = [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(([, href, attrs, label]) => ({
      label,
      href,
      current: attrs?.includes('aria-current="true"') ?? false,
    }));
    const expected = siteChromeLinks("site", { selfHref: "/" });
    assert.deepEqual(
      links,
      expected.map((link) => ({ label: link.label, href: link.href, current: Boolean(link.current) })),
    );
    assert.deepEqual(
      links.map(({ label, href }) => ({ label, href })),
      [...copy.nav],
    );
    assert.deepEqual(
      copy.nav.map((link) => link.label),
      ["Docs", "Manual", "Site", "GitHub"],
    );
  });

  test("shows the wordmark and the inline mark in the header from the shared site-chrome source", () => {
    const brand = /<a class="brand" href="\/">([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";
    assert.ok(brand.includes(SITE_CHROME.mark.svg), "renders the shared inline mark");
    assert.match(brand, /<svg class="mark"[^>]*aria-hidden="true"/);
    assert.match(brand, /stroke="var\(--color-accent\)"/);
    assert.equal(
      brand
        .replace(/<svg[\s\S]*?<\/svg>/, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      SITE_CHROME.sites.site.name,
    );
  });

  test("has both figures with the alt text, and shows one at each width", () => {
    for (const name of ["layers-wide", "layers-narrow"]) {
      const svg = new RegExp(`<svg [^>]*class="${name}"[^>]*>`).exec(html)?.[0] ?? "";
      assert.match(svg, /role="img"/, name);
      assert.ok(svg.includes(`aria-label="${escapeAttr(copy.figure.alt)}"`), `${name} carries the alt text`);
    }
    assert.ok(html.includes(`<figcaption>${copy.figure.caption}</figcaption>`));
  });

  test("shows exactly one figure at each width: narrow below 940 px, wide from 940 px", () => {
    // display:none keeps the hidden drawing out of the accessibility tree. The check reads the source stylesheet, so a
    // change to the breakpoint or to either rule fails here without depending on how the build minifies the CSS.
    const rules = parseCss(read("src/styles/site.css"));
    const shown = (width: number, name: string): boolean => {
      let display = "block";
      for (const rule of rules) {
        const matches = rule.selectors.includes(`.layers .${name}`);
        if (matches && rule.minWidth <= width && rule.declarations.display !== undefined)
          display = rule.declarations.display;
      }
      return display !== "none";
    };
    for (const width of [320, 400, 939, 940, 1280]) {
      assert.equal(shown(width, "layers-wide"), width >= 940, `wide at ${width}`);
      assert.equal(shown(width, "layers-narrow"), width < 940, `narrow at ${width}`);
    }
  });

  test("links the licence line to the repository's LICENSE", () => {
    assert.equal(repository, "https://github.com/laudebugs/buildanagent");
    assert.ok(html.includes(`<a href="${repository}/blob/main/LICENSE">Apache-2.0 OR MIT</a>`));
  });

  test("gives the package section the id the package pages link back to", () => {
    assert.match(html, /<section class="packages" id="packages">/);
  });

  test("shows the install command from the copy", () => {
    assert.ok(html.includes(`<pre><code>${copy.hero.install.command}</code></pre>`));
    assert.ok(html.includes(copy.hero.install.label));
  });

  test("shows the three cells and the six packages with their links", () => {
    for (const cell of copy.cells) {
      assert.ok(html.includes(cell.heading), cell.heading);
      assert.ok(html.includes(cell.body), cell.body);
    }
    assert.equal(copy.packages.items.length, 6);
    for (const item of copy.packages.items) {
      assert.ok(
        html.includes(`<a class="pkg" href="${item.href}"><b>${item.name}</b><span>${item.summary}</span></a>`),
        item.name,
      );
    }
  });

  test("points the internal package links at built pages", () => {
    for (const item of copy.packages.items.filter((entry) => entry.href.startsWith("/"))) {
      assert.ok(existsSync(join(OUT, item.href, "index.html")), item.href);
    }
  });

  test("points the other four packages at their docs API reference, not GitHub", () => {
    const external = copy.packages.items.filter((entry) => !entry.href.startsWith("/"));
    assert.deepEqual(
      external.map((entry) => [entry.name, entry.href]),
      [
        ["@buildanagent/harness", "https://docs.buildanagent.fyi/reference/harness/"],
        ["@buildanagent/agent-safety", "https://docs.buildanagent.fyi/reference/agent-safety/"],
        ["@buildanagent/protocol", "https://docs.buildanagent.fyi/reference/protocol/"],
        ["@buildanagent/cli", "https://docs.buildanagent.fyi/reference/cli/"],
      ],
    );
  });

  test("links the favicon and ships the file", () => {
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
    assert.ok(existsSync(join(OUT, "favicon.svg")));
  });

  test("preloads the two above-the-fold fonts and links no external stylesheet or font", () => {
    assert.equal(html.match(/<link rel="preload"[^>]*as="font"[^>]*crossorigin/g)?.length, 2);
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
    assert.doesNotMatch(cssOf(html), /https?:\/\//);
    assert.match(html, /<meta name="theme-color" content="[^"]+" media="\(prefers-color-scheme: light\)"/);
    assert.match(html, /<meta name="theme-color" content="[^"]+" media="\(prefers-color-scheme: dark\)"/);
  });
});

describe("the generated files", () => {
  test("tokens.css and theme-colors.json are what the generator writes from book-tokens.json", () => {
    for (const file of tokenFiles()) {
      assert.equal(read(file.path), file.content, `${file.path} is stale: run pnpm --filter @buildanagent/site tokens`);
    }
  });

  test("each committed figure is what figures/layers.ts draws", () => {
    for (const { path, drawing } of layers()) {
      assert.equal(read(path), drawing.toSvg(), `${path} is stale: run pnpm --filter @buildanagent/site figures:build`);
    }
  });
});

describe("the figure's geometry", () => {
  const drawings = layers();

  test("has no overlapping or clipped label, and no label under 12 px", () => {
    for (const { path, drawing } of drawings) assert.deepEqual(drawing.problems(), [], path);
  });

  test("names every label from the copy", () => {
    const labels = Object.values(copy.figure.labels);
    for (const { path, drawing } of drawings) {
      assert.deepEqual(drawing.labels.map((label) => label.text).sort(), [...labels].sort(), path);
    }
  });

  test("keeps the narrow drawing's labels inside 300 units at 13 px, which render 12 px or more at 320 px", () => {
    const narrow = drawings.find((entry) => entry.path.endsWith("narrow.svg"))?.drawing;
    assert.ok(narrow !== undefined);
    assert.equal(narrow.width, NARROW_WIDTH);
    // A 320 px viewport leaves 320 - 32 (page padding) - 2 (border) = 286 px for the drawing.
    assert.ok((13 * 286) / narrow.width >= 12);
    assert.equal(narrow.fontSize, 13);
    for (const label of narrow.labels)
      assert.ok(label.rect.x >= 0 && label.rect.x + label.rect.width <= NARROW_WIDTH, label.text);
  });

  test("switches to the wide drawing only where its 13 px labels render at 12 px or more", () => {
    // From 940 px the wide drawing has 940 - 48 (page padding) - 2 (border) - 36 (figure padding) = 854 px for 900 units.
    assert.ok((13 * (940 - 48 - 2 - 36)) / 900 >= 12);
    assert.ok((13 * (940 - 15 - 48 - 2 - 36)) / 900 >= 12, "still 12 px beside a classic scrollbar");
  });

  test("keeps every narrow label 8 units inside the canvas at an advance of 0.62 em", () => {
    const narrow = drawings.find((entry) => entry.path.endsWith("narrow.svg"))?.drawing;
    assert.ok(narrow !== undefined);
    for (const label of narrow.labels) {
      const width = [...label.text].length * 13 * 0.62;
      const centre = label.rect.x + label.rect.width / 2;
      assert.ok(centre - width / 2 >= 8 || label.on !== undefined, `${label.text} left margin`);
      assert.ok(centre + width / 2 <= NARROW_WIDTH - 8 || label.on !== undefined, `${label.text} right margin`);
    }
    const longest = Math.max(...Object.values(copy.figure.labels).map((text) => [...text].length));
    assert.ok(longest * 13 * 0.62 + 16 <= NARROW_WIDTH);
  });

  test("keeps the wide drawing at the mock's 900 x 372", () => {
    assert.match(read("src/landing/layers-wide.svg"), /viewBox="0 0 900 372"/);
  });

  test("joins every arrow's line to its head and lands its tip on the box it points at", () => {
    for (const { path, drawing } of drawings) {
      assert.equal(drawing.arrows.length, 2, path);
      assert.deepEqual(
        drawing.problems().filter((problem) => /arrow|tip|head|line ends/.test(problem)),
        [],
        path,
      );
    }
  });

  test("reports an arrow whose line stops short of its head or whose tip floats off its box", () => {
    const drawing = new Drawing({ width: 200, height: 100, alt: "test", className: "t" });
    drawing.box("target", { x: 100, y: 20, width: 60, height: 40 });
    drawing.arrow({
      id: "short",
      path: [
        [10, 40],
        [82, 40],
      ],
      tip: [99, 40],
      direction: "right",
      target: "target",
    });
    drawing.arrow({
      id: "floats",
      path: [
        [10, 50],
        [82, 50],
      ],
      tip: [90, 50],
      direction: "right",
      target: "target",
    });
    drawing.arrow({
      id: "misses",
      path: [
        [10, 80],
        [91, 80],
      ],
      tip: [99, 80],
      direction: "right",
      target: "target",
    });
    const found = drawing.problems().join("\n");
    assert.match(found, /short: the line ends at 82,40 but its head's base is at 91,40/);
    assert.match(found, /floats: the tip is at 90, not on the edge of target at 99/);
    assert.match(found, /misses: the tip misses the side of target/);
  });

  test("reports a label that overlaps another or a mark it does not belong to", () => {
    const drawing = new Drawing({ width: 200, height: 100, alt: "test", className: "t" });
    drawing.box("box", { x: 10, y: 10, width: 100, height: 40 });
    drawing.text("one label", 20, 30, { on: "box" });
    drawing.text("outside", 30, 30);
    drawing.text("far away", 100, 90);
    drawing.text("clipped label here", 150, 60);
    const found = drawing.problems().join("\n");
    assert.match(found, /"outside" touches box/);
    assert.match(found, /"one label" overlaps "outside"/);
    assert.match(found, /"clipped label here" leaves the 200 x 100 canvas/);
    assert.doesNotMatch(found, /far away/);
  });

  test("gives each committed SVG a role and the alt text, and sets no colour of its own", () => {
    for (const { path } of drawings) {
      const svg = read(path);
      assert.match(svg, /role="img"/, path);
      assert.ok(svg.includes(`aria-label="${escapeAttr(copy.figure.alt)}"`), path);
      assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/, path);
    }
  });
});

describe("the fonts", () => {
  const FONTS = join(ROOT, "public/fonts");
  // The manual serves its fonts from public/fonts/, two folders up from the tokens module its package exports.
  const MANUAL_FONTS = fileURLToPath(
    new URL(
      "../../public/fonts/",
      pathToFileURL(createRequire(import.meta.url).resolve("@buildanagent/manual/design/tokens")),
    ),
  );

  test("are byte-identical copies of the manual's self-hosted subsets", () => {
    const files = readdirSync(FONTS, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    assert.ok(files.length >= 8);
    for (const entry of files) {
      const path = relative(FONTS, join(entry.parentPath, entry.name));
      assert.ok(readFileSync(join(FONTS, path)).equals(readFileSync(join(MANUAL_FONTS, path))), `${path} differs`);
    }
  });

  test("include every face tokens.css names and each licence", () => {
    const css = read("src/styles/tokens.css");
    for (const [, src] of css.matchAll(/url\("([^"]+\.woff2)"\)/g)) {
      assert.ok(existsSync(join(ROOT, "public", src ?? "")), `${src} is missing`);
    }
    for (const folder of ["instrument-serif", "literata", "manual-code"]) {
      assert.ok(existsSync(join(FONTS, folder, "OFL.txt")), folder);
    }
  });
});

describe("colours", () => {
  /** Every text file of the site's own code and content. Fonts and the favicon in public/ are binary or standalone. */
  function sources(): string[] {
    const skipped = /(^|\/)(node_modules|dist|\.astro|public)(\/|$)/;
    return readdirSync(ROOT, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
      .filter((file) => !skipped.test(file));
  }

  // A hex value may live in two generated files only: tokens.css, and theme-colors.json, which holds the two page
  // backgrounds because a theme-color meta tag cannot read a custom property. public/favicon.svg is standalone and
  // carries its own colours.
  const ALLOWED = new Set(["src/styles/tokens.css", "src/landing/theme-colors.json"]);

  test("are written as hex only in the generated token files and the standalone favicon", () => {
    const files = sources().filter((file) => !ALLOWED.has(file));
    assert.ok(files.length > 20, "scans the site's files");
    for (const file of files) assert.doesNotMatch(read(file), /#[0-9a-fA-F]{3,8}\b/, file);
  });
});
