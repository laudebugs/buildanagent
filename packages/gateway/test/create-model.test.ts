import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createModel,
  emptyUsage,
  type GatewayErrorCode,
  isGatewayError,
  type ModelAdapter,
  type PriceCatalog,
  type RequestDump,
} from "@buildanagent/gateway";
import { assertStreamContract } from "@buildanagent/gateway/testing";
import { afterEach, test } from "vitest";
import { context, FailingAdapter, httpTestAdapter, recordingSleep, recordingTransport, TEST_CAPS } from "./adapters.ts";
import { fakeEntry } from "./fixtures.ts";

const catalog: PriceCatalog = {
  models: [
    fakeEntry({ id: "listed", contextWindow: 200_000, maxOutputTokens: 64_000, images: true }),
    fakeEntry({ provider: "other", id: "m", contextWindow: 1, maxOutputTokens: 1 }),
  ],
};

function throwsGatewayError(run: () => unknown, code: GatewayErrorCode): void {
  assert.throws(run, (error) => isGatewayError(error) && error.code === code);
}

test("createModel() rejects a bare model id string, at compile time and at run time", () => {
  // @ts-expect-error the adapter must be an adapter object, never a model id string
  const bad = () => createModel({ adapter: "claude-x", id: "claude-x" });
  throwsGatewayError(bad, "invalid_options");
});

test("Model.ref joins the adapter's api and provider with the model id", () => {
  const model = createModel({ adapter: new FailingAdapter([]), id: "m" });
  assert.deepEqual(model.ref, { api: "test-api", provider: "test", id: "m" });
});

test("Model.caps carries the contextWindow and maxOutputTokens of the model's catalog entry", () => {
  const model = createModel({ adapter: new FailingAdapter([]), id: "listed", catalog });
  // images comes from the entry; reasoning, which the entry leaves out, from the adapter's defaults.
  assert.deepEqual(model.caps, { contextWindow: 200_000, maxOutputTokens: 64_000, images: true, reasoning: false });
});

test("a model without a catalog entry gets the adapter's default caps", () => {
  const model = createModel({ adapter: new FailingAdapter([]), id: "unlisted", catalog });
  assert.deepEqual(model.caps, TEST_CAPS);
});

test("a model with no catalog entry and no adapter defaults is refused", () => {
  const { defaultCaps: _defaults, ...bare } = new FailingAdapter([]);
  const adapter = { ...bare, stream: () => ({ async *[Symbol.asyncIterator]() {} }) };
  throwsGatewayError(() => createModel({ adapter, id: "unlisted", catalog }), "missing_caps");
});

test("retries must be a non-negative integer", () => {
  throwsGatewayError(() => createModel({ adapter: new FailingAdapter([]), id: "m", retries: -1 }), "invalid_options");
  throwsGatewayError(() => createModel({ adapter: new FailingAdapter([]), id: "m", retries: 1.5 }), "invalid_options");
});

test("Model.complete() folds Model.stream() into the final message, skipping retry events", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable" }, { reply: "hello" }]);
  const message = await createModel({ adapter, id: "m", sleep: recordingSleep().sleep }).complete(context);
  assert.equal(message.stopReason, "stop");
  assert.deepEqual(message.content, [{ type: "text", text: "hello" }]);
});

test("onRequest receives each attempt's full request, with the wire body after onPayload", async () => {
  const { transport, requests } = recordingTransport([
    [529, { error: { type: "overloaded_error", message: "Overloaded" } }],
    [200, { text: "ok" }],
  ]);
  const dumps: RequestDump[] = [];
  const order: string[] = [];
  const model = createModel({
    adapter: httpTestAdapter({ apiKey: "sk-test", transport }),
    id: "m",
    sleep: recordingSleep().sleep,
    onRequest: (dump) => {
      dumps.push(dump);
      order.push(`dump ${dump.attempt}`);
    },
  });
  const controller = new AbortController();
  const onPayload = (body: unknown) => ({ ...(body as object), metadata: { tag: "rewritten" } });

  for await (const event of model.stream(context, { signal: controller.signal, maxOutputTokens: 50, onPayload })) {
    if (event.type === "start" || event.type === "retry") order.push(event.type);
  }

  assert.deepEqual(order, ["dump 1", "start", "retry", "dump 2"]);
  assert.equal(requests.length, 2);
  for (const [i, dump] of dumps.entries()) {
    assert.equal(dump.attempt, i + 1);
    assert.deepEqual(dump.model, { api: "test-http", provider: "test-http", id: "m" });
    assert.deepEqual(dump.context, context);
    assert.notEqual(dump.context, context, "the dump holds a copy, not the caller's object");
    assert.deepEqual(dump.options, { maxOutputTokens: 50 });
    assert.deepEqual(dump.body, JSON.parse(requests[i]?.body ?? "null"));
    assert.deepEqual((dump.body as { metadata: unknown }).metadata, { tag: "rewritten" });
  }
});

test("an onPayload that returns undefined sends the body unchanged", async () => {
  const { transport, requests } = recordingTransport([[200, { text: "ok" }]]);
  const model = createModel({ adapter: httpTestAdapter({ apiKey: "sk-test", transport }), id: "m" });
  await model.complete(context, { onPayload: () => undefined });
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "null"), {
    model: "m",
    system: context.system,
    messages: context.messages,
  });
});

test("an adapter that sends no wire body is dumped once per attempt, before its first event", async () => {
  const dumps: RequestDump[] = [];
  const adapter = new FailingAdapter([{ fail: "retryable" }, { reply: "ok" }]);
  const model = createModel({ adapter, id: "m", sleep: recordingSleep().sleep, onRequest: (d) => dumps.push(d) });

  const events = await assertStreamContract(model.stream(context));

  assert.deepEqual(
    dumps.map((d) => [d.attempt, d.body]),
    [
      [1, undefined],
      [2, undefined],
    ],
  );
  assert.equal(events.at(-1)?.type, "done");
});

const DECOYS = {
  ANTHROPIC_API_KEY: "decoy-anthropic-key",
  OPENAI_API_KEY: "decoy-openai-key",
  GEMINI_API_KEY: "decoy-gemini-key",
  AWS_ACCESS_KEY_ID: "decoy-aws-access-key",
  AWS_SECRET_ACCESS_KEY: "decoy-aws-secret",
  AWS_BEARER_TOKEN_BEDROCK: "decoy-bedrock-token",
} as const;
let saved: Record<string, string | undefined> = {};

function setDecoys(): void {
  saved = Object.fromEntries(Object.keys(DECOYS).map((name) => [name, process.env[name]]));
  Object.assign(process.env, DECOYS);
}

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved = {};
});

test("with decoy provider keys in the environment, every request carries only ProviderConfig.apiKey", async () => {
  setDecoys();
  const { transport, requests } = recordingTransport([
    [503, { error: { message: "unavailable" } }],
    [200, { text: "ok" }],
  ]);
  const model = createModel({
    adapter: httpTestAdapter({ apiKey: "sk-explicit", transport }),
    id: "m",
    sleep: recordingSleep().sleep,
  });

  const message = await model.complete(context);

  assert.equal(message.stopReason, "stop");
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.headers["x-api-key"], "sk-explicit");
    const sent = JSON.stringify(request);
    for (const decoy of Object.values(DECOYS)) assert.ok(!sent.includes(decoy), `request carried ${decoy}`);
  }
});

test("a missing or empty apiKey fails before any request, even with decoy keys set", () => {
  setDecoys();
  const { transport, requests } = recordingTransport([[200, { text: "ok" }]]);
  // @ts-expect-error ProviderConfig.apiKey is required
  throwsGatewayError(() => httpTestAdapter({ transport }), "missing_api_key");
  throwsGatewayError(() => httpTestAdapter({ apiKey: "", transport }), "missing_api_key");
  throwsGatewayError(() => httpTestAdapter({ apiKey: "  ", transport }), "missing_api_key");
  assert.equal(requests.length, 0);
});

test("no gateway source outside the offline guards reads the environment", () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const guards = new Set(["testing/guards.ts", "testing/setup.ts"]);
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  const offenders = files(src)
    .filter((file) => !guards.has(relative(src, file).replaceAll("\\", "/")))
    .filter((file) =>
      /\b(process|Deno|Bun)\s*\.\s*env\b|import\.meta\.env|globalThis\s*\.\s*process\b/.test(
        readFileSync(file, "utf8"),
      ),
    );
  assert.deepEqual(offenders, []);
});

test("an adapter that yields start before it builds its body is dumped once, with the body", async () => {
  const dumps: unknown[] = [];
  const adapter: ModelAdapter = {
    specificationVersion: "v1",
    api: "test-api",
    provider: "test",
    defaultCaps: TEST_CAPS,
    async *stream(model, _context, options) {
      yield { type: "start" };
      options.onPayload?.({ prompt: "hi" });
      const cost = { total: null, basis: "unknown", currency: "USD" } as const;
      yield {
        type: "done",
        message: { role: "assistant", content: [], model, stopReason: "stop", usage: emptyUsage(), cost },
      };
    },
  };
  const model = createModel({ adapter, id: "m", onRequest: (dump) => dumps.push(dump.body) });

  await model.complete(context);

  assert.deepEqual(dumps, [{ prompt: "hi" }]);
});

test("an attempt that throws before its first event is still dumped, and an uncloneable dump is passed as it is", async () => {
  const dumps: RequestDump[] = [];
  const adapter: ModelAdapter = {
    specificationVersion: "v1",
    api: "test-api",
    provider: "test",
    defaultCaps: TEST_CAPS,
    // biome-ignore lint/correctness/useYield: the attempt fails before it yields anything
    async *stream() {
      throw new RangeError("bad content block");
    },
  };
  const fetchHook = () => undefined;
  const model = createModel({ adapter, id: "m", onRequest: (dump) => dumps.push(dump) });

  const result = await model.complete(context, { providerOptions: { fetch: fetchHook } });

  assert.equal(result.error?.kind, "fatal");
  assert.equal(dumps.length, 1);
  const [dump] = dumps;
  assert.ok(dump);
  assert.equal((dump.options.providerOptions as { fetch: unknown }).fetch, fetchHook);
});
