import assert from "node:assert/strict";
import { totalInput } from "@buildanagent/gateway";
import { SDK_PACKAGE } from "@buildanagent/sdk";
import { test } from "vitest";

test("the SDK imports by its package name", () => {
  assert.equal(SDK_PACKAGE, "@buildanagent/sdk");
});

test("the SDK resolves the gateway through its workspace dependency", () => {
  assert.equal(typeof totalInput, "function");
});

test("the shared setup guards fetch in SDK tests too", async () => {
  await assert.rejects(() => fetch("https://example.com"), /Blocked outbound request/);
});
