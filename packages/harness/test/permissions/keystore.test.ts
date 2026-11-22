// The file key store: a 0600 ring outside the log, rotation that keeps old keys verifying, and a prune that keeps any
// key an unresolved request still names.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { createApprovals, memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { defaultKeyPath, fileKeyStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";
import { memoryLock } from "../session/session-helpers.js";
import { refundHarness } from "./approvals-fixture.js";

const dir = mkdtempSync(join(tmpdir(), "harness-keys-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("load() creates a ring with one 256-bit key in a 0600 file inside a 0700 folder, and loads the same ring again", async () => {
  const path = join(dir, "a", "keys.json");
  const first = await fileKeyStore(path).load();
  assert.equal(Object.keys(first.keys).length, 1);
  assert.equal(first.keys[first.current]?.length, 32);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "a")).mode & 0o777, 0o700);
  const again = await fileKeyStore(path).load();
  assert.equal(again.current, first.current);
  assert.deepEqual(again.keys[again.current], first.keys[first.current]);
});

test("a ring that group or others can read is refused, and a file that is not a ring is refused", async () => {
  const path = join(dir, "b", "keys.json");
  await fileKeyStore(path).load();
  chmodSync(path, 0o640);
  await assert.rejects(
    () => fileKeyStore(path).load(),
    (error) => isHarnessError(error) && error.code === "invalid_key_store",
  );
  chmodSync(path, 0o600);
  writeFileSync(path, "not json", { mode: 0o600 });
  await assert.rejects(
    () => fileKeyStore(path).load(),
    (error) =>
      isHarnessError(error) && error.code === "invalid_key_store" && !String(error.message).includes("not json"),
  );
});

test("the default path is under XDG_STATE_HOME, and under ~/.local/state without it", () => {
  assert.equal(defaultKeyPath({ XDG_STATE_HOME: "/state" }), "/state/buildanagent/keys.json");
  assert.match(defaultKeyPath({}), /\.local\/state\/buildanagent\/keys\.json$/);
});

test("rotation adds a current key, an old key still verifies a pause, and prune keeps a key an unresolved request names", async () => {
  const keysPath = join(dir, "c", "keys.json");
  const runsFile = join(dir, "runs.log");
  const store = fileKeyStore(keysPath);
  const before = await store.load();
  const first = await refundHarness({
    steps: [{ content: [{ type: "tool_call", callId: "c1", name: "refund", input: { orderId: "o1" } }] }],
    keysPath,
    runsFile,
  });
  const session = await openSession({
    store: memoryStore(),
    index: memoryIndex(),
    lock: memoryLock(),
    key: { userId: "ada", sessionId: "s1" },
  });
  await runTurn(session, first, { input: "refund o1" });
  const [waiting] = await createApprovals(first).pending(session);
  assert.equal(waiting?.request.keyId, before.current, "signed with key a");

  const rotated = await store.rotate?.();
  assert.notEqual(rotated, before.current);
  const ring = await store.load();
  assert.equal(ring.current, rotated);
  assert.deepEqual(Object.keys(ring.keys).sort(), [before.current, rotated].sort());
  assert.deepEqual(await store.prune?.(new Set([before.current])), [], "key a is named by an unresolved request");

  const second = await refundHarness({
    steps: [{ content: [{ type: "text", text: "Refunded." }] }],
    keysPath,
    runsFile,
  });
  const resumed = await createApprovals(second).resolve(session, [
    { requestId: waiting?.request.id as string, decision: "allow", by: "ada" },
  ]);
  assert.equal(resumed.stopReason, "done", "a pause signed with key a resolves under key b");
  const stillNamed = new Set((await createApprovals(second).pending(session)).map((entry) => entry.request.keyId));
  assert.deepEqual(await store.prune?.(stillNamed), [before.current], "prune removes a once nothing names it");
  const after = JSON.parse(readFileSync(keysPath, "utf8")) as { current: string; keys: Record<string, string> };
  assert.deepEqual(Object.keys(after.keys), [rotated]);
  await session.close();
});

test("two rotations that run together keep both keys, and a symbolic link in the key's place is refused", async () => {
  const path = join(dir, "e", "keys.json");
  const store = fileKeyStore(path);
  await store.load();
  const [first, second] = await Promise.all([store.rotate?.(), fileKeyStore(path).rotate?.()]);
  const ring = await store.load();
  assert.ok(first !== undefined && second !== undefined && first !== second);
  assert.ok(first in ring.keys && second in ring.keys, "neither rotation was lost");
  const link = join(dir, "f", "keys.json");
  mkdirSync(join(dir, "f"));
  symlinkSync(path, link);
  await assert.rejects(
    () => fileKeyStore(link).load(),
    (error) => isHarnessError(error) && error.code === "invalid_key_store",
  );
});

test("prune never removes the current key", async () => {
  const store = fileKeyStore(join(dir, "d", "keys.json"));
  const ring = await store.load();
  assert.deepEqual(await store.prune?.(new Set()), []);
  assert.equal((await store.load()).current, ring.current);
});
