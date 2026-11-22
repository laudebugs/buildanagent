// What the conformance suite doesn't cover: the types, the files the JSONL store writes, and how it behaves with more
// than one store or writer on one folder.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import {
  ConflictError,
  type EntryInput,
  EntryTooLargeError,
  memoryStore,
  type SessionStore,
} from "@buildanagent/harness/session";
import { jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-jsonl-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const KEY = { userId: "ada", sessionId: "s1" };
const header = (): EntryInput => ({
  id: "h1",
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
});
const record = (id: string, parentId: string, data: unknown = {}): EntryInput => ({
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  origin: "harness",
  type: "product_record",
  name: "test.record",
  data,
});
async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

test("every method needs the user as well as the session id, which a type test shows", async () => {
  const store: SessionStore = memoryStore();
  // Each call is a function that is never run, so a compile error is all that can happen.
  const calls = [
    // @ts-expect-error a session id alone is not a key
    () => store.append("s1", [header()]),
    // @ts-expect-error a session id alone is not a key
    () => store.load("s1"),
    // @ts-expect-error a session id alone is not a key
    () => store.delete("s1"),
    // @ts-expect-error list takes the user, not a key or nothing
    () => store.list(),
    // @ts-expect-error a caller doesn't supply seq: the store assigns it
    () => store.append(KEY, [{ ...header(), seq: 0 }]),
  ];
  assert.equal(calls.length, 5);
});

test("the memory store hands out copies, so a caller can't change a stored entry", async () => {
  const store = memoryStore();
  const [written] = await store.append(KEY, [header()]);
  (written as { harnessVersion: string }).harnessVersion = "changed";
  const [loaded] = await all(store.load(KEY));
  assert.equal(loaded?.type === "session_header" ? loaded.harnessVersion : "", "0.0.0");
});

test("the JSONL store writes one complete line per entry, under a folder for the user", async () => {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append(KEY, [header(), record("r1", "h1"), record("r2", "r1")]);
  const text = readFileSync(join(dir, "ada", "s1.jsonl"), "utf8");
  assert.ok(text.endsWith("\n"), "the file ends with a newline");
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((line) => (JSON.parse(line) as { seq: number }).seq),
    [0, 1, 2],
  );
});

test("an id that looks like a path stays inside its folder", async () => {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append({ userId: "..", sessionId: "../../escape" }, [header()]);
  assert.deepEqual(readdirSync(dir), ["%2E%2E"], "the user '..' is a folder named with encoded dots");
  assert.deepEqual(readdirSync(join(dir, "%2E%2E")), ["%2E%2E%2F%2E%2E%2Fescape.jsonl"]);
  const [listed] = await all(store.list(".."));
  assert.equal(listed?.sessionId, "../../escape", "the name decodes back");
});

test("a second store on the same folder is seen, so a stale tail conflicts", async () => {
  const dir = tempDir();
  const first = jsonlStore({ dir });
  const second = jsonlStore({ dir });
  await first.append(KEY, [header()]);
  await second.append(KEY, [record("r1", "h1")], { expectedLastId: "h1" });
  await assert.rejects(
    () => first.append(KEY, [record("r2", "h1")], { expectedLastId: "h1" }),
    (error) => error instanceof ConflictError,
  );
  const written = await first.append(KEY, [record("r2", "r1")], { expectedLastId: "r1" });
  assert.equal(written[0]?.seq, 2, "the first store saw the second store's write");
});

test("concurrent appends to one session run one at a time, so only one wins a compare-and-swap", async () => {
  const store = jsonlStore({ dir: tempDir() });
  await store.append(KEY, [header()]);
  const attempts = await Promise.allSettled(
    ["a", "b", "c"].map((id) => store.append(KEY, [record(id, "h1")], { expectedLastId: "h1" })),
  );
  assert.deepEqual(
    attempts.map((attempt) => attempt.status),
    ["fulfilled", "rejected", "rejected"],
  );
  assert.equal((await all(store.load(KEY))).length, 2);
});

test("a bad line before the last one is a session_corrupt error, and not skipped", async () => {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append(KEY, [header(), record("r1", "h1")]);
  const path = join(dir, "ada", "s1.jsonl");
  const [first, second] = readFileSync(path, "utf8").trimEnd().split("\n");
  writeFileSync(path, `${first}\n{"broken\n${second}\n`);
  await assert.rejects(
    () => all(store.load(KEY)),
    (error) => isHarnessError(error) && error.code === "session_corrupt",
  );
});

test("a torn line is cut off by the next append, even from a store that never read the file", async () => {
  const dir = tempDir();
  await jsonlStore({ dir }).append(KEY, [header(), record("r1", "h1")]);
  appendFileSync(join(dir, "ada", "s1.jsonl"), '{"id":"torn"');
  const fresh = jsonlStore({ dir });
  await fresh.append(KEY, [record("r2", "r1")]);
  const text = readFileSync(join(dir, "ada", "s1.jsonl"), "utf8");
  assert.ok(!text.includes("torn"));
  assert.equal((await all(fresh.load(KEY))).length, 3);
});

test("maxEntryBytes sets the bound, on both stores, and counts bytes and not characters", async () => {
  for (const store of [memoryStore({ maxEntryBytes: 400 }), jsonlStore({ dir: tempDir(), maxEntryBytes: 400 })]) {
    await store.append(KEY, [header()]);
    await store.append(KEY, [record("r1", "h1", { text: "x".repeat(100) })]);
    await assert.rejects(
      () => store.append(KEY, [record("r2", "r1", { text: "é".repeat(200) })]),
      (error) => error instanceof EntryTooLargeError && error.bytes > 400 && error.maxBytes === 400,
    );
  }
});

test("a folder with files that aren't sessions is listed without them", async () => {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append(KEY, [header()]);
  writeFileSync(join(dir, "ada", "notes.txt"), "not a session");
  mkdirSync(join(dir, "ada", "sub.jsonl"));
  assert.deepEqual(
    (await all(store.list("ada"))).map((summary) => summary.sessionId),
    ["s1"],
  );
});

test("a delete queued behind an append leaves no log, and the session can be created again", async () => {
  const store = jsonlStore({ dir: tempDir() });
  await store.append(KEY, [header(), record("r1", "h1")]);
  const appending = store.append(KEY, [record("r2", "r1")]);
  const deleting = store.delete(KEY);
  await Promise.all([appending, deleting]);
  assert.deepEqual(await all(store.load(KEY)), [], "the delete ran after the append, so nothing is left");
  await store.append(KEY, [header()], { expectedLastId: null });
  assert.equal((await all(store.load(KEY))).length, 1);
});

test("a load that starts during an append waits for it, so it never sees a half-written line", async () => {
  const store = jsonlStore({ dir: tempDir() });
  const batch = [
    header(),
    ...Array.from({ length: 200 }, (_, i) => record(`r${i}`, i === 0 ? "h1" : `r${i - 1}`, { pad: "x".repeat(500) })),
  ];
  const appending = store.append(KEY, batch);
  let torn = 0;
  const loaded = await all(store.load(KEY, { onTornLine: () => (torn += 1) }));
  await appending;
  assert.equal(torn, 0);
  assert.equal(loaded.length, batch.length);
});

test("one corrupt file, or a file the store didn't write, hides no other session from list()", async () => {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append(KEY, [header()]);
  await store.append({ userId: "ada", sessionId: "bad" }, [header(), record("r1", "h1")]);
  const bad = join(dir, "ada", "bad.jsonl");
  const [first] = readFileSync(bad, "utf8").split("\n");
  writeFileSync(bad, `${first}\n{"broken\n${first}\n`);
  writeFileSync(join(dir, "ada", "50%.jsonl"), "{}\n");
  assert.deepEqual(
    (await all(store.list("ada"))).map((summary) => summary.sessionId),
    ["s1"],
  );
});

test("a rejected key rejects the promise and does not throw at the call", async () => {
  for (const store of [memoryStore(), jsonlStore({ dir: tempDir() })]) {
    const pending = store.append({ userId: "", sessionId: "s" }, [header()]);
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, (error) => isHarnessError(error) && error.code === "invalid_session_key");
  }
});

test("a bad key throws at load() and list(), before the first read", () => {
  for (const store of [memoryStore(), jsonlStore({ dir: tempDir() })]) {
    assert.throws(
      () => store.load({ userId: "", sessionId: "s" }),
      (error) => isHarnessError(error) && error.code === "invalid_session_key",
    );
    assert.throws(
      () => store.list(""),
      (error) => isHarnessError(error) && error.code === "invalid_session_key",
    );
  }
});

test("a torn tail that cuts a multi-byte character is reported in bytes, and the next append cuts it at the right place", async () => {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append(KEY, [header(), record("r1", "h1", { text: "é" })]);
  const path = join(dir, "ada", "s1.jsonl");
  appendFileSync(path, Buffer.from([0x7b, 0x22, 0xc3]));
  const reports: number[] = [];
  const loaded = await all(store.load(KEY, { onTornLine: (line) => reports.push(line.bytes) }));
  assert.equal(loaded.length, 2);
  assert.deepEqual(reports, [3], "the unterminated tail is three bytes, one of them half a character");
  await jsonlStore({ dir }).append(KEY, [record("r2", "r1")]);
  assert.equal((await all(jsonlStore({ dir }).load(KEY))).length, 3);
});
