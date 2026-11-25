import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACKAGE_NAME } from "@buildanagent/harness";
import { test } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// The export entries the harness plan lists in §3.1 (docs/plans/build-harness.md), in its order. A later todo that
// adds a subpath adds it here, to the plan and to both exports maps.
const PLANNED_ENTRIES = [
  ".",
  "./session",
  "./session/jsonl",
  "./context",
  "./context/file",
  "./tools",
  "./mcp",
  "./permissions",
  "./sandbox",
  "./sandbox/srt",
  "./sandbox/docker",
  "./sandbox/e2b",
  "./credentials",
  "./cloudflare",
  "./extensions",
  "./extensions/node",
  "./memory",
  "./memory/node",
  "./telemetry",
  "./server",
  "./aws/dynamodb",
  "./aws/scheduler",
  "./aws/secrets-manager",
  "./ablation",
  "./vercel",
  "./vercel/workflow",
  "./testing",
];

test("the package imports by its own name", () => {
  assert.equal(PACKAGE_NAME, "@buildanagent/harness");
  assert.equal(manifest.name, PACKAGE_NAME);
});

test("the shared setup blocks a non-loopback fetch", async () => {
  await assert.rejects(() => fetch("https://example.com"), /Blocked outbound request to example\.com/);
});

test("both exports maps hold exactly the entries the plan lists", () => {
  assert.deepEqual(Object.keys(manifest.exports), PLANNED_ENTRIES);
  assert.deepEqual(Object.keys(manifest.publishConfig.exports), PLANNED_ENTRIES);
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
