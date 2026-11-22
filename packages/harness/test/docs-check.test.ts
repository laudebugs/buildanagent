import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
// @ts-expect-error: the check script is plain JavaScript and ships no types.
import { blocksNotFromExamples, checkPackage, declarationExports } from "../../../scripts/package-docs.mjs";
// @ts-expect-error: the check script is plain JavaScript and ships no types.
import { CONFIG, PACKAGE_DIR } from "../scripts/docs-check.mjs";

// One run of every check: it emits the declarations and type-checks the README's blocks, so it takes seconds.
const result = checkPackage(PACKAGE_DIR, CONFIG);

test("every TypeScript block in the README type-checks, and every export name it documents exists", {
  timeout: 60_000,
}, () => {
  assert.ok(result.blocks > 0);
  assert.deepEqual(result.problems, []);
});

test("llms.txt is built from this commit's README and declarations", () => {
  assert.equal(
    readFileSync(new URL("../llms.txt", import.meta.url), "utf8"),
    result.llms,
    "run `node packages/harness/scripts/docs-check.mjs --write`",
  );
});

test("llms.txt lists every public export of every entry point", { timeout: 60_000 }, () => {
  for (const { specifier, exports } of declarationExports(PACKAGE_DIR)) {
    const section = result.llms.split(`## Exports from \`${specifier}\``)[1]?.split("\n## ")[0] ?? "";
    for (const { name } of exports) assert.match(section, new RegExp(`\`(?:\\w+ )?${name}(?:\\(\\))?\``), name);
  }
});

test("a block of more than five lines must come from examples/, word for word", () => {
  const example = readFileSync(new URL("../examples/audit-extension.ts", import.meta.url), "utf8").split("\n");
  const taken = example.slice(10, 16).join("\n");
  const changed = taken.replace("registry", "tools");
  const short = example.slice(10, 15).join("\n").replace("registry", "tools");
  const blocks = [taken, changed, short].map((code, i) => ({ line: i + 1, code }));
  assert.deepEqual(blocksNotFromExamples(PACKAGE_DIR, blocks), [
    "README block at line 2: over 5 lines, and no file in examples/ holds it",
  ]);
});
