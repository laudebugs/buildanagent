import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";
import { startWorker, type TestWorker } from "./miniflare.js";
import type { Change, Played } from "./workerd/scenario.js";

// The Worker runs in workerd, Cloudflare's runtime, through Miniflare: a real `AIChatAgent` Durable Object with
// SQLite storage, answered over its WebSocket. Every outbound request is refused, so nothing leaves the machine.
const ENTRY = fileURLToPath(new URL("./workerd/approval-agent.ts", import.meta.url));
const KEY_RING = JSON.stringify({ current: "k1", keys: { k1: "d29ya2VyZC1hcHByb3ZhbC1rZXktMzItYnl0ZXMtLS0" } });
const REFUND = { order: 4417, amount: 250 };

let worker: TestWorker | undefined;

beforeAll(async () => {
  worker = await startWorker(ENTRY, ["RefundAgent"], { APPROVAL_KEYS: KEY_RING });
}, 60_000);

afterAll(async () => {
  const blocked = worker?.blocked ?? [];
  await worker?.dispose();
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

async function play(change: Change): Promise<Played> {
  assert.ok(worker, "Miniflare started");
  const response = await worker.dispatch(`/${change}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const played = JSON.parse(body) as Played;
  assert.deepEqual(played.errors, [], "no turn failed");
  return played;
}

test("in workerd, an approved call runs once after the adapter verifies its signed pause", async () => {
  const played = await play("none");
  assert.deepEqual(played.streamed, ["call_1:tool-output-available"]);
  assert.deepEqual(played.states, ["call_1:output-available"]);
  assert.deepEqual(played.executed, [REFUND]);
  assert.deepEqual(played.denials, []);
}, 30_000);

/**
 * What a client of `agents` 0.33.0 sees of a denial on resume. `ai` streams a `tool-output-denied` chunk for the call,
 * but the agent treats it as a replay, because the stored part is already `approval-responded`, so it neither stores
 * nor forwards it. The part keeps its approval until the next turn, when `settleDeniedApprovals()` marks it denied, and
 * the call never runs. The model reads the denial in the continuation turn.
 */
function assertDeniedOnCloudflare(played: Played) {
  assert.deepEqual(played.streamed, [], "no output chunk reaches the client");
  assert.deepEqual(played.states, ["call_1:approval-responded"]);
}

const TAMPERED: [Change, string][] = [
  ["signature", "signature_invalid"],
  ["key-id", "signature_invalid"],
  ["input", "input_changed"],
  ["forget", "unknown_request"],
  ["needs-approval-signature", "signature_invalid"],
];

for (const [change, cause] of TAMPERED) {
  test(`in workerd, an approval after a ${change} change runs nothing, and client and model see a denial`, async () => {
    const played = await play(change);
    assert.deepEqual(played.executed, [], "execute never ran");
    assertDeniedOnCloudflare(played);
    assert.deepEqual(played.denials, [cause]);
    assert.deepEqual(
      played.outcomes.map((outcome) => [outcome.kind, outcome.reason]),
      [["not_applied", "APPROVAL_NOT_VERIFIED"]],
    );
  }, 30_000);
}

test("in workerd, a policy change between pause and resume makes recheck deny with a not_applied outcome", async () => {
  const played = await play("policy");
  assert.deepEqual(played.executed, []);
  assertDeniedOnCloudflare(played);
  assert.deepEqual(played.denials, ["policy_denied"]);
  assert.deepEqual(
    played.outcomes.map((outcome) => [outcome.kind, outcome.reason]),
    [["not_applied", "POLICY_DENIED"]],
  );
}, 30_000);

test("in workerd, the model answers a denial with a fresh request, which runs once approved", async () => {
  const played = await play("retry-after-forget");
  assert.deepEqual(played.streamed, ["call_2:tool-output-available"]);
  // The second turn settled the first call as denied, so its history held a result for every call.
  assert.deepEqual(played.states, ["call_1:output-denied", "call_2:output-available"]);
  assert.deepEqual(played.executed, [REFUND]);
  assert.deepEqual(played.denials, ["unknown_request"]);
}, 30_000);
