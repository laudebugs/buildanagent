// Retention: nothing is deleted unless a period is set, an expired session is archived or purged, and expiry runs only
// when asked or when the store first touches a user.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { isHarnessError } from "@buildanagent/harness";
import { type EntryInput, listSessions, openSession, type SessionKey } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore, pruneSessions } from "@buildanagent/harness/session/jsonl";
import { afterAll, describe, test } from "vitest";
import { counter, header, NOW, record } from "./session-helpers.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "harness-retention-"));
  dirs.push(dir);
  return dir;
};

const OLD: SessionKey = { userId: "ada", sessionId: "old" };
const FRESH: SessionKey = { userId: "ada", sessionId: "fresh" };
// The helpers' entries are stamped 2026-01-01, and NOW is 2026-11-22, so a log of them is about 11 months old.
const TODAY = "2026-11-22T00:00:00.000Z";
const later = (days: number) => () => new Date(NOW().getTime() + days * 86_400_000);

// The real clock, so the fresh session stays fresh for a store that expires on its own clock.
const fresh = (): EntryInput[] => {
  const timestamp = new Date().toISOString();
  return [
    { ...header("fh"), timestamp },
    { ...record("fr1", "fh"), timestamp },
  ];
};

/** A folder with an old and a fresh session in it, a pointer index beside the files, and the store that wrote them. */
async function setup() {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  await store.append(OLD, [header(), record("r1", "h1"), record("r2", "r1")]);
  await store.append(FRESH, fresh());
  const index = fileIndex({ dir });
  await index.set(OLD, "old");
  return { dir, store, index };
}

const files = (dir: string, ...path: string[]) => readdirSync(join(dir, ...path)).sort();
async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

describe("with no retention set", () => {
  test("no file is ever deleted or moved, however old", async () => {
    const { dir, store } = await setup();
    const before = files(dir, "ada");
    const result = await pruneSessions({ dir, userId: "ada", now: later(10_000) });
    assert.deepEqual(result, { archived: [], purged: [], kept: [] });
    // A store without retention touches nothing on open, list, load or append either.
    const sessions = await all(store.list("ada"));
    assert.equal(sessions.length, 2);
    assert.equal((await all(store.load(OLD))).length, 3);
    assert.deepEqual(files(dir, "ada"), before);
    assert.equal(existsSync(join(dir, "archive")), false);
  });

  test("a retention that is not a positive number of days, or has an unknown action, is refused", () => {
    const code = (error: unknown) => isHarnessError(error) && error.code === "invalid_retention";
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => jsonlStore({ dir: tempDir(), retention: { days, action: "purge" } }), code);
    }
    assert.throws(() => jsonlStore({ dir: tempDir(), retention: { days: 5, action: "delete" as never } }), code);
  });
});

describe("archive", () => {
  test("an expired session is gzipped into archive/ and a fresh one is left alone", async () => {
    const { dir, store } = await setup();
    const original = Buffer.from(await readFile(join(dir, "ada", "old.jsonl")));
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    assert.deepEqual(result.archived, ["old"]);
    assert.deepEqual(
      files(dir, "ada"),
      ["fresh.jsonl", "old.pointer.json"],
      "the pointer stays, so the store finds the archive",
    );
    assert.deepEqual(files(dir, "archive", "ada"), ["old.jsonl.gz"]);
    const archived = await readFile(join(dir, "archive", "ada", "old.jsonl.gz"));
    assert.deepEqual(gunzipSync(archived), original, "the archive holds the file byte for byte");
    assert.equal((await all(store.load(FRESH))).length, 2);
  });

  test("an archived session is still listed and loaded, and its entries can be searched", async () => {
    const { dir, store, index } = await setup();
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    const summaries = await all(listSessions(store, "ada"));
    assert.deepEqual(
      summaries.map((summary) => [summary.sessionId, summary.entryCount]),
      [
        ["old", 3],
        ["fresh", 2],
      ],
    );
    const session = await openSession({ store, index, key: OLD });
    const names = (await session.path()).map((entry) => (entry.type === "product_record" ? entry.name : entry.type));
    assert.deepEqual(names, ["session_header", "test.record", "test.record"]);
    assert.equal(session.head(), "r2");
  });

  test("writing to an archived session restores its file", async () => {
    const { dir, store } = await setup();
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    await store.append(OLD, [{ ...record("r3", "r2"), timestamp: TODAY }], { expectedLastId: "r2" });
    assert.deepEqual(files(dir, "archive", "ada"), []);
    assert.equal((await all(store.load(OLD))).length, 4);
    const again = await pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 30, action: "archive" },
      now: later(1),
    });
    assert.deepEqual(again.archived, [], "the session was written today, so it is not expired");
  });

  test("a session archives with the files a revert made, and a second run does nothing more", async () => {
    const dir = tempDir();
    const store = jsonlStore({ dir });
    const index = fileIndex({ dir });
    await store.append(OLD, [header(), record("r1", "h1"), record("r2", "r1")]);
    const lock = fileLock({ dir: join(dir, "locks") });
    const session = await openSession({
      store,
      index,
      lock,
      key: OLD,
      now: () => new Date("2026-01-02T00:00:00.000Z"),
      newId: counter(),
    });
    const reverted = await session.revert("r1");
    await reverted.close();
    assert.equal(files(dir, "ada").filter((name) => name.startsWith("%7E")).length, 1);
    const options = { dir, userId: "ada", retention: { days: 30, action: "archive" as const }, now: NOW };
    const first = await pruneSessions(options);
    assert.deepEqual(first.archived, ["old"]);
    assert.equal(files(dir, "archive", "ada").length, 2, "the first file and the revert's file");
    assert.deepEqual(await pruneSessions(options), { archived: [], purged: [], kept: [] });
    const reopened = await openSession({ store, index, key: OLD });
    assert.equal(reopened.head(), "r1");
  });
});

describe("purge", () => {
  test("an expired session's files and pointer are deleted", async () => {
    const { dir, store } = await setup();
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), ["fresh.jsonl"]);
    assert.equal(existsSync(join(dir, "archive")), false);
    assert.deepEqual(await all(store.load(OLD)), []);
  });

  test("an expired session that a surviving fork continues is kept", async () => {
    const dir = tempDir();
    const store = jsonlStore({ dir });
    const index = fileIndex({ dir });
    await store.append(OLD, [header(), record("r1", "h1")]);
    const lock = fileLock({ dir: join(dir, "locks") });
    const session = await openSession({ store, index, lock, key: OLD, now: NOW, newId: counter() });
    const fork = await session.fork("r1");
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: later(1) });
    assert.deepEqual(result, { archived: [], purged: [], kept: [{ sessionId: "old", reason: "continued" }] });
    assert.equal((await fork.path()).length, 2);
  });

  test("a session whose writer holds the lock is kept", async () => {
    const { dir } = await setup();
    const lock = fileLock({ dir: join(dir, "locks") });
    const held = await lock.acquire(OLD);
    assert.notEqual(held, "would_block");
    const result = await pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 30, action: "purge" },
      now: NOW,
      lock,
    });
    assert.deepEqual(result, { archived: [], purged: [], kept: [{ sessionId: "old", reason: "locked" }] });
    assert.ok(existsSync(join(dir, "ada", "old.jsonl")));
    if (held !== "would_block") await held.release();
  });

  test("a file that cannot be read is kept", async () => {
    const { dir } = await setup();
    await writeFile(join(dir, "ada", "junk.jsonl"), "not json\n");
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.ok(existsSync(join(dir, "ada", "junk.jsonl")));
  });
});

describe("when expiry runs", () => {
  test("a store with retention expires a user's sessions the first time it touches that user, and not before", async () => {
    const { dir } = await setup();
    const store = jsonlStore({ dir, retention: { days: 30, action: "purge" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(
      files(dir, "ada"),
      ["fresh.jsonl", "old.jsonl", "old.pointer.json"],
      "building the store deletes nothing",
    );
    assert.deepEqual(
      (await all(store.list("ada"))).map((summary) => summary.sessionId),
      ["fresh"],
    );
    assert.deepEqual(files(dir, "ada"), ["fresh.jsonl"]);
  });

  test("an error in expiry goes to onRetentionError and does not stop the session", async () => {
    const dir = tempDir();
    const errors: unknown[] = [];
    // The archive folder is a file, so writing an archive fails.
    const plain = jsonlStore({ dir });
    await plain.append(OLD, [header(), record("r1", "h1")]);
    await writeFile(join(dir, "archive"), "in the way");
    const store = jsonlStore({
      dir,
      retention: { days: 30, action: "archive" },
      onRetentionError: (error) => errors.push(error),
    });
    assert.equal((await all(store.load(OLD))).length, 2);
    assert.equal(errors.length, 1);
  });
});
