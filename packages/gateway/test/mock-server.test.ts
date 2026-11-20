// startMockServer(): a loopback-only HTTP server that plays a mockTransport() script, logs each request as a JSON
// line with its credentials redacted, and refuses requests its script didn't expect.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel, isGatewayError, type ModelContext } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import {
  isCredentialName,
  REDACTED,
  redactHeaders,
  redactUrl,
  startMockServer,
  stripCredentials,
} from "@buildanagent/gateway/testing";
import { test } from "vitest";

const KEY = "sk-test-not-a-real-key";
const TEXT_SSE = readFileSync(
  fileURLToPath(new URL("./fixtures/anthropic-messages/text.sse", import.meta.url)),
  "utf8",
);
const hello: ModelContext = {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  tools: [],
};

function logFile(): string {
  return join(mkdtempSync(join(tmpdir(), "mock-server-")), "requests.jsonl");
}

for (const host of ["0.0.0.0", "::", "192.168.1.20", "localhost", "example.com"]) {
  test(`startMockServer() refuses to bind to ${host}`, async () => {
    await assert.rejects(
      startMockServer({ api: "anthropic-messages", script: [], host }),
      (error: unknown) => isGatewayError(error) && error.code === "invalid_options",
    );
  });
}

test("startMockServer() binds to 127.0.0.1 by default and answers the adapter's request over the socket", async () => {
  const server = await startMockServer({ api: "anthropic-messages", script: [{ body: TEXT_SSE, chunkSize: 9 }] });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const adapter = anthropic({ apiKey: KEY, baseURL: server.url, transport: server.transport });
    const message = await createModel({ adapter, id: "claude-opus-5-5", retries: 0 }).complete(hello);
    assert.equal(message.stopReason, "stop");
    assert.deepEqual(message.content, [{ type: "text", text: "Héllo, wörld ✓" }]);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0]?.method, "POST");
  } finally {
    await server.close();
  }
});

test("startMockServer() writes one JSON line per request and never writes the API key", async () => {
  const log = logFile();
  const server = await startMockServer({ api: "anthropic-messages", script: [{ body: TEXT_SSE }], log });
  try {
    const adapter = anthropic({ apiKey: KEY, baseURL: server.url, transport: server.transport });
    await createModel({ adapter, id: "claude-opus-5-5", retries: 0 }).complete(hello);
  } finally {
    await server.close();
  }
  const text = readFileSync(log, "utf8");
  assert.ok(!text.includes(KEY), "the log holds no credential");
  const lines = text.trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0] ?? "{}");
  assert.equal(entry.headers["x-api-key"], REDACTED);
  assert.equal(entry.body.system[0].text, "You are terse.");
  assert.ok(!JSON.stringify(server.requests).includes(KEY), "the in-memory requests hold no credential");
});

test("startMockServer() serves a plain fetch client and redacts its authorization and cookie headers", async () => {
  const server = await startMockServer({ api: "anthropic-messages", script: [{ body: TEXT_SSE }] });
  try {
    const response = await fetch(`${server.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, cookie: `session=${KEY}` },
      body: JSON.stringify({ model: "claude-opus-5-5", messages: [] }),
    });
    assert.equal(response.status, 200);
    assert.equal(server.requests[0]?.headers.authorization, REDACTED);
    assert.equal(server.requests[0]?.headers.cookie, REDACTED);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(await response.text(), TEXT_SSE);
  } finally {
    await server.close();
  }
});

test("startMockServer() answers a request its script didn't expect with a 400 and still logs it", async () => {
  const log = logFile();
  const server = await startMockServer({ api: "anthropic-messages", script: [], log });
  try {
    const wrongPath = await fetch(`${server.url}/v1/complete`, { method: "POST", body: "{}" });
    assert.equal(wrongPath.status, 400);
    const body = (await wrongPath.json()) as { error: { type: string } };
    assert.equal(body.error.type, "unexpected_request");
    const pastScript = await fetch(`${server.url}/v1/messages`, { method: "POST", body: "{}" });
    assert.equal(pastScript.status, 400);
  } finally {
    await server.close();
  }
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
});

test("the server's transport refuses every URL outside the server", async () => {
  const server = await startMockServer({ api: "anthropic-messages", script: [] });
  try {
    await assert.rejects(
      server.transport(new Request("http://127.0.0.1:1/v1/messages", { method: "POST" })),
      (error: unknown) => isGatewayError(error) && error.code === "unexpected_request",
    );
  } finally {
    await server.close();
  }
});

test("isCredentialName() matches the credential headers in any case and spelling", () => {
  for (const name of ["Authorization", "X-Api-Key", "x_api_key", "xApiKey", "apiKey", "api-key", "X-Goog-Api-Key"]) {
    assert.ok(isCredentialName(name), name);
  }
  for (const name of ["Proxy-Authorization", "cf-aig-authorization", "Cookie", "Set-Cookie"]) {
    assert.ok(isCredentialName(name), name);
  }
  for (const name of ["content-type", "anthropic-version", "key", "author"]) assert.ok(!isCredentialName(name), name);
});

test("redactHeaders() keeps the names and replaces only the credential values", () => {
  assert.deepEqual(redactHeaders({ "X-Api-Key": KEY, "Content-Type": "application/json" }), {
    "x-api-key": REDACTED,
    "content-type": "application/json",
  });
});

test("stripCredentials() leaves out credential properties at any depth and keeps the rest", () => {
  const stripped = stripCredentials({
    providerOptions: { headers: { Authorization: KEY, "x-goog-api-key": KEY, accept: "text/plain" }, apiKey: KEY },
    list: [{ cookie: KEY, keep: 1 }],
  });
  assert.deepEqual(stripped, { providerOptions: { headers: { accept: "text/plain" } }, list: [{ keep: 1 }] });
});

test("startMockServer() redacts a key sent in the query string, in the log, requests and the 400 body", async () => {
  const log = logFile();
  const server = await startMockServer({ api: "openai-chat", script: [{ body: "data: [DONE]\n\n" }], log });
  try {
    const ok = await fetch(`${server.url}/v1/chat/completions?key=${KEY}&api_key=${KEY}&alt=sse`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(ok.status, 200);
    await ok.text();
    const refused = await fetch(`${server.url}/v1/other?access_token=${KEY}`, { method: "POST", body: "{}" });
    assert.equal(refused.status, 400);
    assert.ok(!(await refused.text()).includes(KEY), "the error body holds no key");
  } finally {
    await server.close();
  }
  assert.ok(!readFileSync(log, "utf8").includes(KEY), "the log holds no key");
  assert.ok(!JSON.stringify(server.requests).includes(KEY), "the requests hold no key");
  assert.match(server.requests[0]?.url ?? "", /alt=sse/);
});

test("startMockServer() logs each of several concurrent requests once, each with its own body", async () => {
  const log = logFile();
  const script = Array.from({ length: 8 }, () => ({ body: TEXT_SSE }));
  const server = await startMockServer({ api: "anthropic-messages", script, log });
  try {
    await Promise.all(
      script.map(async (_, i) => {
        const response = await fetch(`${server.url}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ n: i, pad: "x".repeat((8 - i) * 4096) }),
        });
        await response.text();
      }),
    );
  } finally {
    await server.close();
  }
  const logged = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { body: { n: number } }).body.n);
  assert.deepEqual(
    [...logged].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    server.requests.map((request) => (request.body as { n: number }).n),
    logged,
  );
});

test("startMockServer() answers with a 400 when it can't write its log, and keeps serving", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "mock-server-")), "missing", "requests.jsonl");
  const script = [{ body: TEXT_SSE }, { body: TEXT_SSE }];
  const server = await startMockServer({ api: "anthropic-messages", script, log });
  try {
    for (let i = 0; i < 2; i += 1) {
      const response = await fetch(`${server.url}/v1/messages`, { method: "POST", body: "{}" });
      assert.equal(response.status, 400);
      await response.text();
    }
  } finally {
    await server.close();
  }
});

test("redactUrl() redacts userinfo and key-carrying query parameters and leaves other URLs as written", () => {
  const redacted = encodeURIComponent(REDACTED);
  assert.equal(
    redactUrl(`https://user:${KEY}@example.com/v1?key=${KEY}&model=m`),
    `https://${redacted}:${redacted}@example.com/v1?key=${redacted}&model=m`,
  );
  assert.ok(!redactUrl(`https://example.com/?apiKey=${KEY}&X-Goog-Api-Key=${KEY}`).includes(KEY));
  assert.equal(redactUrl("https://example.com"), "https://example.com");
  assert.equal(redactUrl("not a url"), "not a url");
});

test("stripCredentials() drops credential tuples and Headers entries and redacts bearer strings and URL keys", () => {
  const stripped = stripCredentials({
    tuples: [
      ["Authorization", `Bearer ${KEY}`],
      ["accept", "text/plain"],
    ],
    headers: new Headers({ "x-api-key": KEY, accept: "text/plain" }),
    nested: { body: { note: `Bearer ${KEY}`, client_secret: KEY, sessionToken: KEY } },
    endpoint: `https://example.com/v1?key=${KEY}`,
  });
  assert.ok(!JSON.stringify(stripped).includes(KEY));
  assert.deepEqual(stripped.tuples, [["accept", "text/plain"]]);
  assert.deepEqual(stripped.headers, { accept: "text/plain" });
  assert.deepEqual(stripped.nested, { body: { note: REDACTED } });
});

test("isCredentialName() matches names that end like a credential, such as x-amz-security-token", () => {
  for (const name of ["x-amz-security-token", "client_secret", "openai-api-key", "password", "accessToken"]) {
    assert.ok(isCredentialName(name), name);
  }
  for (const name of ["maxTokens", "max_output_tokens", "tokenizer"]) assert.ok(!isCredentialName(name), name);
});
