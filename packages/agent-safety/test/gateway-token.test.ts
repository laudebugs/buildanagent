// An authenticated Cloudflare AI Gateway (the follow-up to the guard's refusal of `cf-aig-authorization`): `gatewayToken` lets exactly one more credential,
// `cf-aig-authorization`, travel beside the provider key, and only to a Cloudflare AI Gateway host. These tests pin
// both halves: the token is sent, and nothing else rides along. Every transport here records its requests and sends
// nothing.
import assert from "node:assert/strict";
import {
  CLOUDFLARE_GATEWAY_TOKEN_HEADER,
  CREDENTIAL_HEADERS,
  egressGuard,
  isSafetyError,
} from "@buildanagent/agent-safety";
import { explicitProvider } from "@buildanagent/agent-safety/byok";
import { generateText } from "ai";
import { test } from "vitest";
import { egressGuardWebSocket, type GuardableWebSocket } from "../src/egress.js";

const TOKEN = "gateway-token-abc123";
const KEY = "user-anthropic-key";
const GATEWAY = "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/anthropic";
const credential = { header: "x-api-key", value: KEY } as const;

/** A transport that records every request and answers with an empty body. */
function recorder() {
  const requests: { url: string; headers: Record<string, string>; redirect: Request["redirect"] }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: Object.fromEntries(request.headers), redirect: request.redirect });
    return Response.json({});
  };
  return { requests, fetch: transport };
}

function refusal(code: string) {
  return (error: unknown) => {
    assert.ok(isSafetyError(error), `expected a SafetyError, got ${String(error)}`);
    assert.equal(error.code, code);
    for (const secret of [TOKEN, KEY]) assert.ok(!error.message.includes(secret), "the error message holds a secret");
    return true;
  };
}

const post = (guard: typeof fetch, headers: Record<string, string>, url = `${GATEWAY}/messages`) =>
  guard(url, { method: "POST", headers });

test("the guard adds the gateway token beside the provider key, and keeps the no-wholesale header", async () => {
  const transport = recorder();
  const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport.fetch });
  await post(guard, { "x-api-key": KEY });
  assert.equal(transport.requests.length, 1);
  const sent = transport.requests[0]?.headers;
  assert.equal(sent?.["cf-aig-authorization"], `Bearer ${TOKEN}`);
  assert.equal(sent?.["x-api-key"], KEY);
  assert.equal(sent?.["cf-aig-no-wholesale"], "true");
  assert.equal(CLOUDFLARE_GATEWAY_TOKEN_HEADER, "cf-aig-authorization");
});

test("a request that already carries exactly the configured gateway header passes", async () => {
  const transport = recorder();
  const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport.fetch });
  await post(guard, { "x-api-key": KEY, "cf-aig-authorization": `Bearer ${TOKEN}` });
  assert.equal(transport.requests[0]?.headers["cf-aig-authorization"], `Bearer ${TOKEN}`);
});

test("a gateway header with any other value is refused, so no other token can ride along", async () => {
  for (const value of ["Bearer other-token", TOKEN, `bearer ${TOKEN}`, `Bearer ${TOKEN}, Bearer other-token`, ""]) {
    const transport = recorder();
    const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport.fetch });
    await assert.rejects(post(guard, { "x-api-key": KEY, "cf-aig-authorization": value }), refusal("egress_refused"));
    assert.equal(transport.requests.length, 0, `a request with ${JSON.stringify(value)} was sent`);
  }
});

test("with a gateway token set, every other credential header is still refused", async () => {
  const others = CREDENTIAL_HEADERS.filter((name) => name !== "x-api-key" && name !== "cf-aig-authorization");
  assert.ok(others.length >= 4, "the list of credential headers shrank");
  for (const name of others) {
    const transport = recorder();
    const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport.fetch });
    await assert.rejects(post(guard, { "x-api-key": KEY, [name]: "Bearer decoy" }), refusal("egress_refused"), name);
    assert.equal(transport.requests.length, 0, `${name} was sent`);
  }
});

test("without a gateway token, cf-aig-authorization is still refused as a second credential", async () => {
  const transport = recorder();
  const guard = egressGuard({ baseURL: GATEWAY, credential, fetch: transport.fetch });
  await assert.rejects(
    post(guard, { "x-api-key": KEY, "cf-aig-authorization": `Bearer ${TOKEN}` }),
    refusal("egress_refused"),
  );
  assert.equal(transport.requests.length, 0);
});

test("a missing or different provider key is refused even when the gateway token is right", async () => {
  const transport = recorder();
  const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport.fetch });
  await assert.rejects(post(guard, {}), refusal("egress_refused"));
  await assert.rejects(post(guard, { "x-api-key": "decoy-key" }), refusal("egress_refused"));
  assert.equal(transport.requests.length, 0);
});

test("a request to another host or path is refused, so the token reaches only the configured gateway", async () => {
  const transport = recorder();
  const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport.fetch });
  const elsewhere = [
    "https://api.anthropic.com/v1/messages",
    "https://gateway.ai.cloudflare.com.evil.example/v1/account-1/gateway-1/anthropic/messages",
    "https://evil.example/v1/account-1/gateway-1/anthropic/messages",
    "https://gateway.ai.cloudflare.com/v1/account-2/gateway-1/anthropic/messages",
    "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/openai/messages",
  ];
  for (const url of elsewhere) {
    await assert.rejects(post(guard, { "x-api-key": KEY }, url), refusal("egress_refused"), url);
  }
  assert.equal(transport.requests.length, 0, "a request left for another host");
});

test("the guard never follows a redirect, so the token can't reach the redirect's target", async () => {
  const seen: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push(request.url);
    return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
  };
  const guard = egressGuard({ baseURL: GATEWAY, credential, gatewayToken: TOKEN, fetch: transport });
  const response = await post(guard, { "x-api-key": KEY });
  assert.equal(response.status, 302);
  assert.deepEqual(seen, [`${GATEWAY}/messages`]);
});

test("a gateway token needs a Cloudflare AI Gateway base URL, so it can reach no other host", () => {
  const notGateways = [
    "https://api.anthropic.com/v1",
    "https://ai-gateway.vercel.sh/v1",
    "http://127.0.0.1:8787/v1",
    "https://gateway.ai.cloudflare.com.evil.example/v1",
    "https://evil-gateway.ai.cloudflare.com.example/v1",
    "https://notgateway.ai.cloudflare.com.evil.example/v1",
    // On the gateway host, but naming no one gateway, so the token could go to any account's gateway beneath it.
    "https://gateway.ai.cloudflare.com",
    "https://gateway.ai.cloudflare.com/",
    "https://gateway.ai.cloudflare.com/v1",
    "https://gateway.ai.cloudflare.com/v1/account-1",
    "https://gateway.ai.cloudflare.com/v1/account-1/",
    "https://gateway.ai.cloudflare.com/v2/account-1/gateway-1",
  ];
  for (const baseURL of notGateways) {
    assert.throws(
      () => egressGuard({ baseURL, credential, gatewayToken: TOKEN }),
      refusal("invalid_byok_config"),
      baseURL,
    );
    assert.throws(
      () => explicitProvider({ provider: "anthropic", apiKey: KEY, baseURL, gatewayToken: TOKEN }),
      refusal("invalid_byok_config"),
      baseURL,
    );
    assert.throws(
      () => egressGuardWebSocket({ baseURL, credential, gatewayToken: TOKEN }),
      refusal("invalid_byok_config"),
      baseURL,
    );
  }
});

test("an unusable gateway token is refused when the guard is built, and its text never appears", () => {
  for (const gatewayToken of [
    "",
    " ",
    "zq7 secret",
    " zq7secret",
    "zq7secret ",
    "zq7\nsecret",
    "zq7\u0000secret",
    "zq7-tök€n",
    5,
    null,
    {},
  ] as unknown[]) {
    assert.throws(
      () => egressGuard({ baseURL: GATEWAY, credential, gatewayToken: gatewayToken as string }),
      (error: unknown) => {
        refusal("invalid_byok_config")(error);
        const text = typeof gatewayToken === "string" && gatewayToken.length > 1 ? gatewayToken : "";
        assert.ok(text === "" || !(error as Error).message.includes(text), "the message holds the rejected token");
        return true;
      },
      JSON.stringify(gatewayToken),
    );
  }
});

test("explicitProvider sends the gateway token and the provider key and nothing else, for each provider", async () => {
  const anthropic = recorder();
  await generateText({
    model: explicitProvider({
      provider: "anthropic",
      apiKey: KEY,
      baseURL: GATEWAY,
      gatewayToken: TOKEN,
      fetch: anthropic.fetch,
    }).languageModel("claude-test"),
    prompt: "Hi",
  }).catch(() => undefined);
  const openai = recorder();
  await generateText({
    model: explicitProvider({
      provider: "openai",
      apiKey: "user-openai-key",
      baseURL: "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/openai",
      gatewayToken: TOKEN,
      fetch: openai.fetch,
    }).languageModel("gpt-test"),
    prompt: "Hi",
  }).catch(() => undefined);
  assert.ok(anthropic.requests.length > 0 && openai.requests.length > 0, "a provider sent no request");
  for (const { requests, key } of [
    { requests: anthropic.requests, key: { "x-api-key": KEY } },
    { requests: openai.requests, key: { authorization: "Bearer user-openai-key" } },
  ]) {
    for (const request of requests) {
      assert.equal(request.headers["cf-aig-authorization"], `Bearer ${TOKEN}`);
      for (const [name, value] of Object.entries(key)) assert.equal(request.headers[name], value);
      const credentialsSent = CREDENTIAL_HEADERS.filter((name) => name in request.headers).sort();
      assert.deepEqual(credentialsSent, [...Object.keys(key), "cf-aig-authorization"].sort());
    }
  }
});

test("an OpenAI WebSocket handshake carries the gateway token, and refuses any other value", () => {
  const opened: { headers?: Record<string, string | undefined> | undefined }[] = [];
  class Socket {
    constructor(
      _url: string | URL,
      _protocols?: string | string[],
      init?: { headers?: Record<string, string | undefined> },
    ) {
      opened.push({ headers: init?.headers });
    }
  }
  const base = "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/openai";
  const Guarded = egressGuardWebSocket({
    baseURL: base,
    credential: { header: "authorization", value: "Bearer user-openai-key" },
    gatewayToken: TOKEN,
    WebSocket: Socket as unknown as GuardableWebSocket,
  });
  const url = "wss://gateway.ai.cloudflare.com/v1/account-1/gateway-1/openai/realtime";
  new Guarded(url, "realtime", { headers: { authorization: "Bearer user-openai-key" } });
  assert.equal(opened[0]?.headers?.["cf-aig-authorization"], `Bearer ${TOKEN}`);
  assert.throws(
    () =>
      new Guarded(url, "realtime", {
        headers: { authorization: "Bearer user-openai-key", "cf-aig-authorization": "Bearer other" },
      }),
    refusal("egress_refused"),
  );
  assert.equal(opened.length, 1);
});

test("explicitProvider names itself, not the guard, when a gateway token is refused", () => {
  const cases: [string, string][] = [
    ["https://api.anthropic.com/v1", TOKEN],
    ["https://gateway.ai.cloudflare.com", TOKEN],
    [GATEWAY, "a b"],
  ];
  for (const [baseURL, gatewayToken] of cases) {
    assert.throws(
      () => explicitProvider({ provider: "anthropic", apiKey: KEY, baseURL, gatewayToken }),
      (error: unknown) => {
        refusal("invalid_byok_config")(error);
        assert.match((error as Error).message, /^explicitProvider\(anthropic\)/);
        assert.doesNotMatch((error as Error).message, /egressGuard/);
        return true;
      },
      baseURL,
    );
  }
});
