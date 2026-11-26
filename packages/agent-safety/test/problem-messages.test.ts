// The error messages that the docs' Problems and fixes page quotes, so a reworded message fails here before it
// misleads a reader who searches the page for it.
import assert from "node:assert/strict";
import {
  canonicalInputHash,
  guardedWrite,
  hmacSigner,
  memoryEffectStore,
  parseKeyRing,
  writeOutcome,
} from "@buildanagent/agent-safety";
import { assertNoDefaultProvider, explicitProvider } from "@buildanagent/agent-safety/byok";
import { budgetRefusal, costGuard, guardedProvider, memorySpend } from "@buildanagent/agent-safety/cost";
import { customProvider, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test } from "vitest";

/** The code and message of the `SafetyError` that `attempt` throws or rejects with. */
async function thrown(attempt: () => unknown): Promise<{ code: unknown; message: string }> {
  try {
    await attempt();
  } catch (error) {
    const { code, message } = error as { code: unknown; message: string };
    return { code, message };
  }
  throw new Error("nothing was thrown");
}

const next = "Ask the requester for another payment method";

test("a reason that is not upper snake case names the reason it got", async () => {
  assert.deepEqual(
    await thrown(() => writeOutcome({ kind: "not_applied", operation: "o", reason: "card declined", next })),
    {
      code: "invalid_outcome",
      message: `a write outcome's reason must be upper snake case and at most 63 characters, got "card declined"`,
    },
  );
});

test("a retry rule that the kind does not allow is named in the message", async () => {
  const outcome = { kind: "applied", operation: "o", retry: "same_key", next } as unknown as Parameters<
    typeof writeOutcome
  >[0];
  assert.deepEqual(await thrown(() => writeOutcome(outcome)), {
    code: "invalid_outcome",
    message: `a applied outcome cannot use retry "same_key"`,
  });
});

test("an unknown outcome that retries under the same key needs an effect key", async () => {
  assert.deepEqual(await thrown(() => writeOutcome({ kind: "unknown", operation: "o", retry: "same_key", next })), {
    code: "invalid_outcome",
    message: `a unknown outcome can use retry "same_key" only with an effectKey`,
  });
});

test("an input with a number that is not finite is refused with the path to it", async () => {
  assert.deepEqual(await thrown(() => canonicalInputHash({ amount: Number.NaN })), {
    code: "invalid_input",
    message: "the input at $.amount is NaN, so it has no canonical JSON form",
  });
});

test("a key shorter than 32 bytes is refused by its id", async () => {
  assert.deepEqual(await thrown(() => hmacSigner({ keys: { a: new Uint8Array(8) }, current: "a" })), {
    code: "invalid_key_ring",
    message: `the key "a" must be a Uint8Array of at least 32 bytes`,
  });
});

test("key ring text that is not JSON is refused without quoting it", async () => {
  assert.deepEqual(await thrown(() => parseKeyRing("not json")), {
    code: "invalid_key_ring",
    message: "the key ring is not valid JSON",
  });
});

test("a key that is not base64url is refused by its id", async () => {
  const text = JSON.stringify({ current: "a", keys: { a: "not base64url!" } });
  assert.deepEqual(await thrown(() => parseKeyRing(text)), {
    code: "invalid_key_ring",
    message: `the key "a" must be unpadded base64url`,
  });
});

test("a guarded write with an empty tenant is refused by the field's name", async () => {
  const write = () =>
    guardedWrite({
      store: memoryEffectStore(),
      scope: { tenant: "", session: "s", branch: "b", toolCallId: "c" },
      operation: "o",
      input: {},
      dedupe: "idempotency_key",
      run: async () => 1,
      toOutcome: () => writeOutcome({ kind: "applied", operation: "o", next: "n" }),
    });
  assert.deepEqual(await thrown(write), {
    code: "invalid_effect",
    message: "an effect scope's tenant must be non-empty",
  });
});

const BASE_URL = "https://api.anthropic.com/v1";

test("an empty key is refused with the provider's name", async () => {
  assert.deepEqual(await thrown(() => explicitProvider({ provider: "anthropic", apiKey: "", baseURL: BASE_URL })), {
    code: "invalid_byok_config",
    message: "explicitProvider(anthropic) needs the user's apiKey, and got none",
  });
});

test("a key with surrounding whitespace is refused", async () => {
  assert.deepEqual(await thrown(() => explicitProvider({ provider: "anthropic", apiKey: " k", baseURL: BASE_URL })), {
    code: "invalid_byok_config",
    message: "explicitProvider(anthropic) got an apiKey with surrounding whitespace or a control character",
  });
});

const stubFetch = (async () => new Response("{}")) as typeof fetch;

test("a call that sets its own credential header is refused before it is sent", async () => {
  const provider = explicitProvider({ provider: "anthropic", apiKey: "user-key", baseURL: BASE_URL, fetch: stubFetch });
  const call = (headers: Record<string, string>) =>
    generateText({ model: provider("claude-haiku-5-5"), prompt: "Hi", headers, maxRetries: 0 });
  assert.deepEqual(await thrown(() => call({ "x-api-key": "other-key" })), {
    code: "egress_refused",
    message: "egressGuard refused a model request: its x-api-key header differs from the configured key",
  });
  assert.deepEqual(await thrown(() => call({ authorization: "Bearer other-key" })), {
    code: "egress_refused",
    message: "egressGuard refused a model request: it carries a second credential header, authorization",
  });
});

function guardedModels() {
  const model = (modelId: string) =>
    new MockLanguageModelV4({
      provider: "anthropic.messages",
      modelId,
      doGenerate: async () => Promise.reject(new Error("sent")),
    });
  const provider = customProvider({
    languageModels: { "claude-sonnet-5-5": model("claude-sonnet-5-5"), "mystery-1": model("mystery-1") },
  });
  return guardedProvider(provider, costGuard({ capUsd: 0.5, spend: memorySpend() }));
}

test("a call that could pass the cap is refused with its projection, before it is sent", async () => {
  const models = guardedModels();
  const refused = await thrown(() => generateText({ model: models.languageModel("claude-sonnet-5-5"), prompt: "Hi" }));
  assert.equal(refused.code, "budget_exceeded");
  assert.match(
    refused.message,
    /^anthropic\.messages\/claude-sonnet-5-5 was not called: \$0 is spent or in flight and the call can cost up to \$[\d.]+, which passes the cap of \$0\.5$/,
  );
});

test("a model that the catalog does not price is refused before it is sent", async () => {
  const models = guardedModels();
  const refused = await thrown(() => generateText({ model: models.languageModel("mystery-1"), prompt: "Hi" }));
  assert.deepEqual(refused, {
    code: "unknown_price",
    message:
      "the price of anthropic.messages/mystery-1 is unknown, so a call under a USD cap can't be checked; add the model to the catalog",
  });
});

test("a refusal is a BudgetExceeded that budgetRefusal() finds", async () => {
  const models = guardedModels();
  const error = await generateText({ model: models.languageModel("mystery-1"), prompt: "Hi" }).catch(
    (caught) => caught,
  );
  assert.equal(budgetRefusal(error)?.projectedUsd, null);
});

test("a string model id is refused once the default provider is closed", async () => {
  assertNoDefaultProvider();
  const refused = await thrown(() => generateText({ model: "anthropic/claude-haiku-5-5", prompt: "Hi" }));
  assert.deepEqual(refused, {
    code: "default_provider",
    message:
      'A string model id "anthropic/claude-haiku-5-5" was resolved for a languageModel; string ids route through a default provider, which may use a credential nobody configured. Pass a model built with explicitProvider() instead.',
  });
});
