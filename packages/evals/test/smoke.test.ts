import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACKAGE_NAME } from "@buildanagent/evals";
import { test } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the package imports by its own name", () => {
  assert.equal(PACKAGE_NAME, "@buildanagent/evals");
  assert.equal(manifest.name, PACKAGE_NAME);
});

test("the shared setup blocks a non-loopback fetch", async () => {
  await assert.rejects(() => fetch("https://example.com"), /Blocked outbound request to example\.com/);
});
