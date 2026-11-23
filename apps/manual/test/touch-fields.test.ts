import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// iOS Safari zooms the page when a text field under 16px takes focus. The book keeps smaller field text for a mouse and
// raises every field it draws to 16px or more inside `@media (any-pointer: coarse)`. This test reads the source in
// three steps. It finds every field the book's own files create. For each, it works out which font-size rule wins on a
// touch screen (specificity, then source order). It then requires that rule's smallest possible value to be at least
// 16px. A rule counts if it may apply on a touch device: a pseudo-class such as :focus, an element or attribute
// selector that matches the field, or a media query a touch device can also meet (an iPad with a mouse matches
// `pointer: fine` and `hover: hover` too) all count, so the floor is the smallest size any such combination leaves.
// scripts/touch-fields-check.mjs measures the built book in a browser instead.
const root = new URL("../", import.meta.url);
const componentsCss = readFileSync(new URL("src/styles/components.css", root), "utf8");
const tokensCss = readFileSync(new URL("src/styles/tokens.css", root), "utf8");
const MIN_PX = 16;

// ---- The fields the book creates -------------------------------------------------------------------------------

const TAG = /<(?:input|textarea|select)\b[^>]*>/g;
const MADE = /element\(\s*[\w.]+,\s*"(input|textarea|select)",\s*\{[^}]*?className:\s*"([^"]+)"/g;

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

interface Field {
  /** The class the touch rule names. */
  klass: string;
  classes: string[];
  tag: string;
}

/** Every text field in `files`; a field with no class, or made another way, fails the test. */
function findFields(files: { path: string; text: string }[]): Field[] {
  const found = new Map<string, Field>();
  const add = (classes: string[], tag: string) => {
    const [klass] = classes;
    if (klass) found.set(klass, { klass, classes, tag });
  };
  for (const { path, text } of files) {
    for (const tag of text.matchAll(TAG)) {
      if (/type="(hidden|checkbox|radio|button|submit|reset|image|range|color|file)"/.test(tag[0])) continue;
      const classes = /class="([^"{]+)"/.exec(tag[0])?.[1]?.trim().split(/\s+/);
      assert.ok(classes, `${path}: ${tag[0]} needs a literal class so the touch rule can name it`);
      add(classes, /^<(\w+)/.exec(tag[0])?.[1] ?? "input");
    }
    for (const made of text.matchAll(MADE)) add((made[2] ?? "").trim().split(/\s+/), made[1] ?? "");
    assert.doesNotMatch(
      text,
      /createElement\(\s*["'](input|textarea|select)["']|contenteditable\s*=\s*["']?(?!false)|\.contentEditable\s*=/i,
      `${path} creates a field without a class; build it with element(doc, "textarea", { className })`,
    );
  }
  return [...found.values()];
}

// ---- A small cascade for font-size -----------------------------------------------------------------------------

/** Whether a rule applies on a touch device: always, always there (inside `any-pointer: coarse`), only maybe, or never. */
type When = "always" | "touch" | "maybe" | "never";

interface Rule {
  selector: string;
  /** In source order, so a `font` shorthand after `font-size` is seen to reset it. */
  declarations: [string, string][];
  when: When;
  order: number;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** How a media query changes whether its rules apply to a touch device. Only print and speech are never on one. */
function mediaState(prelude: string, outer: When): When {
  if (outer === "never") return "never";
  if (/\b(print|speech)\b/.test(prelude)) return "never";
  const query = prelude.replace(/^@media\s*/, "").trim();
  const state: When = /^\(\s*any-pointer:\s*coarse\s*\)$/.test(query) ? "touch" : "maybe";
  return outer === "maybe" || state === "maybe" ? "maybe" : state === "touch" || outer === "touch" ? "touch" : "always";
}

/** Style rules in source order. @media is read with its state; @supports and @container count as maybe; other at-rules are skipped. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (text: string, when: When): void => {
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
      else if (/^@(supports|container)\b/.test(prelude)) walk(body, when === "never" ? "never" : "maybe");
      else if (/^@layer\b/.test(prelude)) walk(body, when);
      else if (!prelude.startsWith("@")) {
        const declarations: [string, string][] = [...body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)].map((m) => [
          m[1] ?? "",
          (m[2] ?? "").trim(),
        ]);
        rules.push({ selector: prelude, declarations, when, order: rules.length });
      }
      i = j;
    }
  };
  walk(stripComments(css), "always");
  return rules;
}

/** The parts of one selector, split at combinators outside brackets and parentheses; the last is the one that must be the field. */
function compounds(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector.trim()) {
    if ("([".includes(ch)) depth += 1;
    if (")]".includes(ch)) depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (current) parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** Specificity as a comparable number: ids, then classes, attributes and pseudo-classes, then element names. */
function specificity(selector: string): number {
  const flat = selector.replace(/:where\([^)]*\)/g, "").replace(/:(not|is|has)\(/g, "(");
  const ids = (flat.match(/#[\w-]+/g) ?? []).length;
  const classes = (flat.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g) ?? []).length;
  const types = compounds(flat).filter((c) => /^[a-z]/i.test(c)).length;
  return ids * 10000 + classes * 100 + types;
}

/** Whether `selector`'s subject can be this field, and whether it needs a state (a pseudo-class) to apply. */
function matchesField(selector: string, field: Field): { state: boolean } | null {
  const subject = compounds(selector).at(-1) ?? "";
  if (/::|:(before|after|first-line|first-letter)\b/.test(subject)) return null; // a pseudo-element is not the field's text
  const state = /(?<!:):[\w-]+/.test(subject);
  const bare = subject.replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, "");
  const type = /^[a-z][\w-]*|^\*/i.exec(bare)?.[0];
  if (type && type !== "*" && type.toLowerCase() !== field.tag) return null;
  for (const klass of bare.match(/\.[\w-]+/g) ?? []) if (!field.classes.includes(klass.slice(1))) return null;
  if (field.tag !== "input" && /\[\s*type\b/.test(bare)) return null;
  return { state };
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

interface Candidate {
  rule: Rule;
  specificity: number;
  /** The font size the rule leaves: null when a `font` shorthand after the size, or `font: inherit` alone, makes it unknown. */
  size: string | null;
  important: boolean;
  optional: boolean;
}

/** The font size a rule leaves, read in source order: `font-size` sets it, and any `font` shorthand resets it to unknown. */
function ruleSize(rule: Rule): { size: string | null; important: boolean } | null {
  let result: { size: string | null; important: boolean } | null = null;
  for (const [property, value] of rule.declarations) {
    if (property === "font-size") result = { size: value, important: value.includes("!important") };
    else if (property === "font") result = { size: null, important: value.includes("!important") };
  }
  return result;
}

/**
 * The smallest font size, in px, a field can have on a touch screen under `css`. Rules that always apply are fixed;
 * rules that only may apply (a pseudo-class, a media query a touch device can also meet) are tried on and off in every
 * combination, and each combination's winner is found by !important, then specificity, then source order.
 */
function touchFloor(css: string, field: Field): { px: number | null; why: string } {
  const candidates: Candidate[] = [];
  for (const rule of parseRules(css)) {
    if (rule.when === "never") continue;
    const sized = ruleSize(rule);
    if (!sized) continue;
    for (const selector of rule.selector.split(",")) {
      const match = matchesField(selector, field);
      if (!match) continue;
      candidates.push({
        rule,
        specificity: specificity(selector),
        size: sized.size,
        important: sized.important,
        optional: match.state || rule.when === "maybe",
      });
    }
  }
  const required = candidates.filter((c) => !c.optional);
  const optional = candidates.filter((c) => c.optional);
  if (required.length === 0) return { px: null, why: `.${field.klass} has no font-size rule that always applies` };
  if (optional.length > 14) return { px: null, why: `.${field.klass} has too many conditional rules to check` };
  let floor: number | null = Number.POSITIVE_INFINITY;
  let why = "";
  for (let mask = 0; mask < 1 << optional.length; mask += 1) {
    const active = [...required, ...optional.filter((_, bit) => mask & (1 << bit))];
    active.sort(
      (a, b) =>
        Number(a.important) - Number(b.important) || a.specificity - b.specificity || a.rule.order - b.rule.order,
    );
    const winner = active.at(-1) as Candidate;
    const px = winner.size === null ? null : lowerBound(winner.size);
    if (px === null || px < (floor ?? 0)) {
      floor = px;
      why = `the winner can be \`${winner.rule.selector} { ${winner.size ?? "font"} }\` (specificity ${winner.specificity})`;
      if (px === null) break;
    }
  }
  return { px: floor, why };
}

// ---- Tests -----------------------------------------------------------------------------------------------------

const fields = findFields(sourceFiles());
const fieldOf = (klass: string): Field => {
  const found = fields.find((f) => f.klass === klass);
  assert.ok(found, `no field with class ${klass}`);
  return found;
};
const floorOf = (css: string, klass: string) => touchFloor(css, fieldOf(klass)).px;
const below = (css: string, klass: string) => {
  const px = floorOf(css, klass);
  return px === null || px < MIN_PX;
};

test("the scan finds the book's fields: the notes' textareas and the search box", () => {
  for (const klass of ["notes-pop__field", "notes-dialog__field", "search-box__input"]) {
    assert.ok(
      fields.some((f) => f.klass === klass),
      `the scan missed .${klass} (found ${fields.map((f) => f.klass)})`,
    );
  }
});

test("every text field the book creates is at least 16px on a touch screen", () => {
  for (const { klass } of fields) {
    const { px, why } = touchFloor(componentsCss, fieldOf(klass));
    assert.ok(
      px !== null && px >= MIN_PX,
      `.${klass} is not proved to be at least ${MIN_PX}px on touch: ${why} (${px})`,
    );
  }
});

test("the checker fails a later or more specific rule that shrinks a field again", () => {
  assert.ok(below(`${componentsCss}\n.notes-pop .notes-pop__field { font-size: 15.5px; }\n`, "notes-pop__field"));
  assert.ok(below(`${componentsCss}\n.search-box__input { font-size: 0.75rem; }\n`, "search-box__input"));
  const media = /@media \(any-pointer: coarse\) \{[\s\S]*?\n\}\n/.exec(componentsCss)?.[0] ?? "";
  assert.ok(media.includes("max(1rem"), "the touch block was not found");
  const moved = `${media}\n${componentsCss.replace(media, "")}`;
  assert.ok(below(moved, "notes-dialog__field"), "a touch block moved above the base went unnoticed");
});

test("the checker fails a rule that applies only in some states or to some devices that a touch device can be", () => {
  const append = (rule: string) => `${componentsCss}\n${rule}\n`;
  // An iPad with a mouse matches any-pointer: coarse and pointer: fine, or hover: hover, at once.
  assert.ok(below(append("@media (pointer: fine) { .notes-pop__field { font-size: 12px; } }"), "notes-pop__field"));
  assert.ok(
    below(append("@media (any-pointer: fine) { .notes-dialog__field { font-size: 12px; } }"), "notes-dialog__field"),
  );
  assert.ok(below(append("@media (hover: hover) { .search-box__input { font-size: 12px; } }"), "search-box__input"));
  // Focus is when iOS zooms; the other pseudo-classes and :not() count too.
  for (const state of [":focus", ":hover", ":active", ":focus-visible", ":not(:disabled)"]) {
    assert.ok(below(append(`.notes-pop__field${state} { font-size: 12px; }`), "notes-pop__field"), state);
  }
  assert.ok(below(append(".notes-dialog__field:focus { font-size: 0.75rem; }"), "notes-dialog__field"));
  // Element and attribute selectors that match a field count, with their specificity.
  assert.ok(below(append("textarea { font-size: 12px !important; }"), "notes-pop__field"));
  assert.ok(below(append("input[type=search] { font-size: 12px !important; }"), "search-box__input"));
  assert.ok(below(append("textarea.notes-dialog__field { font-size: 12px; }"), "notes-dialog__field"));
  // A raise that only a primary pointer or a hover-less device gets does not protect an iPad with a mouse.
  const narrow = componentsCss.replace("@media (any-pointer: coarse) {", "@media (pointer: coarse) {");
  assert.notEqual(narrow, componentsCss);
  assert.ok(below(narrow, "search-box__input"));
});

test("the checker reads a font shorthand after font-size as a reset", () => {
  const reset = componentsCss.replace(
    "font-size: max(1rem, var(--size-note));",
    "font-size: max(1rem, var(--size-note));\n    font: inherit;",
  );
  assert.notEqual(reset, componentsCss);
  assert.ok(below(reset, "search-box__input"));
  const before = componentsCss.replace(
    "font-size: max(1rem, var(--size-note));",
    "font: inherit;\n    font-size: max(1rem, var(--size-note));",
  );
  assert.ok(!below(before, "search-box__input"), "font before font-size is not a reset");
});

test("the checker ignores rules that cannot affect a field's typed text", () => {
  const append = (rule: string) => `${componentsCss}\n${rule}\n`;
  assert.ok(!below(append(".search-box__input::placeholder { font-size: 12px; }"), "search-box__input"));
  assert.ok(!below(append("@media print { .notes-pop__field { font-size: 8px; } }"), "notes-pop__field"));
  assert.ok(
    !below(append("select { font-size: 12px !important; }"), "notes-pop__field"),
    "a select rule is not a textarea's",
  );
  assert.ok(!below(append(".other-class { font-size: 12px; }"), "notes-pop__field"));
});

test("the checker accepts any way to reach 16px and rejects values it cannot prove", () => {
  const plain = componentsCss.replace("font-size: max(1rem, var(--size-note));", "font-size: 16px;");
  assert.notEqual(plain, componentsCss);
  assert.equal(floorOf(plain, "search-box__input"), 16);
  const unknown = componentsCss.replace("font-size: max(1rem, var(--size-note));", "font-size: 1em;");
  assert.equal(floorOf(unknown, "search-box__input"), null);
  assert.equal(lowerBound("clamp(0.875rem, 0.8505rem + 0.1087vw, 0.9375rem)"), 14);
  assert.equal(lowerBound("max(1rem, var(--size-note))"), 16);
});

test("the viewport meta forbids no zoom", () => {
  const layout = readFileSync(new URL("src/layouts/BaseLayout.astro", root), "utf8");
  const meta = /<meta name="viewport" content="([^"]*)"/.exec(layout)?.[1];
  assert.ok(meta, "BaseLayout has no viewport meta");
  assert.doesNotMatch(meta, /maximum-scale|minimum-scale|user-scalable/);
});
