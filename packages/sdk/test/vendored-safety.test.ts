import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// The SDK carries a copy of the safety package's outcome files until that package is published. A copy that drifts
// would show the model different outcome text from the safety package's own adapters.
const vendored = new URL("../src/vendor/agent-safety/", import.meta.url);
const source = new URL("../../agent-safety/src/", import.meta.url);

test("each vendored safety file is identical to its source in the safety package", () => {
  const files = readdirSync(vendored).filter((name) => name.endsWith(".ts"));
  assert.deepEqual(files.sort(), ["errors.ts", "outcome.ts", "render.ts"]);
  for (const file of files) {
    const copy = readFileSync(new URL(file, vendored), "utf8");
    assert.equal(copy, readFileSync(new URL(file, source), "utf8"), `src/vendor/agent-safety/${file} has drifted`);
  }
});
