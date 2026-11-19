import "@buildanagent/gateway/testing/setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as gateway from "@buildanagent/gateway";
import { assertNoProviderKeys, guardedFetch, isLoopbackHost } from "@buildanagent/gateway/testing";

test("the gateway imports by its package name", () => {
  assert.equal(typeof gateway.complete, "function");
});

test("the installed guard blocks fetch to a non-loopback host", async () => {
  await assert.rejects(() => fetch("https://example.com"), /Blocked outbound request to example\.com/);
});

test("the guard lets loopback requests through to the inner fetch", async () => {
  const seen: string[] = [];
  const inner: typeof fetch = async (input) => {
    seen.push(String(input));
    return new Response("ok");
  };
  const response = await guardedFetch(inner)("http://127.0.0.1:9/ping");
  assert.equal(await response.text(), "ok");
  assert.deepEqual(seen, ["http://127.0.0.1:9/ping"]);
});

test("loopback detection covers localhost, 127.0.0.0/8 and ::1 only", () => {
  for (const host of ["localhost", "api.localhost", "127.0.0.1", "127.8.9.10", "[::1]", "LOCALHOST"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["example.com", "127.0.0.1.example.com", "10.0.0.1", "api.anthropic.com", "localhost.evil"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test("a provider key variable fails the run", () => {
  assert.throws(() => assertNoProviderKeys({ ANTHROPIC_API_KEY: "sk-test" }), /ANTHROPIC_API_KEY/);
  assert.throws(() => assertNoProviderKeys({ OPENAI_API_KEY: "sk-test" }), /OPENAI_API_KEY/);
  assert.doesNotThrow(() => assertNoProviderKeys({ ANTHROPIC_API_KEY: "" }));
});
