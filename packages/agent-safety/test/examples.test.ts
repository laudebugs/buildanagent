// Runs the README's examples in examples/: the refund that a regenerated turn can't repeat, the refund plan a person
// signs once, the run that stops at its USD cap, and the call on the user's own key under a cap. The model is a
// MockLanguageModelV4 or a stub transport and the payment API a stub, so nothing leaves the process.
import assert from "node:assert/strict";
import { lintPlan, memoryEffectStore, planCard, signPlan } from "@buildanagent/agent-safety";
import { testSigner } from "@buildanagent/agent-safety/testing";
import { customProvider } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test } from "vitest";
import { cappedAnswer } from "../examples/capped-answer.js";
import { answererForKey } from "../examples/own-key-capped.js";
import { type Payments, type RefundInput, refundOnce } from "../examples/refund-once.js";
import { refundPlan } from "../examples/refund-plan.js";

function stubPayments(): Payments & { readonly created: string[] } {
  const byKey = new Map<string, { id: string }>();
  const created: string[] = [];
  return {
    created,
    refunds: {
      async create(_input: RefundInput, { idempotencyKey }: { idempotencyKey: string }) {
        const refund = byKey.get(idempotencyKey) ?? { id: `re_${byKey.size + 1}` };
        if (!byKey.has(idempotencyKey)) created.push(refund.id);
        byKey.set(idempotencyKey, refund);
        return refund;
      },
      findByKey: async (key) => byKey.get(key),
    },
  };
}

test("a regenerated turn's second refund of one order returns the first outcome and sends nothing", async () => {
  const store = memoryEffectStore();
  const payments = stubPayments();
  const input = { orderId: "o-42", amountCents: 1250 };
  const scope = (toolCallId: string) => ({ tenant: "ada", session: "s1", branch: "main", toolCallId });
  const first = await refundOnce(store, scope("call-1"), payments, input);
  const second = await refundOnce(store, scope("call-2"), payments, input);
  assert.equal(first.kind, "applied");
  assert.deepEqual(second, first);
  assert.deepEqual(payments.created, ["re_1"]);
});

test("the refund plan lints, has the refund as its pivot and signs", async () => {
  const plan = refundPlan({ id: "o-42", customerEmail: "ada@example.com", refundableCents: 2000, refundedCents: 750 });
  assert.deepEqual(lintPlan(plan.steps), { ok: true });
  const card = await planCard(plan);
  assert.deepEqual(
    card.steps.filter((step) => step.isPivot).map((step) => step.summary),
    ["Refund $12.50 to the card on order o-42"],
  );
  const approval = await signPlan(plan, testSigner());
  assert.equal(approval.steps.length, 4);
});

function mockModel(modelId: string) {
  const requests: unknown[] = [];
  const model = new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId,
    doGenerate: async (options) => {
      requests.push(options);
      return {
        content: [{ type: "text", text: "Your refund is on its way." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { provider: customProvider({ languageModels: { [modelId]: model } }), requests };
}

test("a call whose projection fits the cap runs, and one that could pass it is never sent", async () => {
  // At the catalog's prices, a call's full output limit costs about 6 cents on Haiku and over a dollar on Sonnet.
  const cheap = mockModel("claude-haiku-5-5");
  assert.equal(
    await cappedAnswer(cheap.provider, "claude-haiku-5-5", "Where is my refund?"),
    "Your refund is on its way.",
  );
  assert.equal(cheap.requests.length, 1);
  const dear = mockModel("claude-sonnet-5-5");
  const answer = await cappedAnswer(dear.provider, "claude-sonnet-5-5", "Where is my refund?");
  assert.match(answer, /^Stopped at the cap of 0\.5 USD: 0 spent/);
  assert.equal(dear.requests.length, 0);
});

function anthropicAnswer(text: string, outputTokens = 10): Response {
  return Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: outputTokens },
  });
}

/**
 * A transport that records the address and key of every request and answers like the API, reporting `outputTokens` of
 * usage, so nothing leaves the process.
 */
function recordingTransport(outputTokens?: number) {
  const sent: { url: string; key: string | null }[] = [];
  const send = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push({ url: request.url, key: request.headers.get("x-api-key") });
    return anthropicAnswer("Your refund is on its way.", outputTokens);
  }) as typeof fetch;
  return { send, sent };
}

test("a cheap call goes out with only the user's key to the one address, and a call that could pass the cap is never sent", async () => {
  const transport = recordingTransport();
  const answer = answererForKey("sk-user-1", transport.send);
  assert.equal(await answer("claude-haiku-5-5", "Where is my refund?"), "Your refund is on its way.");
  assert.deepEqual(transport.sent, [{ url: "https://api.anthropic.com/v1/messages", key: "sk-user-1" }]);
  const refused = await answer("claude-sonnet-5-5", "Where is my refund?");
  assert.match(refused, /^Stopped at the cap of 0\.5 USD: 0\.0000\d* spent/);
  assert.equal(transport.sent.length, 1, "the refused call sent nothing");
});

test("what one call spent counts against the next call on the same key, and a new key starts at zero", async () => {
  // 900,000 output tokens cost 0.45 USD at Haiku's catalog price, so the first call fits and the second could pass 0.5.
  const transport = recordingTransport(900_000);
  const answer = answererForKey("sk-user-1", transport.send);
  assert.equal(await answer("claude-haiku-5-5", "Where is my refund?"), "Your refund is on its way.");
  const refused = await answer("claude-haiku-5-5", "And the second?");
  assert.match(refused, /^Stopped at the cap of 0\.5 USD: 0\.4500\d* spent/);
  assert.equal(transport.sent.length, 1, "the second call was refused before it was sent");
  const other = answererForKey("sk-user-2", transport.send);
  assert.equal(await other("claude-haiku-5-5", "Hi"), "Your refund is on its way.");
  assert.equal(transport.sent.length, 2);
});

test("a missing key is refused before any request", async () => {
  const transport = recordingTransport();
  assert.throws(() => answererForKey("", transport.send), { code: "invalid_byok_config" });
  assert.equal(transport.sent.length, 0);
});
