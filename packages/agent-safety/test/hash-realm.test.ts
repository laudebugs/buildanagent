import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { canonicalInputHash } from "@buildanagent/agent-safety";
import { test } from "vitest";

// Apart from hash.test.ts because it makes a second realm with `node:vm`, which workerd doesn't implement.
test("a plain object from another realm hashes like one from this realm", async () => {
  assert.equal(
    await canonicalInputHash(runInNewContext("({ b: [1], a: 2 })")),
    await canonicalInputHash({ a: 2, b: [1] }),
  );
});
