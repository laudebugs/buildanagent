// Runs the egress-proxy example on loopback with no network: the sandbox gets a placeholder, an unlisted host is
// refused, and the credential's value reaches neither the placeholder nor the log.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { compileEgressPolicy } from "@buildanagent/harness/credentials";
import { test } from "vitest";
import { tryProxy } from "../../examples/egress-proxy.js";

const TOKEN = "FAKE-github-token-for-the-egress-example";
const secret = async () => TOKEN;

test("the sandbox gets a placeholder that is not the credential", async () => {
  const { placeholder } = await tryProxy(secret);
  assert.ok(placeholder !== undefined && placeholder !== TOKEN && !placeholder.includes(TOKEN));
});

test("a host that is not listed is refused with its host and the reason", async () => {
  const { refusal } = await tryProxy(secret);
  assert.equal(refusal, "the egress proxy refused evil.example: not_allowed");
});

test("the refusal is logged with status 403 and no bytes", async () => {
  const { records } = await tryProxy(secret);
  assert.deepEqual(
    records.map(({ kind, host, status, bytes, reason }) => ({ kind, host, status, bytes, reason })),
    [{ kind: "fetch", host: "evil.example", status: 403, bytes: 0, reason: "not_allowed" }],
  );
});

test("the log never holds the credential", async () => {
  const { records } = await tryProxy(secret);
  assert.ok(!JSON.stringify(records).includes(TOKEN));
});

test("a policy that holds a credential-shaped string is refused with invalid_egress_options", () => {
  const policy = { allow: ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"], routes: [] };
  try {
    compileEgressPolicy(policy, { secret });
    assert.fail("the policy should have been refused");
  } catch (error) {
    assert.ok(isHarnessError(error));
    assert.equal(error.code, "invalid_egress_options");
    assert.equal(
      error.message,
      "the egress policy holds what looks like a credential; name it in a route's credential instead",
    );
  }
});
