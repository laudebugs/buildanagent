import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, test } from "vitest";
import { startWorker, type TestWorker } from "./miniflare.js";
import type { Capped } from "./workerd/scenario.js";

// A real Cloudflare agent in workerd runs a model from a provider wrapped in `costGuard()`. The guard stops the turn
// before the call that would cross the cap, as it does in Node. The package's README tells `AIChatAgent` users to
// pass the guarded model to `streamText` and `Think` users to return it from `getModel()`, so both are tested:
// `AIChatAgent` from `@cloudflare/ai-chat` 0.12.2 and `Think` from `@cloudflare/think` 0.23.0, on `agents` 0.33.0.
const AGENTS = [
  { label: "AIChatAgent", entry: "./workerd/cost-agent.ts", binding: "CappedAgent" },
  { label: "Think", entry: "./workerd/think-agent.ts", binding: "CappedThink" },
] as const;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe.each(AGENTS)("$label", ({ label, entry, binding }) => {
  let worker: TestWorker | undefined;

  beforeAll(async () => {
    worker = await startWorker(fileURLToPath(new URL(entry, import.meta.url)), [binding]);
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

  test(`in workerd, the guard stops a ${label} turn before the call that would cross the cap`, async () => {
    const baseline = await play("baseline", 1000);
    assert.equal(baseline.refusal, null);
    assert.equal(baseline.modelCalls, 10);
    const costs = baseline.calls.map((call) => call.costUsd ?? Number.NaN);

    // Three calls fit, and the fourth's projection would pass the cap by a nano-dollar.
    const capUsd = sum(costs.slice(0, 3)) + (baseline.calls[3]?.projectedUsd ?? 0) - 1e-9;
    const capped = await play("capped", capUsd);
    assert.equal(capped.modelCalls, 3, "the model received no request past the third");
    if (label === "Think") {
      // Think's `runTurn()` returns the failed turn's message and not the error, so the refusal is checked by its text.
      assert.equal(capped.status, "error");
      assert.match(capped.error ?? "", /was not called: .* passes the cap of/);
    } else {
      assert.equal(capped.refusal?.code, "budget_exceeded");
      assert.equal(capped.refusal?.projectedUsd, baseline.calls[3]?.projectedUsd);
    }
    assert.ok(capped.spentUsd <= capUsd);
    assert.ok(
      Math.abs(capped.spentUsd - sum(costs.slice(0, 3))) < 1e-12,
      "the spend is the three finish usages, priced",
    );
  }, 30_000);
});
