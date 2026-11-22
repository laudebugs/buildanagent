// Runs the README's in-process client: it opens a session and starts a turn, and the dispatcher accepts it.
import assert from "node:assert/strict";
import { test } from "vitest";

test("the in-process client example opens a session and has its turn accepted", async () => {
  const result = await import("../../examples/in-process-client.js");
  assert.equal(typeof result.session, "string");
  assert.equal(result.disposition.accepted, true);
});
