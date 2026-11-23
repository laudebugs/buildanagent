import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// iOS Safari zooms the page when a text field under 16px takes focus. The book keeps its smaller field text for a
// mouse and raises every field to at least 1rem inside `@media (pointer: coarse)`. This reads the source, so a new
// field, or an edit that drops the override, fails here; scripts/touch-fields-check.mjs measures the built book.
const styles = new URL("../src/styles/components.css", import.meta.url);
const css = readFileSync(styles, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The class of every field the book's own source creates: its Astro components and the notes script. */
function fieldClasses(): string[] {
  const found = new Set<string>();
  const src = new URL("../src/", import.meta.url);
  for (const path of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((p) => p.endsWith(".astro"))) {
    const text = readFileSync(new URL(path, src), "utf8");
    for (const tag of text.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)) {
      const type = /type="(hidden|checkbox|radio|button|submit)"/.exec(tag[0]);
      const klass = /class="([^"{]+)"/.exec(tag[0])?.[1]?.split(" ")[0];
      assert.ok(klass || type, `${path}: ${tag[0]} needs a class so the touch rule can name it`);
      if (!type && klass) found.add(klass);
    }
  }
  const script = readFileSync(new URL("../public/scripts/notes.js", import.meta.url), "utf8");
  for (const made of script.matchAll(
    /element\(\s*\w+\.?\w*,\s*"(?:input|textarea|select)",\s*\{[^}]*?className:\s*"([^"]+)"/g,
  )) {
    found.add((made[1] ?? "").split(" ")[0] ?? "");
  }
  return [...found];
}

/** The text of every `@media (pointer: coarse) { ... }` block. */
function coarseBlocks(): string {
  const blocks: string[] = [];
  for (const start of css.matchAll(/@media\s*\(pointer:\s*coarse\)\s*\{/g)) {
    let depth = 1;
    let i = (start.index ?? 0) + start[0].length;
    const from = i;
    while (depth > 0 && i < css.length) {
      depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
      i += 1;
    }
    blocks.push(css.slice(from, i - 1));
  }
  return blocks.join("\n");
}

test("every text field the book creates is raised to 1rem or more on a touch screen", () => {
  const classes = fieldClasses();
  assert.ok(classes.length >= 3, `found only ${classes.join(", ")}`);
  const coarse = coarseBlocks();
  for (const klass of classes) {
    const rule = [...coarse.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
      m[1]?.split(",").some((sel) => sel.trim() === `.${klass}`),
    );
    assert.ok(rule, `.${klass} has no rule inside @media (pointer: coarse)`);
    assert.match(
      rule[2] ?? "",
      /font-size:\s*max\(\s*1rem\s*,[^;]+\)/,
      `.${klass}: the touch rule must set font-size to max(1rem, ...)`,
    );
  }
});

test("no field's font size is fixed below 16px in a touch rule, and no rule uses a pixel size under 16 for it", () => {
  const coarse = coarseBlocks();
  for (const m of coarse.matchAll(/(\.search-box__input|\.notes-pop__field|\.notes-dialog__field)[^{]*\{([^}]*)\}/g)) {
    const size = /font-size:\s*([\d.]+)(px|rem)/.exec(m[2] ?? "");
    if (!size) continue;
    const px = Number(size[1]) * (size[2] === "rem" ? 16 : 1);
    assert.ok(px >= 16, `${m[1]} sets ${size[0]} on a touch screen`);
  }
});

test("the viewport meta forbids no zoom", () => {
  const layout = readFileSync(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
  const meta = /<meta name="viewport" content="([^"]*)"/.exec(layout)?.[1];
  assert.ok(meta, "BaseLayout has no viewport meta");
  assert.doesNotMatch(meta, /maximum-scale|minimum-scale|user-scalable/);
});
