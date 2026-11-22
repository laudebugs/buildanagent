// The suite that pins the session store runs here against the in-memory store and the JSONL store, which writes real
// files in a temp folder. Each case gets a fresh store.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@buildanagent/harness/session";
import { jsonlStore } from "@buildanagent/harness/session/jsonl";
import { runStoreConformance, type StoreFactory, storeConformanceCases } from "@buildanagent/harness/testing";
import { afterAll, test } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const memoryFactory: StoreFactory = () => ({ store: memoryStore() });
const jsonlFactory: StoreFactory = () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-store-"));
  dirs.push(dir);
  return {
    store: jsonlStore({ dir }),
    // A crash in the middle of a write leaves JSON with no newline at the end of the file. These keys need no encoding.
    tearLastLine: (key) => {
      appendFileSync(join(dir, key.userId, `${key.sessionId}.jsonl`), '{"id":"torn","parentId":"r1","seq":2,"time');
    },
  };
};

const backends: [string, StoreFactory][] = [
  ["the memory store", memoryFactory],
  ["the JSONL store", jsonlFactory],
];

for (const [label, factory] of backends) {
  for (const conformance of storeConformanceCases(factory)) {
    test(`${label}: ${conformance.name}`, async (context) => {
      const outcome = await conformance.run();
      if (outcome !== undefined) context.skip(outcome.skipped);
    });
  }
}

test("the JSONL store passes every case, and the memory store skips only the torn-line cases", async () => {
  const file = await runStoreConformance(jsonlFactory);
  assert.deepEqual(file.failed, []);
  assert.deepEqual(file.skipped, []);
  const memory = await runStoreConformance(memoryFactory);
  assert.deepEqual(memory.failed, []);
  assert.equal(memory.skipped.length, 2);
});
