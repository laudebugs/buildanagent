import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { isTypeScriptLang, pagePaths, readPages } from "../src/plugins/pages.js";
import { EXCEPTIONS } from "./exceptions.js";

// Every TypeScript block on a docs page comes from a tested example file, so the docs never show code that no
// package test runs. A page that must show a block of its own lists it in exceptions.ts with the reason.

const typescriptFences = readPages().flatMap((page) =>
  page.fences.filter((fence) => isTypeScriptLang(fence.lang)).map((fence) => ({ page: page.path, fence })),
);

test("the pages have TypeScript blocks, so the rule below is not vacuous", () => {
  assert.ok(typescriptFences.length > 0);
});

test("every TypeScript block on a docs page has a file fence from an examples folder", () => {
  const bare = typescriptFences
    .filter(({ fence }) => parseExampleRef(fence.meta) === undefined)
    .map(({ page, fence }) => `${page}:${fence.line}`)
    .filter((where) => !EXCEPTIONS.has(where));
  assert.deepEqual(
    bare,
    [],
    'a ts block needs file="packages/<pkg>/examples/<file>.ts" and a region from a tested example, or an entry in EXCEPTIONS with its reason',
  );
});

test("every file fence names an example file whose region exists", () => {
  for (const { page, fence } of typescriptFences) {
    const ref = parseExampleRef(fence.meta);
    if (ref !== undefined) assert.ok(exampleSource(ref).length > 0, `${page}:${fence.line} shows no code`);
  }
});

test("a listed exception still names a block that exists", () => {
  const where = new Set(typescriptFences.map(({ page, fence }) => `${page}:${fence.line}`));
  for (const key of EXCEPTIONS.keys()) assert.ok(where.has(key), `${key} is no longer a TypeScript block`);
});

test("the language check ignores case", () => {
  for (const lang of ["ts", "TS", "TypeScript", "tsx", "MTS", "cts"]) assert.ok(isTypeScriptLang(lang), lang);
  for (const lang of ["js", "json", "bash", ""]) assert.ok(!isTypeScriptLang(lang), lang);
});

// MDX can pass code to a component as a prop, as in `<Code code={...} lang="ts" />`. That is no fence, so the rules
// above cannot see it; a page that shows TypeScript uses a file fence instead.
const CODE_COMPONENT = /<Code\b[^>]*?\blang=(?:"([^"]*)"|'([^']*)'|\{["']([^"']*)["']\})/gi;

test("no docs page shows TypeScript through a Code component", () => {
  const found = pagePaths().flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(CODE_COMPONENT)]
      .filter((m) => isTypeScriptLang(m[1] ?? m[2] ?? m[3] ?? ""))
      .map(() => path),
  );
  assert.deepEqual(
    found,
    [],
    'use a ts fence with file="packages/<pkg>/examples/<file>.ts" instead of a Code component',
  );
});

test("the Code component check finds a ts lang prop, however it is written", () => {
  for (const tag of ['<Code code="x" lang="ts" />', "<Code lang='TypeScript' code={x} />", '<Code lang={"tsx"} />']) {
    assert.ok([...tag.matchAll(CODE_COMPONENT)].length === 1, tag);
  }
});
