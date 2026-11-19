import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// The SDK carries a copy of the safety package's outcome, hash, signer and pending-record files until that package is
// published. A copy that drifts would show the model different outcome text, or sign a payload the package's own
// verifier rejects.
const vendored = new URL("../src/vendor/agent-safety/", import.meta.url);
// Found through the declared dev dependency: its root entry resolves to src/index.ts under the workspace's `source`
// condition, or to dist/index.js without it, and src/ sits beside either.
const entry = import.meta.resolve("@buildanagent/agent-safety");
const source = new URL(entry.includes("/src/") ? "./" : "../src/", entry);

test("each vendored safety file is identical to its source in the safety package", () => {
  const files = readdirSync(vendored).filter((name) => name.endsWith(".ts"));
  assert.deepEqual(files.sort(), [
    "bytes.ts",
    "errors.ts",
    "hash.ts",
    "outcome.ts",
    "pending.ts",
    "render.ts",
    "signer.ts",
  ]);
  for (const file of files) {
    const copy = readFileSync(new URL(file, vendored), "utf8");
    assert.equal(copy, readFileSync(new URL(file, source), "utf8"), `src/vendor/agent-safety/${file} has drifted`);
  }
});
