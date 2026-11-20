import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACKAGE_NAME } from "@buildanagent/harness";
import { test } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the package imports by its own name", () => {
  assert.equal(PACKAGE_NAME, "@buildanagent/harness");
  assert.equal(manifest.name, PACKAGE_NAME);
});

test("the shared setup blocks a non-loopback fetch", async () => {
  await assert.rejects(() => fetch("https://example.com"), /Blocked outbound request to example\.com/);
});

test("every subpath in the exports map resolves to its stub module", async () => {
  const entries = Object.keys(manifest.exports).filter((key) => key !== ".");
  assert.ok(entries.length > 0);
  for (const key of entries) {
    const specifier = `@buildanagent/harness/${key.slice(2)}`;
    const url = import.meta.resolve(specifier);
    assert.match(url, /\/src\//, `${specifier} resolves to src/ through the source condition`);
    await import(specifier);
  }
});
