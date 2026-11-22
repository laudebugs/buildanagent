import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { effectStoreConformance, planLedgerConformance } from "@buildanagent/agent-safety/testing";
import { afterAll, beforeAll, test } from "vitest";
import { startWorker, type TestWorker } from "../miniflare.js";
import type { CaseResult } from "../workerd/scenario.js";

// The stores run inside a Durable Object in workerd, on its real SQLite storage, because that is the only place
// `ctx.storage.sql` exists. The Worker runs each case in an object of its own, and each test here reports one case.
const ENTRY = fileURLToPath(new URL("../workerd/stores-agent.ts", import.meta.url));

let worker: TestWorker | undefined;

beforeAll(async () => {
  worker = await startWorker(ENTRY, ["StoreDO"]);
}, 60_000);

afterAll(async () => {
  const blocked = worker?.blocked ?? [];
  await worker?.dispose();
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

async function runCase(kind: "effect" | "ledger" | "lease", index: number, expected: string): Promise<void> {
  assert.ok(worker, "Miniflare started");
  const response = await worker.dispatch(`/${kind}?index=${index}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const result = JSON.parse(body) as CaseResult;
  assert.equal(result.name, expected, "the Worker ran another case than the test asked for");
  assert.equal(result.error, undefined, `${result.name}: ${result.error}`);
}

for (const [index, conformance] of effectStoreConformance().entries()) {
  test(`durable object effect store: ${conformance.name}`, () => runCase("effect", index, conformance.name), 30_000);
}

for (const [index, conformance] of planLedgerConformance().entries()) {
  test(`durable object plan ledger: ${conformance.name}`, () => runCase("ledger", index, conformance.name), 30_000);
}

test(
  "durable object: a started record is taken over only after its lease lapses",
  () => runCase("lease", 0, "lease scenario"),
  30_000,
);
