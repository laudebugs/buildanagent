import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  CREDENTIAL_HEADERS,
  checkModelRoutes,
  egressGuard,
  isSafetyError,
  MODEL_ROUTE_SETTINGS_AS_OF,
} from "@buildanagent/agent-safety";
import { assertNoDefaultProvider, explicitProvider } from "@buildanagent/agent-safety/byok";
import { generateText, type LanguageModel, streamText } from "ai";
import { afterEach, beforeEach, test, vi } from "vitest";
import { egressGuardWebSocket, type GuardableWebSocket } from "../src/egress.js";

// Decoy credentials and hosts in the environment. A provider that falls back to the environment picks them up, and
// any of them appearing in a recorded request fails the test. They are fake values that only this file sets.
const DECOYS = {
  ANTHROPIC_API_KEY: "decoy-anthropic-env-key",
  OPENAI_API_KEY: "decoy-openai-env-key",
  AI_GATEWAY_API_KEY: "decoy-ai-gateway-env-key",
  VERCEL_OIDC_TOKEN: "decoy-vercel-oidc-env-token",
  ANTHROPIC_BASE_URL: "https://decoy-anthropic.example/v1",
  OPENAI_BASE_URL: "https://decoy-openai.example/v1",
} as const;

const USER_ANTHROPIC_KEY = "user-anthropic-key";
const USER_OPENAI_KEY = "user-openai-key";
const ANTHROPIC_URL = "https://api.anthropic.com/v1";
const OPENAI_URL = "https://api.openai.com/v1";
const CF_GATEWAY = "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1";

interface Recorded {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly redirect: Request["redirect"];
}

const ANTHROPIC_REPLY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-test",
  content: [{ type: "text", text: "Hello." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 3, output_tokens: 2 },
};

const OPENAI_REPLY = {
  id: "resp_1",
  object: "response",
  created_at: 1,
  status: "completed",
  model: "gpt-test",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Hello.", annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 3,
    output_tokens: 2,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

/** A transport that records every request it receives and answers with a canned provider reply. Nothing leaves. */
function recorder(reply: unknown = ANTHROPIC_REPLY) {
  const requests: Recorded[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
      redirect: request.redirect,
    });
    return Response.json(reply);
  };
  return { requests, fetch: transport };
}

function assertNoDecoys(requests: readonly Recorded[]): void {
  assert.ok(requests.length > 0, "the call sent no request");
  const decoys = Object.values(DECOYS).map((value) => value.replace(/^https:\/\//, ""));
  for (const request of requests) {
    const text = JSON.stringify(request);
    for (const decoy of decoys) assert.ok(!text.includes(decoy), `a request carried the decoy ${decoy}`);
  }
}

function safetyError(code: string) {
  return (error: unknown) => {
    assert.ok(isSafetyError(error), `expected a SafetyError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  };
}

type DefaultProviderGlobal = { AI_SDK_DEFAULT_PROVIDER?: unknown; AI_SDK_LOG_WARNINGS?: unknown };
const globals = globalThis as DefaultProviderGlobal;
// The test models' ids are unknown to the providers, which would warn on every call.
globals.AI_SDK_LOG_WARNINGS = false;

beforeEach(() => {
  for (const [name, value] of Object.entries(DECOYS)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete globals.AI_SDK_DEFAULT_PROVIDER;
});

test("the decoys are live: providers built without explicit settings send the environment's key and host", async () => {
  const anthropic = recorder();
  await generateText({
    model: createAnthropic({ fetch: anthropic.fetch })("claude-test"),
    prompt: "Hi",
    maxRetries: 0,
  });
  assert.equal(anthropic.requests[0]?.headers["x-api-key"], DECOYS.ANTHROPIC_API_KEY);
  assert.ok(anthropic.requests[0]?.url.startsWith(DECOYS.ANTHROPIC_BASE_URL));

  const openai = recorder(OPENAI_REPLY);
  await generateText({ model: createOpenAI({ fetch: openai.fetch })("gpt-test"), prompt: "Hi", maxRetries: 0 });
  assert.equal(openai.requests[0]?.headers.authorization, `Bearer ${DECOYS.OPENAI_API_KEY}`);
  assert.ok(openai.requests[0]?.url.startsWith(DECOYS.OPENAI_BASE_URL));
});

test("an explicit Anthropic provider sends only the user's key, to the configured host, with decoys set", async () => {
  const transport = recorder();
  const provider = explicitProvider({
    provider: "anthropic",
    apiKey: USER_ANTHROPIC_KEY,
    baseURL: ANTHROPIC_URL,
    fetch: transport.fetch,
  });
  const result = await generateText({ model: provider("claude-test"), prompt: "Hi", maxRetries: 0 });
  assert.equal(result.text, "Hello.");
  assertNoDecoys(transport.requests);
  for (const request of transport.requests) {
    assert.equal(request.url, `${ANTHROPIC_URL}/messages`);
    assert.equal(request.headers["x-api-key"], USER_ANTHROPIC_KEY);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.redirect, "manual");
  }
});

test("an explicit OpenAI provider sends only the user's key, to the configured host, with decoys set", async () => {
  const transport = recorder(OPENAI_REPLY);
  const provider = explicitProvider({
    provider: "openai",
    apiKey: USER_OPENAI_KEY,
    baseURL: OPENAI_URL,
    fetch: transport.fetch,
  });
  const result = await generateText({ model: provider("gpt-test"), prompt: "Hi", maxRetries: 0 });
  assert.equal(result.text, "Hello.");
  assertNoDecoys(transport.requests);
  for (const request of transport.requests) {
    assert.equal(request.url, `${OPENAI_URL}/responses`);
    assert.equal(request.headers.authorization, `Bearer ${USER_OPENAI_KEY}`);
    assert.equal(request.headers["x-api-key"], undefined);
  }
});

test("a streamed call through an explicit provider also carries only the user's key", async () => {
  const transport = recorder();
  const provider = explicitProvider({
    provider: "anthropic",
    apiKey: USER_ANTHROPIC_KEY,
    baseURL: ANTHROPIC_URL,
    fetch: transport.fetch,
  });
  const result = streamText({ model: provider("claude-test"), prompt: "Hi", maxRetries: 0, onError: () => {} });
  await result.consumeStream();
  assertNoDecoys(transport.requests);
  assert.equal(transport.requests[0]?.headers["x-api-key"], USER_ANTHROPIC_KEY);
});

test("the decoys are live: without the refusal, a string model id goes to Vercel AI Gateway with the gateway key", async () => {
  const transport = recorder({});
  vi.stubGlobal("fetch", transport.fetch);
  await assert.rejects(generateText({ model: "anthropic/claude-test", prompt: "Hi", maxRetries: 0 }));
  const first = transport.requests[0];
  assert.equal(first === undefined ? undefined : new URL(first.url).host, "ai-gateway.vercel.sh");
  assert.equal(first?.headers.authorization, `Bearer ${DECOYS.AI_GATEWAY_API_KEY}`);
});

test("after assertNoDefaultProvider, a generateText call with a string model id fails before any request", async () => {
  const transport = recorder();
  vi.stubGlobal("fetch", transport.fetch);
  assertNoDefaultProvider();
  await assert.rejects(
    generateText({ model: "anthropic/claude-test", prompt: "Hi", maxRetries: 0 }),
    safetyError("default_provider"),
  );
  await assert.rejects(
    async () => streamText({ model: "openai/gpt-test", prompt: "Hi", maxRetries: 0 }).consumeStream(),
    safetyError("default_provider"),
  );
  assert.deepEqual(transport.requests, []);
});

test("a string model id that prepareStep returns fails before that step sends a request", async () => {
  const transport = recorder();
  assertNoDefaultProvider();
  const model = explicitProvider({
    provider: "anthropic",
    apiKey: USER_ANTHROPIC_KEY,
    baseURL: ANTHROPIC_URL,
    fetch: transport.fetch,
  })("claude-test");
  await assert.rejects(
    generateText({
      model,
      prompt: "Hi",
      maxRetries: 0,
      prepareStep: ({ stepNumber }) => (stepNumber === 0 ? { model: "openai/gpt-test" as LanguageModel } : undefined),
    }),
    safetyError("default_provider"),
  );
  assert.deepEqual(transport.requests, []);
});

test("assertNoDefaultProvider refuses another default provider and is idempotent for its own", () => {
  assertNoDefaultProvider();
  assertNoDefaultProvider();
  delete globals.AI_SDK_DEFAULT_PROVIDER;
  globals.AI_SDK_DEFAULT_PROVIDER = createAnthropic({ apiKey: USER_ANTHROPIC_KEY, baseURL: ANTHROPIC_URL });
  assert.throws(() => assertNoDefaultProvider(), safetyError("default_provider"));
});

test("every request to a Cloudflare AI Gateway host carries cf-aig-no-wholesale: true", async () => {
  const anthropic = recorder();
  const viaGateway = explicitProvider({
    provider: "anthropic",
    apiKey: USER_ANTHROPIC_KEY,
    baseURL: `${CF_GATEWAY}/anthropic`,
    fetch: anthropic.fetch,
  });
  await generateText({ model: viaGateway("claude-test"), prompt: "Hi", maxRetries: 0 });
  const openai = recorder(OPENAI_REPLY);
  const openaiViaGateway = explicitProvider({
    provider: "openai",
    apiKey: USER_OPENAI_KEY,
    baseURL: `${CF_GATEWAY}/openai`,
    fetch: openai.fetch,
  });
  await generateText({ model: openaiViaGateway("gpt-test"), prompt: "Hi", maxRetries: 0 });
  const requests = [...anthropic.requests, ...openai.requests];
  assertNoDecoys(requests);
  for (const request of requests) assert.equal(request.headers["cf-aig-no-wholesale"], "true");
  // Through the gateway, Anthropic's key still travels in x-api-key, where the gateway reads provider credentials.
  assert.equal(anthropic.requests[0]?.headers["x-api-key"], USER_ANTHROPIC_KEY);
  assert.equal(anthropic.requests[0]?.headers.authorization, undefined);
});

test("the guard overwrites a cf-aig-no-wholesale header that tries to relax it, and adds none elsewhere", async () => {
  const transport = recorder();
  const credential = { header: "x-api-key", value: USER_ANTHROPIC_KEY } as const;
  const viaGateway = egressGuard({ baseURL: `${CF_GATEWAY}/anthropic`, credential, fetch: transport.fetch });
  await viaGateway(`${CF_GATEWAY}/anthropic/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": USER_ANTHROPIC_KEY, "cf-aig-no-wholesale": "false" },
    body: "{}",
  });
  const direct = egressGuard({ baseURL: ANTHROPIC_URL, credential, fetch: transport.fetch });
  await direct(`${ANTHROPIC_URL}/messages`, { method: "POST", headers: { "x-api-key": USER_ANTHROPIC_KEY } });
  assert.equal(transport.requests[0]?.headers["cf-aig-no-wholesale"], "true");
  assert.equal(transport.requests[1]?.headers["cf-aig-no-wholesale"], undefined);
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("the guard never follows a redirect, so the key's header can't reach the redirect's target", async () => {
  // Node's fetch drops Authorization on a cross-origin redirect but forwards x-api-key, so following one would hand
  // the user's Anthropic key to wherever the response points. Both servers bind to loopback only.
  const seen: (string | undefined)[] = [];
  const target = createServer((request, response) => {
    seen.push(request.headers["x-api-key"] as string | undefined);
    response.end("{}");
  });
  const targetUrl = await listen(target);
  const origin = createServer((_request, response) => {
    response.writeHead(307, { location: `${targetUrl}/v1/messages` });
    response.end();
  });
  const originUrl = await listen(origin);
  try {
    const guard = egressGuard({
      baseURL: `${originUrl}/v1`,
      credential: { header: "x-api-key", value: USER_ANTHROPIC_KEY },
    });
    const response = await guard(`${originUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": USER_ANTHROPIC_KEY },
      body: "{}",
    });
    assert.equal(response.status, 307);
    assert.deepEqual(seen, []);
  } finally {
    origin.close();
    target.close();
  }
});

test("explicitProvider with an empty, missing or padded key throws before any request", () => {
  const transport = recorder();
  for (const apiKey of ["", undefined, " user-key", "user-key\n", "user\u0000key"]) {
    for (const provider of ["anthropic", "openai"] as const) {
      assert.throws(
        () => explicitProvider({ provider, apiKey: apiKey as string, baseURL: ANTHROPIC_URL, fetch: transport.fetch }),
        safetyError("invalid_byok_config"),
        `${provider} accepted the key ${JSON.stringify(apiKey)}`,
      );
    }
  }
  assert.deepEqual(transport.requests, []);
});

test("explicitProvider refuses a missing or unsafe base URL, and any Vercel AI Gateway URL", () => {
  const bad = [
    undefined,
    "",
    "api.anthropic.com/v1",
    "http://api.anthropic.com/v1",
    "https://user:pass@api.anthropic.com/v1",
    "https://api.anthropic.com/v1?key=x",
    "https://ai-gateway.vercel.sh/v4/ai",
    "https://eu.ai-gateway.vercel.sh/v4/ai",
  ];
  for (const baseURL of bad) {
    assert.throws(
      () => explicitProvider({ provider: "anthropic", apiKey: USER_ANTHROPIC_KEY, baseURL: baseURL as string }),
      safetyError("invalid_byok_config"),
      `accepted ${String(baseURL)}`,
    );
  }
  // A local proxy on loopback may use plain http.
  explicitProvider({ provider: "openai", apiKey: USER_OPENAI_KEY, baseURL: "http://127.0.0.1:8787/v1" });
});

test("the guard refuses a request to another host or outside the base path, and sends nothing", async () => {
  const transport = recorder();
  const guard = egressGuard({
    baseURL: `${CF_GATEWAY}/anthropic`,
    credential: { header: "x-api-key", value: USER_ANTHROPIC_KEY },
    fetch: transport.fetch,
  });
  const headers = { "x-api-key": USER_ANTHROPIC_KEY };
  for (const url of [
    "https://api.anthropic.com/v1/messages",
    "https://decoy-anthropic.example/v1/messages",
    "http://gateway.ai.cloudflare.com/v1/account-1/gateway-1/anthropic/v1/messages",
    "https://gateway.ai.cloudflare.com/v1/account-2/gateway-1/anthropic/v1/messages",
    "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/anthropic-other/v1/messages",
    "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/anthropic/../openai/v1/responses",
  ]) {
    await assert.rejects(guard(url, { method: "POST", headers }), safetyError("egress_refused"), url);
  }
  await assert.rejects(
    guard(new Request("https://ai-gateway.vercel.sh/v4/ai/language-model", { method: "POST", headers })),
    safetyError("egress_refused"),
  );
  assert.deepEqual(transport.requests, []);
});

test("the guard refuses a missing, different or second credential, and its errors never hold a key", async () => {
  const transport = recorder();
  const guard = egressGuard({
    baseURL: OPENAI_URL,
    credential: { header: "authorization", value: `Bearer ${USER_OPENAI_KEY}` },
    fetch: transport.fetch,
  });
  const url = `${OPENAI_URL}/responses`;
  const cases: Record<string, string>[] = [
    {},
    { authorization: `Bearer ${DECOYS.OPENAI_API_KEY}` },
    { authorization: `Bearer ${USER_OPENAI_KEY}`, "x-api-key": DECOYS.ANTHROPIC_API_KEY },
    { authorization: `Bearer ${USER_OPENAI_KEY}`, "cf-aig-authorization": `Bearer ${DECOYS.AI_GATEWAY_API_KEY}` },
  ];
  for (const headers of cases) {
    await assert.rejects(guard(url, { method: "POST", headers }), (error: unknown) => {
      safetyError("egress_refused")(error);
      const message = (error as Error).message;
      for (const secret of [
        USER_OPENAI_KEY,
        DECOYS.OPENAI_API_KEY,
        DECOYS.ANTHROPIC_API_KEY,
        DECOYS.AI_GATEWAY_API_KEY,
      ]) {
        assert.ok(!message.includes(secret), "the error message holds a key");
      }
      return true;
    });
  }
  assert.deepEqual(transport.requests, []);
});

test("egressGuard refuses an empty credential or an unsafe base URL when it is built", () => {
  assert.throws(
    () => egressGuard({ baseURL: OPENAI_URL, credential: { header: "authorization", value: "" } }),
    safetyError("invalid_byok_config"),
  );
  assert.throws(
    () =>
      egressGuard({ baseURL: "https://ai-gateway.vercel.sh/v4/ai", credential: { header: "x-api-key", value: "k" } }),
    safetyError("invalid_byok_config"),
  );
});

test("the settings checker passes direct routes and Cloudflare AI Gateway routes with byok_only on", () => {
  const report = checkModelRoutes({
    routes: [
      { provider: "anthropic", baseURL: ANTHROPIC_URL },
      { provider: "openai", baseURL: `${CF_GATEWAY}/openai`, cloudflareAiGateway: { byok_only: true } },
    ],
  });
  assert.deepEqual(report, { ok: true, problems: [], settingsAsOf: MODEL_ROUTE_SETTINGS_AS_OF });
  assert.equal(MODEL_ROUTE_SETTINGS_AS_OF, "2026-11-18");
});

test("the settings checker fails a Cloudflare AI Gateway route with byok_only absent, false or not a boolean", () => {
  const route = (cloudflareAiGateway?: unknown) => ({
    routes: [
      {
        provider: "anthropic",
        baseURL: `${CF_GATEWAY}/anthropic`,
        ...(cloudflareAiGateway === undefined ? {} : { cloudflareAiGateway }),
      },
    ],
  });
  const codes = (config: unknown) => checkModelRoutes(config).problems.map((problem) => problem.code);
  assert.deepEqual(codes(route()), ["byok_only_missing"]);
  assert.deepEqual(codes(route({})), ["byok_only_missing"]);
  assert.deepEqual(codes(route({ byok_only: false })), ["byok_only_off"]);
  assert.deepEqual(codes(route({ byok_only: "true" })), ["invalid_config"]);
  assert.equal(checkModelRoutes(route({ byok_only: false })).ok, false);
  assert.equal(checkModelRoutes(route({ byok_only: false })).problems[0]?.route, 0);
});

test("the settings checker refuses any route through Vercel AI Gateway", () => {
  const codes = (route: unknown) => checkModelRoutes({ routes: [route] }).problems.map((problem) => problem.code);
  assert.deepEqual(codes({ provider: "anthropic", baseURL: "https://ai-gateway.vercel.sh/v4/ai" }), [
    "vercel_ai_gateway",
  ]);
  assert.deepEqual(codes({ provider: "gateway", baseURL: ANTHROPIC_URL }), ["vercel_ai_gateway"]);
  assert.deepEqual(
    codes({ provider: "openai", baseURL: OPENAI_URL, vercelAiGateway: { fallbackToVercelKeys: false } }),
    ["unknown_field"],
  );
});

test("the settings checker fails closed on an unknown field or a malformed configuration", () => {
  const codes = (config: unknown) => checkModelRoutes(config).problems.map((problem) => problem.code);
  const gatewayRoute = { provider: "anthropic", baseURL: `${CF_GATEWAY}/anthropic` };
  assert.deepEqual(
    codes({ routes: [{ ...gatewayRoute, cloudflareAiGateway: { byok_only: true, wholesale: false } }] }),
    ["unknown_field"],
  );
  assert.deepEqual(codes({ routes: [{ provider: "anthropic", baseURL: ANTHROPIC_URL }], fallback: "vercel" }), [
    "unknown_field",
  ]);
  assert.deepEqual(codes({ routes: [] }), ["invalid_config"]);
  assert.deepEqual(codes(null), ["invalid_config"]);
  assert.deepEqual(codes({ routes: ["anthropic"] }), ["invalid_config"]);
  assert.deepEqual(codes({ routes: [{ provider: "mistral", baseURL: ANTHROPIC_URL }] }), ["invalid_config"]);
  assert.deepEqual(codes({ routes: [{ provider: "openai", baseURL: "http://api.openai.com/v1" }] }), [
    "invalid_base_url",
  ]);
  assert.deepEqual(
    codes({ routes: [{ provider: "openai", baseURL: OPENAI_URL, cloudflareAiGateway: { byok_only: true } }] }),
    ["invalid_config"],
  );
});

test("a host written with a trailing dot is refused, so it can't slip past the gateway checks", () => {
  const codes = (route: unknown) => checkModelRoutes({ routes: [route] }).problems.map((problem) => problem.code);
  const dottedGateway = "https://gateway.ai.cloudflare.com./v1/account-1/gateway-1/anthropic";
  assert.deepEqual(codes({ provider: "anthropic", baseURL: dottedGateway }), ["invalid_base_url"]);
  assert.deepEqual(codes({ provider: "anthropic", baseURL: "https://ai-gateway.vercel.sh./v4/ai" }), [
    "invalid_base_url",
  ]);
  const credential = { header: "x-api-key", value: USER_ANTHROPIC_KEY } as const;
  assert.throws(() => egressGuard({ baseURL: dottedGateway, credential }), safetyError("invalid_byok_config"));
  assert.throws(
    () => explicitProvider({ provider: "anthropic", apiKey: USER_ANTHROPIC_KEY, baseURL: dottedGateway }),
    safetyError("invalid_byok_config"),
  );
});

test("the guard refuses a path with an encoded slash or backslash, which a server may decode out of the base", async () => {
  const transport = recorder(OPENAI_REPLY);
  const credential = { header: "authorization", value: `Bearer ${USER_OPENAI_KEY}` } as const;
  const guard = egressGuard({ baseURL: OPENAI_URL, credential, fetch: transport.fetch });
  for (const path of ["..%2fadmin", "..%2Fadmin", "..%5cadmin", "a%2F..%2F..%2Fother"]) {
    await assert.rejects(
      guard(`${OPENAI_URL}/${path}`, { headers: { authorization: credential.value } }),
      safetyError("egress_refused"),
    );
  }
  assert.deepEqual(transport.requests, []);
  assert.throws(() => egressGuard({ baseURL: `${OPENAI_URL}%2f..`, credential }), safetyError("invalid_byok_config"));
});

test("a Cloudflare AI Gateway route must use its own provider's endpoint", () => {
  const codes = (route: unknown) => checkModelRoutes({ routes: [route] }).problems.map((problem) => problem.code);
  const settings = { cloudflareAiGateway: { byok_only: true } };
  assert.deepEqual(codes({ provider: "anthropic", baseURL: `${CF_GATEWAY}/openai`, ...settings }), [
    "provider_mismatch",
  ]);
  assert.deepEqual(codes({ provider: "openai", baseURL: CF_GATEWAY, ...settings }), ["provider_mismatch"]);
  assert.deepEqual(codes({ provider: "anthropic", baseURL: `${CF_GATEWAY}/anthropic`, ...settings }), []);
  assert.deepEqual(codes({ provider: "anthropic", baseURL: `${CF_GATEWAY}/anthropic/v1`, ...settings }), []);
  const gateway = "https://gateway.ai.cloudflare.com/v1";
  assert.deepEqual(codes({ provider: "anthropic", baseURL: `${gateway}///anthropic`, ...settings }), [
    "provider_mismatch",
  ]);
  assert.deepEqual(
    codes({ provider: "anthropic", baseURL: `${gateway}//gateway-1/anthropic/anthropic`, ...settings }),
    ["provider_mismatch"],
  );
  assert.deepEqual(codes({ provider: "openai", baseURL: "http://127.0.0.1:8787/v1" }), ["invalid_base_url"]);
  assert.throws(
    () => explicitProvider({ provider: "anthropic", apiKey: USER_ANTHROPIC_KEY, baseURL: `${CF_GATEWAY}/openai` }),
    safetyError("invalid_byok_config"),
  );
});

test("egressGuard throws invalid_byok_config, not a TypeError, when the credential is missing", () => {
  const options = { baseURL: OPENAI_URL } as unknown as Parameters<typeof egressGuard>[0];
  assert.throws(() => egressGuard(options), safetyError("invalid_byok_config"));
});

test("CREDENTIAL_HEADERS can't be emptied at runtime to let a second credential through", () => {
  assert.ok(Object.isFrozen(CREDENTIAL_HEADERS));
  assert.throws(() => {
    (CREDENTIAL_HEADERS as string[]).length = 0;
  }, TypeError);
});

test("assertNoDefaultProvider treats null as unset, and a later assignment can't replace its provider", async () => {
  globals.AI_SDK_DEFAULT_PROVIDER = null;
  assertNoDefaultProvider();
  assert.throws(() => {
    globals.AI_SDK_DEFAULT_PROVIDER = createAnthropic({ apiKey: USER_ANTHROPIC_KEY, baseURL: ANTHROPIC_URL });
  }, TypeError);
  await assert.rejects(
    generateText({ model: "anthropic/claude-test", prompt: "Hi", maxRetries: 0 }),
    safetyError("default_provider"),
  );
});

test("an OpenAI WebSocket handshake passes the guard's checks before the socket opens", () => {
  type SocketInit = { headers?: Record<string, string | undefined> };
  const opened: { url: string; headers: Record<string, string | undefined> }[] = [];
  const FakeSocket = function (this: unknown, url: string | URL, _protocols?: unknown, init?: SocketInit) {
    opened.push({ url: String(url), headers: init?.headers ?? {} });
  } as unknown as GuardableWebSocket;
  const credential = { header: "authorization", value: `Bearer ${USER_OPENAI_KEY}` } as const;
  const Socket = egressGuardWebSocket({ baseURL: `${CF_GATEWAY}/openai`, credential, WebSocket: FakeSocket });
  const gatewaySocket = "wss://gateway.ai.cloudflare.com/v1/account-1/gateway-1/openai/realtime?intent=transcription";
  new Socket(gatewaySocket, undefined, { headers: { Authorization: credential.value, "OpenAI-Project": undefined } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.url, gatewaySocket);
  assert.equal(opened[0]?.headers.authorization, credential.value);
  assert.equal(opened[0]?.headers["cf-aig-no-wholesale"], "true");
  assert.throws(
    () => new Socket("wss://api.openai.com/v1/realtime", undefined, { headers: { Authorization: credential.value } }),
    safetyError("egress_refused"),
  );
  assert.throws(
    () => new Socket(gatewaySocket, undefined, { headers: { Authorization: `Bearer ${DECOYS.OPENAI_API_KEY}` } }),
    safetyError("egress_refused"),
  );
  assert.equal(opened.length, 1);
  // The key may not ride in a subprotocol, where no header check sees it.
  new Socket(gatewaySocket, ["realtime"], { headers: { Authorization: credential.value } });
  for (const protocols of [["realtime", "openai-insecure-api-key.sk-other"], "openai-insecure-api-key.sk-other"]) {
    assert.throws(
      () => new Socket(gatewaySocket, protocols, { headers: { Authorization: credential.value } }),
      safetyError("egress_refused"),
    );
  }
  assert.equal(opened.length, 2);
});

test("explicitProvider hands the OpenAI provider a guarded WebSocket", () => {
  const sockets: unknown[] = [];
  vi.stubGlobal("WebSocket", function (this: unknown, url: string | URL) {
    sockets.push(url);
  });
  const openai = explicitProvider({ provider: "openai", apiKey: USER_OPENAI_KEY, baseURL: OPENAI_URL });
  const config = (openai.transcription("gpt-test") as unknown as { config: { webSocket?: GuardableWebSocket } }).config;
  assert.ok(config.webSocket !== undefined);
  assert.throws(
    () => new (config.webSocket as GuardableWebSocket)("wss://decoy-openai.example/v1/realtime", undefined, {}),
    safetyError("egress_refused"),
  );
  assert.deepEqual(sockets, []);
});
