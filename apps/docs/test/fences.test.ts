import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { isTypeScriptLang, pagePaths, readPages } from "../src/plugins/pages.js";
import { showsTypeScriptThroughCode } from "./code-component.js";
import { EXCEPTIONS } from "./exceptions.js";

// Every TypeScript block on a docs page comes from a tested example file, so the docs never show code that no
// package test runs. A page that must show a block of its own lists it in exceptions.ts with the reason.

const typescriptFences = readPages().flatMap((page) =>
  page.fences
    .filter((fence) => isTypeScriptLang(fence.lang))
    .map((fence, index) => ({ page: page.path, fence, key: `${page.path}#${index + 1}` })),
);

test("the pages have TypeScript blocks, so the rule below is not vacuous", () => {
  assert.ok(typescriptFences.length > 0);
});

test("every TypeScript block on a docs page has a file fence from an examples folder", () => {
  const bare = typescriptFences
    .filter(({ fence }) => parseExampleRef(fence.meta) === undefined)
    .filter(({ key }) => !EXCEPTIONS.has(key))
    .map(({ page, fence }) => `${page}:${fence.line}`);
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
  const where = new Set(typescriptFences.map(({ key }) => key));
  for (const key of EXCEPTIONS.keys()) {
    assert.ok(
      where.has(key),
      `${key} names no TypeScript block: keys are "<page path>#<n>", the n-th block on the page`,
    );
  }
});

test("the language check ignores case", () => {
  for (const lang of ["ts", "TS", "TypeScript", "tsx", "MTS", "cts"]) assert.ok(isTypeScriptLang(lang), lang);
  for (const lang of ["js", "json", "bash", ""]) assert.ok(!isTypeScriptLang(lang), lang);
});

test("no docs page shows TypeScript through a Code component", () => {
  const found = pagePaths().filter((path) => showsTypeScriptThroughCode(readFileSync(path, "utf8")));
  assert.deepEqual(
    found,
    [],
    'use a ts fence with file="packages/<pkg>/examples/<file>.ts" instead of a Code component',
  );
});

test("the Code component check finds a ts lang prop, however it is written", () => {
  for (const tag of [
    '<Code code="x" lang="ts" />',
    "<Code lang='TypeScript' code={x} />",
    '<Code lang={"tsx"} />',
    '<Code code={fn((a) => a)} lang="ts" />',
    '<Code code={`a > b`} lang="ts">',
    "<Code\n  code={{ a: 1 }}\n  lang={ 'ts' }\n/>",
  ]) {
    assert.ok(showsTypeScriptThroughCode(tag), tag);
  }
  for (const tag of [
    '<Code code="x" lang="json" />',
    '<Code code={fn((a) => a)} lang="bash" />',
    '<Codex lang="ts" />',
  ]) {
    assert.ok(!showsTypeScriptThroughCode(tag), tag);
  }
});
