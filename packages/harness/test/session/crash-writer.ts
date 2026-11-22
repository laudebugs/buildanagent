// The child of the crash test. It takes the session's lock, then appends entries as fast as it can, and the test kills it
// with SIGKILL in the middle of the loop. It prints "ready" once it has written a few entries, so the kill lands mid-write.

import process from "node:process";
import { fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";

const [dir, leaseMs, renewMs] = process.argv.slice(2);
const key = { userId: "ada", sessionId: "crash" };
const lock = await fileLock({ dir: `${dir}/locks`, leaseMs: Number(leaseMs), renewMs: Number(renewMs) }).acquire(key);
if (lock === "would_block") throw new Error("the child could not take the lock");
const store = jsonlStore({ dir: `${dir}/sessions` });
await store.append(key, [
  {
    id: "h",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    origin: "harness",
    type: "session_header",
    formatVersion: 1,
    harnessVersion: "0.0.0",
    sdkVersion: "0.0.0",
    defaultsHash: "d",
    capabilities: [],
    ablationHash: "a",
  },
]);
for (let n = 0; ; n += 1) {
  await store.append(key, [
    {
      id: `e${n}`,
      parentId: n === 0 ? "h" : `e${n - 1}`,
      timestamp: "2026-01-01T00:00:01.000Z",
      origin: "harness",
      type: "product_record",
      name: "test.record",
      // Large enough that a kill is likely to land inside a write.
      data: { n, pad: "x".repeat(8000) },
    },
  ]);
  if (n === 20) console.log("ready");
}
