// Retention: nothing is deleted unless a period is set, an expired session is archived or purged, expiry runs only when
// asked or when the store first touches a user, and every doubt keeps a file.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { isHarnessError } from "@buildanagent/harness";
import {
  type EntryInput,
  type LockHandle,
  listSessions,
  openSession,
  type SessionKey,
  type SessionLock,
} from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore, pruneSessions } from "@buildanagent/harness/session/jsonl";
import { afterAll, describe, test } from "vitest";
import { counter, header, memoryLock, NOW, record } from "./session-helpers.js";

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
const ARCHIVE = ".archive";
const EMPTY = { archived: [], purged: [], kept: [], skipped: [], errors: [] };

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

/** A folder where `old` (written on 2026-01-01) has a fork, `fork`, whose entries are stamped `forkedAt`. */
async function withFork(forkedAt: () => Date) {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  const index = fileIndex({ dir });
  await store.append(OLD, [header(), record("r1", "h1")]);
  const session = await openSession({ store, index, lock: memoryLock(), key: OLD, now: forkedAt, newId: counter() });
  const fork = await session.fork("r1");
  await session.close();
  return { dir, store, index, fork, forkKey: fork.key };
}

/** A folder where `old` has a revert's file, so the session is a first file, a derived file and a pointer. */
async function withRevert() {
  const dir = tempDir();
  const store = jsonlStore({ dir });
  const index = fileIndex({ dir });
  await store.append(OLD, [header(), record("r1", "h1"), record("r2", "r1")]);
  const session = await openSession({
    store,
    index,
    lock: memoryLock(),
    key: OLD,
    now: () => new Date("2026-01-02T00:00:00.000Z"),
    newId: counter(),
  });
  const reverted = await session.revert("r1");
  await reverted.close();
  const derived = files(dir, "ada").find((name) => name.startsWith("%7E")) as string;
  return { dir, store, index, derived };
}

/** A lock that holds the named sessions, and otherwise grants every lock, optionally after `gate` resolves. */
function heldLock(held: readonly string[], gate?: { opened: Promise<void>; reached: () => void }): SessionLock {
  return {
    async acquire(key) {
      gate?.reached();
      await gate?.opened;
      if (held.includes(key.sessionId)) return "would_block";
      const handle: LockHandle = { token: key.sessionId, held: () => true, release: async () => undefined };
      return handle;
    },
  };
}

/** A gate a test opens, and a promise that resolves once the code under test reaches it. */
function gate() {
  let open = () => {};
  let reached = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { opened, reached, open, arrived };
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
    assert.deepEqual(result, EMPTY);
    // A store without retention touches nothing on open, list, load or append either.
    const sessions = await all(store.list("ada"));
    assert.equal(sessions.length, 2);
    assert.equal((await all(store.load(OLD))).length, 3);
    assert.deepEqual(files(dir, "ada"), before);
    assert.equal(existsSync(join(dir, ARCHIVE)), false);
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
  test("an expired session is gzipped into .archive/ and a fresh one is left alone", async () => {
    const { dir, store } = await setup();
    const original = Buffer.from(await readFile(join(dir, "ada", "old.jsonl")));
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    assert.deepEqual(result.archived, ["old"]);
    assert.deepEqual(
      files(dir, "ada"),
      ["fresh.jsonl", "old.pointer.json"],
      "the pointer stays, so the store finds the archive",
    );
    assert.deepEqual(files(dir, ARCHIVE, "ada"), ["old.jsonl.gz"]);
    const archived = await readFile(join(dir, ARCHIVE, "ada", "old.jsonl.gz"));
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
    assert.deepEqual(files(dir, ARCHIVE, "ada"), []);
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
    const { dir, store, index } = await withRevert();
    const options = { dir, userId: "ada", retention: { days: 30, action: "archive" as const }, now: NOW };
    const first = await pruneSessions(options);
    assert.deepEqual(first.archived, ["old"]);
    assert.equal(files(dir, ARCHIVE, "ada").length, 2, "the first file and the revert's file");
    assert.deepEqual(await pruneSessions(options), EMPTY);
    const reopened = await openSession({ store, index, key: OLD });
    assert.equal(reopened.head(), "r1");
  });

  test("the archive is in a folder no user's folder can be, so a user called archive keeps only its own files", async () => {
    const { dir } = await setup();
    const store = jsonlStore({ dir });
    await store.append({ userId: "archive", sessionId: "mine" }, fresh());
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    assert.deepEqual(files(dir, "archive"), ["mine.jsonl"]);
    assert.deepEqual(
      (await all(store.list("archive"))).map((summary) => summary.sessionId),
      ["mine"],
    );
    const result = await pruneSessions({ dir, userId: "archive", retention: { days: 30, action: "purge" } });
    assert.deepEqual(result, EMPTY, "the archive user's fresh session is not touched, and ada's archive is not theirs");
    assert.deepEqual(files(dir, ARCHIVE, "ada"), ["old.jsonl.gz"]);
  });

  test("a list unpacks an archived file once, and again only after the file changes", async () => {
    const { dir } = await setup();
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    const path = join(dir, ARCHIVE, "ada", "old.jsonl.gz");
    const stamp = new Date("2026-11-01T00:00:00.000Z");
    utimesSync(path, stamp, stamp);
    const store = jsonlStore({ dir });
    const ids = async () => (await all(store.list("ada"))).map((summary) => summary.sessionId).sort();
    assert.deepEqual(await ids(), ["fresh", "old"]);
    // Junk of the same size and time: a list that unpacked the file again would leave the session out.
    const size = (await readFile(path)).length;
    await writeFile(path, Buffer.alloc(size, 0x20));
    utimesSync(path, stamp, stamp);
    assert.deepEqual(await ids(), ["fresh", "old"], "the summary came from the cache");
    const moved = new Date("2026-11-02T00:00:00.000Z");
    utimesSync(path, moved, moved);
    assert.deepEqual(await ids(), ["fresh"], "a changed file is read again");
  });
});

describe("purge", () => {
  test("an expired session's files and pointer are deleted", async () => {
    const { dir, store } = await setup();
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), ["fresh.jsonl"]);
    assert.equal(existsSync(join(dir, ARCHIVE)), false);
    assert.deepEqual(await all(store.load(OLD)), []);
  });

  test("an expired session that a surviving fork continues is kept", async () => {
    const { dir, fork } = await withFork(NOW);
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: later(1) });
    assert.deepEqual(result, { ...EMPTY, kept: [{ sessionId: "old", reason: "continued" }] });
    assert.equal((await fork.path()).length, 2);
  });

  test("an expired fork whose writer holds the lock keeps the session it continues", async () => {
    const { dir, store, forkKey } = await withFork(() => new Date("2026-01-02T00:00:00.000Z"));
    const result = await pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 30, action: "purge" },
      now: NOW,
      lock: heldLock([forkKey.sessionId]),
    });
    assert.deepEqual(result.purged, []);
    assert.deepEqual(
      [...result.kept].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
      [
        { sessionId: forkKey.sessionId, reason: "locked" },
        { sessionId: "old", reason: "continued" },
      ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    );
    assert.equal((await all(store.load(OLD))).length, 2, "the fork's parent is still there");
  });

  test("a fork and the session it continues, both expired, are both purged", async () => {
    const { dir, forkKey } = await withFork(() => new Date("2026-01-02T00:00:00.000Z"));
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual([...result.purged].sort(), [forkKey.sessionId, "old"].sort());
    assert.deepEqual(files(dir, "ada"), []);
  });

  test("a fork that fails to purge keeps the session it continues", async () => {
    const { dir, store, forkKey } = await withFork(() => new Date("2026-01-02T00:00:00.000Z"));
    // A folder where the fork's archive copy would be makes its removal fail.
    mkdirSync(join(dir, ARCHIVE, "ada", `${forkKey.sessionId}.jsonl.gz`, "x"), { recursive: true });
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, []);
    assert.deepEqual(result.kept, [
      { sessionId: forkKey.sessionId, reason: "error" },
      { sessionId: "old", reason: "continued" },
    ]);
    assert.equal((await all(store.load(OLD))).length, 2, "the parent of a fork that is still there stays");
  });

  test("a fork whose last line can't be read keeps the session it continues, and is kept itself", async () => {
    const { dir, store, forkKey } = await withFork(() => new Date("2026-01-02T00:00:00.000Z"));
    await writeFile(join(dir, "ada", `${forkKey.sessionId}.jsonl`), "not json\n", { flag: "a" });
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, []);
    assert.deepEqual(
      [...result.kept].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
      [
        { sessionId: forkKey.sessionId, reason: "unreadable" },
        { sessionId: "old", reason: "continued" },
      ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    );
    assert.equal((await all(store.load(OLD))).length, 2);
  });

  test("a file that cannot be read is kept, and it stops every purge for the user until it goes", async () => {
    const { dir } = await setup();
    const junk = join(dir, "ada", "junk.jsonl");
    await writeFile(junk, "not json\n");
    const options = { dir, userId: "ada", retention: { days: 30, action: "purge" as const }, now: NOW };
    const result = await pruneSessions(options);
    assert.deepEqual(result.purged, []);
    assert.deepEqual(result.skipped, [junk]);
    assert.ok(result.kept.some((entry) => entry.sessionId === "old" && entry.reason === "unreadable"));
    assert.ok(existsSync(junk));
    assert.ok(existsSync(join(dir, "ada", "old.jsonl")), "the junk could have been a fork of old");
    // An archive moves nothing out of reach, so it goes ahead.
    const archived = await pruneSessions({ ...options, retention: { days: 30, action: "archive" } });
    assert.deepEqual(archived.archived, ["old"]);
    await rm(junk);
    assert.deepEqual((await pruneSessions(options)).purged, ["old"]);
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
    assert.deepEqual(result, { ...EMPTY, kept: [{ sessionId: "old", reason: "locked" }] });
    assert.ok(existsSync(join(dir, "ada", "old.jsonl")));
    if (held !== "would_block") await held.release();
  });

  test("a purge after an archive removes the archived sessions and their pointers", async () => {
    const { dir } = await withRevert();
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    assert.equal(files(dir, ARCHIVE, "ada").length, 2);
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, ["old"]);
    assert.deepEqual(files(dir, ARCHIVE, "ada"), []);
    assert.deepEqual(files(dir, "ada"), [], "the pointer went too");
  });

  test("an archived fork that survives keeps its live parent", async () => {
    const { dir, store, forkKey } = await withFork(() => new Date("2026-01-02T00:00:00.000Z"));
    // The parent is written in June, so a 200-day archive in November takes the fork and leaves the parent.
    await store.append(OLD, [{ ...record("r9", "r1"), timestamp: "2026-06-01T00:00:00.000Z" }]);
    const archived = await pruneSessions({ dir, userId: "ada", retention: { days: 200, action: "archive" }, now: NOW });
    assert.deepEqual(archived.archived, [forkKey.sessionId]);
    const result = await pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 100, action: "purge" },
      now: NOW,
      lock: heldLock([forkKey.sessionId]),
    });
    assert.deepEqual(result.purged, []);
    assert.ok(result.kept.some((entry) => entry.sessionId === "old" && entry.reason === "continued"));
    assert.equal((await all(store.load(OLD))).length, 3);
  });

  test("a session written again after an archive restores the file it writes to, and still expires later", async () => {
    const { dir, store, derived } = await withRevert();
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    const file = decodeURIComponent(derived.slice(0, -".jsonl".length));
    const tail = (await all(store.load({ userId: "ada", sessionId: file }))).at(-1);
    await store.append({ userId: "ada", sessionId: file }, [{ ...record("r7", tail?.id ?? ""), timestamp: TODAY }]);
    assert.deepEqual(files(dir, "ada"), [derived, "old.pointer.json"], "the first file stays archived");
    const early = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: later(1) });
    assert.deepEqual(early, EMPTY, "the derived file's new entry keeps the whole session fresh");
    const result = await pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 30, action: "purge" },
      now: later(40),
    });
    assert.deepEqual(result.purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), []);
    assert.deepEqual(files(dir, ARCHIVE, "ada"), []);
  });
});

describe("a run that stopped part-way", () => {
  test("is finished by the next run after the newest file went", async () => {
    const { dir, derived } = await withRevert();
    // The first step of a purge removes the newest file, the one the pointer names.
    await rm(join(dir, "ada", derived));
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), []);
  });

  test("is finished by the next run even when the first file went first", async () => {
    const { dir } = await withRevert();
    await rm(join(dir, "ada", "old.jsonl"));
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.deepEqual(result.purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), [], "the derived file and the pointer are found from the pointer");
  });

  test("a purge that stops part-way never leaves a file whose parent it removed", async () => {
    const { dir, store, index } = await withRevert();
    // A second revert, so the session is old <- ~rg1 <- ~rg2 with the pointer on ~rg2.
    const session = await openSession({
      store,
      index,
      lock: memoryLock(),
      key: OLD,
      now: () => new Date("2026-01-03T00:00:00.000Z"),
      newId: counter("x"),
    });
    const second = await session.revert("r1");
    await second.close();
    const derived = files(dir, "ada").filter((name) => name.startsWith("%7E"));
    assert.equal(derived.length, 2);
    // A folder where the older derived file's archive copy would be makes the purge stop at that file.
    const older = derived.find((name) => name !== "%7Erx1.jsonl") as string;
    mkdirSync(join(dir, ARCHIVE, "ada", `${older}.gz`, "x"), { recursive: true });
    const options = { dir, userId: "ada", retention: { days: 30, action: "purge" as const }, now: NOW };
    const result = await pruneSessions(options);
    assert.deepEqual(result.kept, [{ sessionId: "old", reason: "error" }]);
    for (const name of files(dir, "ada").filter((entry) => entry.endsWith(".jsonl"))) {
      const first = JSON.parse((await readFile(join(dir, "ada", name), "utf8")).split("\n")[0] ?? "");
      const parent = first.parent?.session as string | undefined;
      if (parent === undefined) continue;
      const encoded = encodeURIComponent(parent).replaceAll("~", "%7E");
      assert.ok(existsSync(join(dir, "ada", `${encoded}.jsonl`)), `${name} continues ${parent}, which is gone`);
    }
    rmSync(join(dir, ARCHIVE, "ada", `${older}.gz`), { recursive: true });
    assert.deepEqual((await pruneSessions(options)).purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), []);
  });

  test("an archive that stopped after the newest file is finished by the next run", async () => {
    const { dir, derived } = await withRevert();
    const options = { dir, userId: "ada", retention: { days: 30, action: "archive" as const }, now: NOW };
    await pruneSessions(options);
    // Put the first file back live, as if the run stopped after archiving only the derived file.
    await writeFile(
      join(dir, "ada", "old.jsonl"),
      gunzipSync(await readFile(join(dir, ARCHIVE, "ada", "old.jsonl.gz"))),
    );
    await rm(join(dir, ARCHIVE, "ada", "old.jsonl.gz"));
    assert.deepEqual((await pruneSessions(options)).archived, ["old"]);
    assert.deepEqual(files(dir, ARCHIVE, "ada"), [`${derived}.gz`, "old.jsonl.gz"].sort());
  });
});

describe("failures", () => {
  test("one session that fails to expire is recorded, and the others are expired", async () => {
    const { dir } = await setup();
    const plain = jsonlStore({ dir });
    await plain.append({ userId: "ada", sessionId: "other" }, [header(), record("r1", "h1")]);
    // A folder where old's archive would go makes that one write fail.
    mkdirSync(join(dir, ARCHIVE, "ada", "old.jsonl.gz", "x"), { recursive: true });
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    assert.deepEqual(result.archived, ["other"]);
    assert.deepEqual(result.kept, [{ sessionId: "old", reason: "error" }]);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.sessionId, "old");
    assert.ok(existsSync(join(dir, "ada", "old.jsonl")), "the original stays");
  });

  test("an error in expiry goes to onRetentionError and does not stop the session", async () => {
    const dir = tempDir();
    const errors: unknown[] = [];
    // The archive folder is a file, so writing an archive fails.
    const plain = jsonlStore({ dir });
    await plain.append(OLD, [header(), record("r1", "h1")]);
    await writeFile(join(dir, ARCHIVE), "in the way");
    const store = jsonlStore({
      dir,
      retention: { days: 30, action: "archive" },
      onRetentionError: (error) => errors.push(error),
    });
    assert.equal((await all(store.load(OLD))).length, 2);
    assert.equal(errors.length, 1);
  });

  test("an onRetentionError that throws stops neither the call nor any later one", async () => {
    const dir = tempDir();
    const plain = jsonlStore({ dir });
    await plain.append(OLD, [header(), record("r1", "h1")]);
    await writeFile(join(dir, ARCHIVE), "in the way");
    const store = jsonlStore({
      dir,
      retention: { days: 30, action: "archive" },
      onRetentionError: () => {
        throw new Error("the callback failed");
      },
    });
    assert.equal((await all(store.load(OLD))).length, 2);
    await store.append(OLD, [record("r2", "r1")]);
    assert.equal((await all(store.list("ada"))).length, 1);
    assert.ok(store.loadRaw);
    assert.equal((await all(store.loadRaw(OLD))).length, 3);
  });

  test("a failed pass runs again on a touch a minute later, and not before", async () => {
    const dir = tempDir();
    const plain = jsonlStore({ dir });
    await plain.append(OLD, [header(), record("r1", "h1")]);
    await writeFile(join(dir, ARCHIVE), "in the way");
    let clock = NOW().getTime();
    const errors: unknown[] = [];
    const store = jsonlStore({
      dir,
      retention: { days: 30, action: "archive" },
      onRetentionError: (error) => errors.push(error),
      now: () => new Date(clock),
    });
    await all(store.list("ada"));
    assert.equal(errors.length, 1);
    clock += 30_000;
    await all(store.list("ada"));
    assert.equal(errors.length, 1, "no new pass inside the wait");
    await rm(join(dir, ARCHIVE));
    clock += 31_000;
    await all(store.list("ada"));
    assert.equal(errors.length, 1, "the pass ran again and succeeded");
    assert.deepEqual(files(dir, ARCHIVE, "ada"), ["old.jsonl.gz"]);
  });
});

describe("a delete while expiry runs", () => {
  test("the store's delete waits for the pass, so the deleted session does not come back from the archive", async () => {
    const { dir } = await setup();
    const errors: unknown[] = [];
    const held = gate();
    const store = jsonlStore({
      dir,
      retention: { days: 30, action: "archive" },
      lock: heldLock([], held),
      onRetentionError: (error) => errors.push(error),
    });
    const listing = all(store.list("ada"));
    await held.arrived;
    const deleting = store.delete(OLD);
    await new Promise((resolve) => setTimeout(resolve, 20));
    held.open();
    await Promise.all([listing, deleting]);
    assert.deepEqual(errors, []);
    assert.equal(existsSync(join(dir, "ada", "old.jsonl")), false);
    assert.equal(existsSync(join(dir, ARCHIVE, "ada", "old.jsonl.gz")), false);
    assert.deepEqual(await all(store.load(OLD)), []);
  });

  test("a file another process deletes before its archive is written is not archived, and the run goes on", async () => {
    const { dir } = await setup();
    const held = gate();
    const running = pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 30, action: "archive" },
      now: NOW,
      lock: heldLock([], held),
    });
    await held.arrived;
    await rm(join(dir, "ada", "old.jsonl"));
    held.open();
    const result = await running;
    assert.deepEqual(result, EMPTY);
    assert.equal(existsSync(join(dir, ARCHIVE, "ada", "old.jsonl.gz")), false);
  });

  test("a file another process deletes during a purge is simply gone", async () => {
    const { dir } = await setup();
    const held = gate();
    const running = pruneSessions({
      dir,
      userId: "ada",
      retention: { days: 30, action: "purge" },
      now: NOW,
      lock: heldLock([], held),
    });
    await held.arrived;
    await rm(join(dir, "ada", "old.jsonl"));
    held.open();
    assert.deepEqual((await running).purged, ["old"]);
    assert.deepEqual(files(dir, "ada"), ["fresh.jsonl"]);
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
});
