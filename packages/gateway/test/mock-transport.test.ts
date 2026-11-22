// mockTransport() records the requests it receives, and that record never holds a credential: a test that prints or
// snapshots `requests` must not leak the key an adapter sent.
import assert from "node:assert/strict";
import { mockTransport, REDACTED } from "@buildanagent/gateway/testing";
import { test } from "vitest";

const KEY = "sk-test-not-a-real-key";
const ANSWER = { status: 200, body: "data: [DONE]\n\n" } as const;

test("mockTransport() redacts credential headers in the requests it records", async () => {
  const transport = mockTransport("anthropic-messages", [ANSWER]);
  await transport(
    new Request("https://api.example.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        authorization: `Bearer ${KEY}`,
        cookie: `session=${KEY}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "m" }),
    }),
  );
  const [recorded] = transport.requests;
  assert.equal(recorded?.headers["x-api-key"], REDACTED);
  assert.equal(recorded?.headers.authorization, REDACTED);
  assert.equal(recorded?.headers.cookie, REDACTED);
  assert.equal(recorded?.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(recorded?.body, { model: "m" });
  assert.ok(!JSON.stringify(transport.requests).includes(KEY), "no recorded request holds the key");
});

test("mockTransport() redacts a key in the query string and still records a request it refuses", async () => {
  const transport = mockTransport("openai-chat", []);
  await assert.rejects(
    transport(new Request(`https://api.example.com/chat/completions?key=${KEY}`, { headers: { authorization: KEY } })),
    { code: "unexpected_request" },
  );
  assert.ok(!JSON.stringify(transport.requests).includes(KEY), "no recorded request holds the key");
  assert.equal(transport.requests.length, 1);
});
