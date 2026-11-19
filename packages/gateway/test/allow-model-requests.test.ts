import "@buildanagent/gateway/testing/setup";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { assertModelRequestAllowed, modelRequestsAreAllowed, type Transport } from "@buildanagent/gateway";
import { allowModelRequests, ModelRequestsDisabledError, markMockTransport } from "@buildanagent/gateway/testing";

const realTransport: Transport = async () => new Response("never");

afterEach(() => allowModelRequests(false));

test("the shared setup turns real model requests off", () => {
  assert.equal(modelRequestsAreAllowed(), false);
});

test("with requests off, a real transport throws before sending", () => {
  assert.throws(() => assertModelRequestAllowed(realTransport), ModelRequestsDisabledError);
  assert.throws(() => assertModelRequestAllowed(undefined), ModelRequestsDisabledError);
});

test("with requests off, a transport marked as a mock passes", () => {
  const mock = markMockTransport(async () => new Response("ok"));
  assert.doesNotThrow(() => assertModelRequestAllowed(mock));
});

test("allowModelRequests(true) lets a real transport through", () => {
  allowModelRequests(true);
  assert.doesNotThrow(() => assertModelRequestAllowed(realTransport));
});
