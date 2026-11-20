import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";
import { startWorker, type TestWorker } from "./miniflare.js";
import type { Capped } from "./workerd/scenario.js";

// A real `AIChatAgent` (`@cloudflare/ai-chat` 0.12.2, on `agents` 0.33.0) in workerd runs the AI SDK's `streamText`
// loop on a model from a provider wrapped in `costGuard()`. The guard stops the turn before the call that would cross
// the cap, as it does in Node.
const ENTRY = fileURLToPath(new URL("./workerd/cost-agent.ts", import.meta.url));

let worker: TestWorker | undefined;

beforeAll(async () => {
  worker = await startWorker(ENTRY, ["CappedAgent"]);
}, 60_000);

afterAll(async () => {
  const blocked = worker?.blocked ?? [];
  await worker?.dispose();
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

async function play(name: string, capUsd: number): Promise<Capped> {
  assert.ok(worker, "Miniflare started");
  const response = await worker.dispatch(`/${name}?cap=${capUsd}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body) as Capped;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

test("in workerd, the guard stops a Cloudflare agent's turn before the call that would cross the cap", async () => {
  const baseline = await play("baseline", 1000);
  assert.equal(baseline.refusal, null);
  assert.equal(baseline.modelCalls, 10);
  const costs = baseline.calls.map((call) => call.costUsd ?? Number.NaN);

  // Three calls fit, and the fourth's projection would pass the cap by a nano-dollar.
  const capUsd = sum(costs.slice(0, 3)) + (baseline.calls[3]?.projectedUsd ?? 0) - 1e-9;
  const capped = await play("capped", capUsd);
  assert.equal(capped.modelCalls, 3, "the model received no request past the third");
  assert.equal(capped.refusal?.code, "budget_exceeded");
  assert.equal(capped.refusal?.projectedUsd, baseline.calls[3]?.projectedUsd);
  assert.ok(capped.spentUsd <= capUsd);
  assert.ok(Math.abs(capped.spentUsd - sum(costs.slice(0, 3))) < 1e-12, "the spend is the three finish usages, priced");
}, 30_000);
