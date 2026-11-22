// HD2's crash test: a writer is killed with SIGKILL in the middle of appending, and a new writer must get the lock within
// one lease and read every complete entry. The lease is shortened to a second and a half for the test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "harness-crash-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const KEY = { userId: "ada", sessionId: "crash" };
const LEASE_MS = 1500;
const RENEW_MS = 300;
const writer = fileURLToPath(new URL("./crash-writer.ts", import.meta.url));
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

test("after SIGKILL mid-append, a new writer gets the lock within one lease and every complete entry loads", async () => {
  // A cleared environment, as every spawned process gets: no inherited credential reaches the child.
  const child = spawn(
    process.execPath,
    ["--conditions=source", "--import", "tsx", writer, dir, String(LEASE_MS), String(RENEW_MS)],
    {
      cwd: packageDir,
      env: spawnEnv([]),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("ready")) resolve();
    });
    child.on("exit", (code) => reject(new Error(`the writer exited with ${code} before it was ready: ${errors}`)));
  });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  child.kill("SIGKILL");
  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });

  const lock = fileLock({ dir: join(dir, "locks"), leaseMs: LEASE_MS, renewMs: RENEW_MS });
  assert.equal(await lock.acquire(KEY), "would_block", "the dead writer's lease has not lapsed yet");
  const killedAt = Date.now();
  let handle = await lock.acquire(KEY);
  while (handle === "would_block" && Date.now() - killedAt < LEASE_MS + 2000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    handle = await lock.acquire(KEY);
  }
  assert.notEqual(handle, "would_block", "a new writer took the lock once the lease lapsed");
  assert.ok(Date.now() - killedAt <= LEASE_MS + 1000, "and within about one lease");

  const store = jsonlStore({ dir: join(dir, "sessions") });
  const reports: number[] = [];
  const loaded: { id: string; seq: number }[] = [];
  for await (const entry of store.load(KEY, { onTornLine: (line) => reports.push(line.bytes) })) loaded.push(entry);
  assert.ok(loaded.length > 20, "the entries written before the kill are there");
  assert.deepEqual(
    loaded.map((entry) => entry.seq),
    loaded.map((_, index) => index),
    "every complete entry loads, in order, with no gap",
  );
  assert.ok(reports.length <= 1, "at most one torn line, and it is reported");

  // The new writer carries on: the next append cuts off a torn tail and extends the log.
  const last = loaded.at(-1);
  await store.append(
    KEY,
    [
      {
        id: "after",
        parentId: last?.id ?? null,
        timestamp: "2026-01-01T00:00:02.000Z",
        origin: "harness",
        type: "product_record",
        name: "test.record",
        data: {},
      },
    ],
    { expectedLastId: last?.id ?? null },
  );
  const reloaded: string[] = [];
  for await (const entry of store.load(KEY, { onTornLine: () => assert.fail("the log is whole again") }))
    reloaded.push(entry.id);
  assert.equal(reloaded.at(-1), "after");
  if (handle !== "would_block") await handle.release();
}, 30_000);
