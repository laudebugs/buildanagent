import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
// @ts-expect-error: the check script is plain JavaScript and ships no types.
import { checkPackage, declarationExports } from "../../../scripts/package-docs.mjs";
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
    "run `node packages/cli/scripts/docs-check.mjs --write`",
  );
});

test("llms.txt lists every public export of every entry point", { timeout: 60_000 }, () => {
  for (const { specifier, exports } of declarationExports(PACKAGE_DIR)) {
    const section = result.llms.split(`## Exports from \`${specifier}\``)[1]?.split("\n## ")[0] ?? "";
    for (const { name } of exports) assert.match(section, new RegExp(`\`(?:\\w+ )?${name}(?:\\(\\))?\``), name);
  }
});
