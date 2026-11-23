import assert from "node:assert/strict";
import { test } from "vitest";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { readPages } from "../src/plugins/pages.js";

// Every TypeScript block on a docs page comes from a tested example file, so the docs never show code that no
// package test runs. A page that must show a block of its own lists it here with the reason; today none does.
const TYPESCRIPT = ["ts", "tsx", "typescript", "mts", "cts"];
const EXCEPTIONS: ReadonlyMap<string, string> = new Map();

const typescriptFences = readPages().flatMap((page) =>
  page.fences.filter((fence) => TYPESCRIPT.includes(fence.lang)).map((fence) => ({ page: page.path, fence })),
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
