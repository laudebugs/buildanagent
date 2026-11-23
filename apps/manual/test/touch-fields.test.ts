import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// iOS Safari zooms the page when a text field under 16px takes focus. The book keeps smaller field text for a mouse and
// raises every field it draws to 16px or more inside `@media (any-pointer: coarse)`. This test reads the source in
// three steps. It finds every field the book's own files create. For each, it works out which font-size rule wins on a
// touch screen (specificity, then source order). It then requires that rule's smallest possible value to be at least
// 16px. scripts/touch-fields-check.mjs measures the built book in a browser instead.
const root = new URL("../", import.meta.url);
const componentsCss = readFileSync(new URL("src/styles/components.css", root), "utf8");
const tokensCss = readFileSync(new URL("src/styles/tokens.css", root), "utf8");
const MIN_PX = 16;

// ---- The fields the book creates -------------------------------------------------------------------------------

const TAG = /<(?:input|textarea|select)\b[^>]*>/g;
const MADE = /element\(\s*[\w.]+,\s*"(?:input|textarea|select)",\s*\{[^}]*?className:\s*"([^"]+)"/g;

/** The files that can draw a field: the Astro components, the TypeScript page scripts, the Markdown chapters and the public scripts. */
function sourceFiles(): { path: string; text: string }[] {
  const files: string[] = [];
  for (const dir of ["src", "public/scripts"]) {
    for (const path of readdirSync(new URL(`${dir}/`, root), { recursive: true, encoding: "utf8" })) {
      if (/\.(astro|ts|md|mdx|js)$/.test(path)) files.push(`${dir}/${path}`);
    }
  }
  return files.map((path) => ({ path, text: readFileSync(new URL(path, root), "utf8") }));
}

/** The first class of every text field in `files`; a field with no class, or made another way, fails the test. */
function fieldClasses(files: { path: string; text: string }[]): string[] {
  const found = new Set<string>();
  for (const { path, text } of files) {
    for (const tag of text.matchAll(TAG)) {
      if (/type="(hidden|checkbox|radio|button|submit|reset|image|range|color|file)"/.test(tag[0])) continue;
      const klass = /class="([^"{]+)"/.exec(tag[0])?.[1]?.split(" ")[0];
      assert.ok(klass, `${path}: ${tag[0]} needs a literal class so the touch rule can name it`);
      found.add(klass);
    }
    for (const made of text.matchAll(MADE)) found.add((made[1] ?? "").split(" ")[0] ?? "");
    assert.doesNotMatch(
      text,
      /createElement\(\s*["'](input|textarea|select)["']|contenteditable\s*=\s*["']?(?!false)|\.contentEditable\s*=/i,
      `${path} creates a field without a class; build it with element(doc, "textarea", { className })`,
    );
  }
  return [...found];
}

// ---- A small cascade for font-size -----------------------------------------------------------------------------

interface Rule {
  selector: string;
  declarations: Map<string, string>;
  /** "touch" inside `any-pointer: coarse`, "always" outside any media query that matters, "never" for print or a fine pointer. */
  when: "always" | "touch" | "never";
  order: number;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function mediaState(prelude: string, outer: Rule["when"]): Rule["when"] {
  if (outer === "never") return "never";
  if (/\bprint\b|pointer:\s*fine|hover:\s*hover/.test(prelude)) return "never";
  if (/(any-)?pointer:\s*coarse|hover:\s*none/.test(prelude)) return "touch";
  return outer;
}

/** Style rules in source order. @media, @supports and @container bodies are read; other at-rules are skipped. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (text: string, when: Rule["when"]): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < text.length) {
        depth += text[j] === "{" ? 1 : text[j] === "}" ? -1 : 0;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@media")) walk(body, mediaState(prelude, when));
      else if (/^@(supports|container|layer)\b/.test(prelude)) walk(body, when);
      else if (!prelude.startsWith("@")) {
        const declarations = new Map<string, string>();
        for (const m of body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) declarations.set(m[1] ?? "", (m[2] ?? "").trim());
        rules.push({ selector: prelude, declarations, when, order: rules.length });
      }
      i = j;
    }
  };
  walk(stripComments(css), "always");
  return rules;
}

/** Specificity as a comparable number: ids, then classes, attributes and pseudo-classes, then element names. */
function specificity(selector: string): number {
  const bare = selector.replace(/::?[\w-]+\([^)]*\)|::[\w-]+/g, (m) => (m.startsWith("::") ? "" : " .x"));
  const ids = (bare.match(/#[\w-]+/g) ?? []).length;
  const classes = (bare.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const types = (bare.match(/(?:^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}

/** The selectors in `rule` that style the field itself: they name `.klass` and no pseudo-element. */
function fieldSelectors(rule: Rule, klass: string): string[] {
  const own = new RegExp(`\\.${klass}(?![\\w-])`);
  return rule.selector
    .split(",")
    .map((s) => s.trim())
    .filter(
      (s) => own.test(s) && !s.includes("::") && /\.[\w-]+(?:[:[][^\s>+~]*)?$/.test(s) && s.endsWith(`.${klass}`),
    );
}

/** A lower bound, in px, for a length: px, rem, var() from tokens.css, max, min and clamp. Null when none can be proved. */
function lowerBound(value: string): number | null {
  const v = value.trim().replace(/\s*!important$/, "");
  const length = /^(-?[\d.]+)(px|rem)$/.exec(v);
  if (length) return Number(length[1]) * (length[2] === "rem" ? 16 : 1);
  const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  if (variable) {
    const token = new RegExp(`${variable[1]}:\\s*([^;]+);`).exec(tokensCss)?.[1];
    return token ? lowerBound(token) : null;
  }
  const call = /^(max|min|clamp)\(([\s\S]*)\)$/.exec(v);
  if (!call) return null;
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  const inner = call[2] ?? "";
  for (let i = 0; i <= inner.length; i += 1) {
    if (inner[i] === "(") depth += 1;
    if (inner[i] === ")") depth -= 1;
    if ((inner[i] === "," && depth === 0) || i === inner.length) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  const bounds = args.map(lowerBound);
  const known = bounds.filter((b): b is number => b !== null);
  if (call[1] === "max") return known.length > 0 ? Math.max(...known) : null;
  if (call[1] === "min") return known.length === bounds.length ? Math.min(...known) : null;
  const [low, , high] = bounds; // clamp(low, preferred, high) is at least min(low, high)
  return low != null && high != null ? Math.min(low, high) : null;
}

/** The smallest font size, in px, a field of this class can have on a touch screen under `css`, or why none is proved. */
function touchFloor(css: string, klass: string): { px: number | null; why: string } {
  const matching = parseRules(css)
    .filter((rule) => rule.when !== "never")
    .map((rule) => ({ rule, specificity: Math.max(0, ...fieldSelectors(rule, klass).map(specificity)) }))
    .filter(({ rule, specificity: s }) => s > 0 && fieldSelectors(rule, klass).length > 0);
  for (const { rule } of matching) {
    const shorthand = rule.declarations.get("font");
    if (shorthand !== undefined && shorthand !== "inherit")
      return { px: null, why: `.${klass} uses font: ${shorthand}` };
  }
  const sizing = matching.filter(({ rule }) => rule.declarations.has("font-size"));
  if (sizing.length === 0) return { px: null, why: `.${klass} has no font-size rule` };
  const important = (r: Rule) => r.declarations.get("font-size")?.includes("!important") === true;
  sizing.sort(
    (a, b) =>
      Number(important(a.rule)) - Number(important(b.rule)) ||
      a.specificity - b.specificity ||
      a.rule.order - b.rule.order,
  );
  const winner = sizing[sizing.length - 1]?.rule as Rule;
  const size = winner.declarations.get("font-size") ?? "";
  return { px: lowerBound(size), why: `the winner is \`${winner.selector} { font-size: ${size} }\`` };
}

// ---- Tests -----------------------------------------------------------------------------------------------------

const classes = fieldClasses(sourceFiles());

test("the scan finds the book's fields: the notes' textareas and the search box", () => {
  for (const klass of ["notes-pop__field", "notes-dialog__field", "search-box__input"]) {
    assert.ok(classes.includes(klass), `the scan missed .${klass} (found ${classes.join(", ")})`);
  }
});

test("every text field the book creates is at least 16px on a touch screen", () => {
  for (const klass of classes) {
    const { px, why } = touchFloor(componentsCss, klass);
    assert.ok(
      px !== null && px >= MIN_PX,
      `.${klass} is not proved to be at least ${MIN_PX}px on touch: ${why} (${px})`,
    );
  }
});

test("the checker fails a later or more specific rule that shrinks a field again", () => {
  const specific = `${componentsCss}\n.notes-pop .notes-pop__field { font-size: 15.5px; }\n`;
  assert.ok((touchFloor(specific, "notes-pop__field").px ?? 0) < MIN_PX, "a more specific rule went unnoticed");
  const later = `${componentsCss}\n.search-box__input { font-size: 0.75rem; }\n`;
  assert.ok((touchFloor(later, "search-box__input").px ?? 0) < MIN_PX, "a later rule went unnoticed");
  const media = /@media \(any-pointer: coarse\) \{[\s\S]*?\n\}\n/.exec(componentsCss)?.[0] ?? "";
  assert.ok(media.includes("max(1rem"), "the touch block was not found");
  const moved = `${media}\n${componentsCss.replace(media, "")}`;
  assert.ok(
    (touchFloor(moved, "notes-dialog__field").px ?? 0) < MIN_PX,
    "a touch block moved above the base went unnoticed",
  );
});

test("the checker accepts any way to reach 16px and rejects values it cannot prove", () => {
  const plain = componentsCss.replace("font-size: max(1rem, var(--size-note));", "font-size: 16px;");
  assert.notEqual(plain, componentsCss);
  assert.equal(touchFloor(plain, "search-box__input").px, 16);
  const unknown = componentsCss.replace("font-size: max(1rem, var(--size-note));", "font-size: 1em;");
  assert.equal(touchFloor(unknown, "search-box__input").px, null);
  assert.equal(lowerBound("clamp(0.875rem, 0.8505rem + 0.1087vw, 0.9375rem)"), 14);
  assert.equal(lowerBound("max(1rem, var(--size-note))"), 16);
});

test("the viewport meta forbids no zoom", () => {
  const layout = readFileSync(new URL("src/layouts/BaseLayout.astro", root), "utf8");
  const meta = /<meta name="viewport" content="([^"]*)"/.exec(layout)?.[1];
  assert.ok(meta, "BaseLayout has no viewport meta");
  assert.doesNotMatch(meta, /maximum-scale|minimum-scale|user-scalable/);
});
