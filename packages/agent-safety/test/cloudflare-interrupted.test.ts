import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";
import { startWorker, type TestWorker } from "./miniflare.js";
import type { Repaired } from "./workerd/scenario.js";

// A real `AIChatAgent` (`@cloudflare/ai-chat` 0.12.2) in workerd repairs a stored `send_email` call that never got a
// result before its next turn. The default repair records an error; the override records an `unknown` outcome.
const ENTRY = fileURLToPath(new URL("./workerd/interrupted-agent.ts", import.meta.url));
const DEFAULT_TEXT = "The tool call was interrupted before a result was recorded.";

let worker: TestWorker | undefined;

beforeAll(async () => {
  worker = await startWorker(ENTRY, ["DefaultRepairAgent", "GuardedRepairAgent"]);
}, 60_000);

afterAll(async () => {
  const blocked = worker?.blocked ?? [];
  await worker?.dispose();
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

async function play(agent: "default" | "guarded"): Promise<Repaired> {
  assert.ok(worker, "Miniflare started");
  const response = await worker.dispatch(`/${agent}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const repaired = JSON.parse(body) as Repaired;
  assert.equal(repaired.status, "completed");
  assert.equal(repaired.sent, 0, "the interrupted write never ran again");
  return repaired;
}

test("in workerd, the default repair hands the model an interrupted write as an error it may retry", async () => {
  const repaired = await play("default");
  assert.deepEqual(repaired.stored, { state: "output-error", errorText: DEFAULT_TEXT });
  assert.deepEqual(repaired.modelRead, [{ type: "error-text", value: DEFAULT_TEXT }]);
}, 30_000);

test("in workerd, repairInterruptedWrite hands the model an interrupted write as an unknown outcome", async () => {
  const repaired = await play("guarded");
  const stored = repaired.stored.output as { kind: string; retry: string; reason: string };
  assert.equal(repaired.stored.state, "output-available");
  assert.equal(repaired.stored.errorText, undefined);
  assert.deepEqual([stored.kind, stored.retry, stored.reason], ["unknown", "reconcile_first", "WRITE_INTERRUPTED"]);
  const [read] = repaired.modelRead as { type: string; value: { kind: string; message: string } }[];
  assert.equal(read?.type, "error-json");
  assert.equal(read?.value.kind, "unknown");
  assert.match(read?.value.message ?? "", /It is not known whether the send_email call took effect/);
}, 30_000);
