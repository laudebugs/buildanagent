// Migration by pointer: a new file is written, checked and then published by moving the pointer, and the old file is
// never touched. Format 0 is a made-up older format, because only format 1 exists: it spelled a header's `harnessVersion`
// as `harness_version`, and the migration renames it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import {
  type Migration,
  memoryIndex,
  memoryStore,
  migrateSession,
  openSession,
  type SessionIndex,
} from "@buildanagent/harness/session";
import { fileIndex, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";
import { header, KEY, memoryLock, record } from "./session-helpers.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ZERO_TO_ONE: Migration = {
  from: 0,
  to: 1,
  migrate(entry) {
    const { harness_version, ...rest } = entry as Record<string, unknown>;
    return entry && (entry as { type?: string }).type === "session_header"
      ? { ...rest, formatVersion: 1, harnessVersion: harness_version }
      : rest;
  },
};

const line = (value: unknown, seq: number) => JSON.stringify({ ...(value as object), seq });

/** A folder with a session file written in format 0, with its store and index. */
function oldSession(version = 0) {
  const dir = mkdtempSync(join(tmpdir(), "harness-migrate-"));
  dirs.push(dir);
  const sessions = join(dir, "sessions");
  mkdirSync(join(sessions, "ada"), { recursive: true });
  const { harnessVersion, ...rest } = header() as unknown as Record<string, unknown>;
  const lines = [
    { ...rest, formatVersion: version, harness_version: harnessVersion },
    record("r1", "h1"),
    record("r2", "r1"),
  ];
  const path = join(sessions, "ada", "s1.jsonl");
  writeFileSync(path, `${lines.map((entry, seq) => line(entry, seq)).join("\n")}\n`);
  return { dir, path, store: jsonlStore({ dir: sessions }), index: fileIndex({ dir: join(dir, "pointers") }) };
}

async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

const code = (expected: string) => (error: unknown) => isHarnessError(error) && error.code === expected;

test("an old log can't be loaded as it is, and migrating it writes a new file and moves the pointer", async () => {
  const { path, store, index } = oldSession();
  const before = readFileSync(path);
  await assert.rejects(() => all(store.load(KEY)), code("unsupported_format"));
  const result = await migrateSession({ lock: memoryLock(), store, index, key: KEY, migrations: [ZERO_TO_ONE] });
  assert.ok(result.migrated && result.from === 0 && result.to === 1 && result.entries === 3);
  assert.equal(await index.get(KEY), result.file);
  assert.ok(readFileSync(path).equals(before), "the old file is byte-identical");
  const session = await openSession({ store, index, key: KEY });
  assert.equal(session.head(), "r2");
  assert.deepEqual(
    (await session.path()).map((entry) => entry.id),
    ["h1", "r1", "r2"],
  );
  const first = (await session.path())[0];
  assert.ok(first?.type === "session_header" && first.harnessVersion === "0.1.0" && first.formatVersion === 1);
});

test("a log already in the current format is left alone", async () => {
  const store = memoryStore();
  const index = memoryIndex();
  await store.append(KEY, [header(), record("r1", "h1")]);
  assert.deepEqual(await migrateSession({ lock: memoryLock(), store, index, key: KEY, migrations: [] }), {
    migrated: false,
    version: 1,
  });
  assert.equal(await index.get(KEY), undefined);
});

test("a log from a newer format is refused, and so is one no migration reaches", async () => {
  const newer = oldSession(2);
  await assert.rejects(
    () => migrateSession({ lock: memoryLock(), ...newer, key: KEY, migrations: [ZERO_TO_ONE] }),
    code("unsupported_format"),
  );
  const gap = oldSession(0);
  await assert.rejects(
    () => migrateSession({ lock: memoryLock(), ...gap, key: KEY, migrations: [] }),
    code("unsupported_format"),
  );
  await assert.rejects(
    () =>
      migrateSession({
        lock: memoryLock(),
        ...gap,
        key: KEY,
        migrations: [{ from: 0, to: 0, migrate: (entry) => entry }],
      }),
    code("unsupported_format"),
  );
  assert.equal(await gap.index.get(KEY), undefined, "no pointer moved");
});

test("a session with no entries, or none that start with a header, can't be migrated", async () => {
  const { store, index } = oldSession();
  await assert.rejects(
    () =>
      migrateSession({ lock: memoryLock(), store, index, key: { userId: "ada", sessionId: "nope" }, migrations: [] }),
    code("unsupported_format"),
  );
});

test("a crash between writing the migrated file and moving the pointer leaves the old pointer valid", async () => {
  const { dir, path, store, index } = oldSession();
  await index.set(KEY, "s1");
  const failing: SessionIndex = {
    get: (key) => index.get(key),
    set: async () => {
      throw new Error("crash before the rename");
    },
  };
  await assert.rejects(
    () => migrateSession({ lock: memoryLock(), store, index: failing, key: KEY, migrations: [ZERO_TO_ONE] }),
    /crash before the rename/,
  );
  assert.equal(await index.get(KEY), "s1", "the pointer still names the old file");
  assert.ok(
    readdirSync(join(dir, "sessions", "ada")).length === 2,
    "the new file was written and is waiting, unpublished",
  );
  assert.ok(readFileSync(path).length > 0);
});

test("a migration that produces an invalid entry writes no file and moves no pointer", async () => {
  const { dir, store, index } = oldSession();
  const broken: Migration = { from: 0, to: 1, migrate: (entry) => ({ ...(entry as object), type: "not_a_type" }) };
  await assert.rejects(() => migrateSession({ lock: memoryLock(), store, index, key: KEY, migrations: [broken] }));
  assert.equal(await index.get(KEY), undefined);
  assert.deepEqual(readdirSync(join(dir, "sessions", "ada")), ["s1.jsonl"]);
});

test("the pointer file is replaced by a rename, so a leftover temp file doesn't break it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-pointer-"));
  dirs.push(dir);
  const index = fileIndex({ dir });
  assert.equal(await index.get(KEY), undefined);
  await index.set(KEY, "a");
  await index.set(KEY, "b");
  assert.equal(await index.get(KEY), "b");
  writeFileSync(join(dir, "ada", "s1.pointer.json.abandoned.tmp"), "{");
  assert.equal(await index.get(KEY), "b");
  assert.equal(
    await fileIndex({ dir }).get({ userId: "bob", sessionId: "s1" }),
    undefined,
    "another user has no pointer",
  );
  assert.equal(JSON.parse(readFileSync(join(dir, "ada", "s1.pointer.json"), "utf8")).file, "b");
});

test("a migration takes the session's lock, and is refused while a writer holds it", async () => {
  const { store, index } = oldSession();
  const lock = memoryLock();
  const writer = await lock.acquire(KEY);
  assert.notEqual(writer, "would_block");
  await assert.rejects(
    () => migrateSession({ store, index, key: KEY, lock, migrations: [ZERO_TO_ONE] }),
    code("session_locked"),
  );
  if (writer !== "would_block") await writer.release();
  const result = await migrateSession({ store, index, key: KEY, lock, migrations: [ZERO_TO_ONE] });
  assert.ok(result.migrated, "and the lock was free again once the writer let go");
  assert.notEqual(await lock.acquire(KEY), "would_block", "and the migration released it");
});

test("a file that continues a parent file is refused, because its parent would stay in the old format", async () => {
  const { path, store, index } = oldSession();
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  const first = JSON.parse(lines[0] as string);
  writeFileSync(
    path,
    `${[JSON.stringify({ ...first, parent: { session: "p", entryId: "x" } }), ...lines.slice(1)].join("\n")}\n`,
  );
  await assert.rejects(
    () => migrateSession({ store, index, key: KEY, lock: memoryLock(), migrations: [ZERO_TO_ONE] }),
    code("unsupported_format"),
  );
  assert.equal(await index.get(KEY), undefined);
});

test("a log the store can't read for another reason than a format is not reported as one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-migrate-"));
  dirs.push(dir);
  mkdirSync(join(dir, "sessions", "ada", "s1.jsonl"), { recursive: true });
  await assert.rejects(
    () =>
      migrateSession({
        store: jsonlStore({ dir: join(dir, "sessions") }),
        index: memoryIndex(),
        key: KEY,
        lock: memoryLock(),
        migrations: [],
      }),
    (error) => !isHarnessError(error) || error.code !== "unsupported_format",
  );
});

test("a log that is already current is left alone even when its file continues a parent", async () => {
  const store = memoryStore();
  const index = memoryIndex();
  await store.append(KEY, [header(), record("r1", "h1")]);
  const session = await openSession({
    store,
    index,
    key: KEY,
    lock: memoryLock(),
    newId: (() => {
      let n = 0;
      return () => `g${++n}`;
    })(),
  });
  await session.revert("r1");
  await session.close();
  assert.deepEqual(await migrateSession({ store, index, key: KEY, lock: memoryLock(), migrations: [] }), {
    migrated: false,
    version: 1,
  });
});

test("a pointer that can't be written leaves no temp file behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-pointer-"));
  dirs.push(dir);
  const index = fileIndex({ dir });
  await index.set(KEY, "a");
  // The pointer's own path is a folder, so the rename over it fails after the temp file was written.
  rmSync(join(dir, "ada", "s1.pointer.json"));
  mkdirSync(join(dir, "ada", "s1.pointer.json"));
  await assert.rejects(() => index.set(KEY, "b"));
  assert.deepEqual(readdirSync(join(dir, "ada")), ["s1.pointer.json"]);
});
