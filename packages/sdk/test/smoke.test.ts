import "@agent-speak/gateway/testing/setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { GATEWAY_PACKAGE } from "@agent-speak/gateway";
import { SDK_PACKAGE } from "@agent-speak/sdk";

test("the SDK imports by its package name", () => {
  assert.equal(SDK_PACKAGE, "@agent-speak/sdk");
});

test("the SDK resolves the gateway through its workspace dependency", () => {
  assert.equal(GATEWAY_PACKAGE, "@agent-speak/gateway");
});

test("the shared setup guards fetch in SDK tests too", async () => {
  await assert.rejects(() => fetch("https://example.com"), /Blocked outbound request/);
});
