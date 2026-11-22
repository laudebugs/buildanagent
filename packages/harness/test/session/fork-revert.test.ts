// Fork, revert and child: each writes a new file, none rewrites one, and a path crosses from a branch into its parent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { openSession, type SessionIndex } from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { BACKENDS, type Backend, counter, KEY, NOW, record, seed } from "./session-helpers.js";

const opts = (backend: Backend, extra: object = {}) => ({
  store: backend.store,
  index: backend.index,
  lock: backend.lock,
  key: KEY,
  now: NOW,
  newId: counter(),
  ...extra,
});

const ids = (entries: readonly { id: string }[]) => entries.map((entry) => entry.id);
const code = (expected: string) => (error: unknown) => isHarnessError(error) && error.code === expected;

async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

/** The bytes of a session file in the file backend. */
const bytesOf = (backend: Backend, file: string) =>
  readFileSync(join(backend.dir as string, "sessions", "ada", `${file}.jsonl`));

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a fork is a new session whose path includes the parent prefix without copying it", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const fork = await session.fork("r2");
    assert.notEqual(fork.key.sessionId, KEY.sessionId);
    assert.equal(fork.key.userId, "ada");
    assert.equal(fork.head(), "r2", "the fork starts at the entry it was made from");
    assert.deepEqual(ids(await fork.path()), ["h1", "r1", "r2"]);
    const own = await all(backend.store.load({ userId: "ada", sessionId: fork.file() }));
    assert.deepEqual(
      own.map((entry) => entry.type),
      ["session_header", "checkout"],
      "its own file holds a header and a checkout, no copy",
    );
    const header = own[0];
    assert.ok(header?.type === "session_header" && header.parent?.entryId === "r2" && header.parent.session === "s1");
    await fork.append([record("f1", "r2")]);
    assert.deepEqual(ids(await fork.path()), ["h1", "r1", "r2", "f1"]);
    assert.deepEqual(ids(await session.path()), ["h1", "r1", "r2", "r3"], "the original is unchanged");
    await fork.close();
    await session.close();
  });

  test("a fork inherits what ran the session, and a fork of a fork crosses two files", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const first = await session.fork("r2");
    await first.append([record("f1", "r2")]);
    const second = await first.fork("f1");
    await second.append([record("g1", "f1")]);
    assert.deepEqual(ids(await second.path()), ["h1", "r1", "r2", "f1", "g1"]);
    const [header] = await all(backend.store.load({ userId: "ada", sessionId: second.file() }));
    assert.ok(
      header?.type === "session_header" &&
        header.harnessVersion === "0.1.0" &&
        header.capabilities.join() === "steering_v1" &&
        header.parent?.entryId === "f1",
    );
    await second.close();
    await first.close();
    await session.close();
  });

  test("a fork can be reopened under its own key", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const fork = await session.fork("r1");
    await fork.append([record("f1", "r1")]);
    await fork.close();
    const again = await openSession({ ...opts(backend), key: fork.key });
    assert.equal(again.head(), "f1");
    assert.deepEqual(ids(await again.path()), ["h1", "r1", "f1"]);
    await again.close();
    await session.close();
  });

  test("a revert moves the pointer to a new file, and the session goes on from the entry", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const before = await backend.index.get(KEY);
    assert.equal(before, undefined, "a session no one has moved has no pointer");
    const returned = await session.revert("r1");
    assert.equal(returned, session, "revert returns the same session, now on the new file");
    assert.notEqual(session.file(), "s1");
    assert.equal(await backend.index.get(KEY), session.file());
    assert.equal(session.head(), "r1");
    assert.deepEqual(ids(await session.path()), ["h1", "r1"]);
    await session.append([record("n1", "r1")]);
    assert.deepEqual(ids(await session.path()), ["h1", "r1", "n1"]);
    assert.deepEqual(
      ids(await session.path("r3")),
      ["h1", "r1", "r2", "r3"],
      "the reverted entries are still reachable through the parent",
    );
    await session.close();
    const again = await openSession(opts(backend));
    assert.equal(again.file(), session.file(), "a reload follows the pointer");
    assert.equal(again.head(), "n1");
    await again.close();
  });

  test("a revert leaves the original file untouched, and so do later appends", async () => {
    const backend = make();
    await seed(backend);
    const originalEntries = await all(backend.store.load(KEY));
    const original = backend.dir === undefined ? undefined : bytesOf(backend, "s1");
    const session = await openSession(opts(backend));
    await session.revert("r1");
    await session.append([record("n1", "r1"), record("n2", "n1")]);
    await session.revert("n1");
    assert.deepEqual(await all(backend.store.load(KEY)), originalEntries);
    if (original !== undefined) assert.ok(bytesOf(backend, "s1").equals(original), "byte for byte");
    assert.deepEqual(ids(await session.path()), ["h1", "r1", "n1"], "two reverts chain through three files");
    await session.close();
  });

  test("a crash between writing the new file and moving the pointer leaves the old file in use", async () => {
    const backend = make();
    await seed(backend);
    const failing: SessionIndex = {
      get: (key) => backend.index.get(key),
      async set() {
        throw new Error("crash before the rename");
      },
    };
    const session = await openSession(opts(backend, { index: failing }));
    await assert.rejects(() => session.revert("r1"), /crash before the rename/);
    assert.equal(session.file(), "s1", "the session still reads the old file");
    assert.equal(session.head(), "r3");
    await session.close();
    const again = await openSession(opts(backend));
    assert.equal(again.file(), "s1");
    assert.deepEqual(ids(await again.path()), ["h1", "r1", "r2", "r3"]);
    await again.close();
  });

  test("fork and revert of an entry that isn't in the log are entry_not_found, and write nothing", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    await assert.rejects(() => session.fork("nope"), code("entry_not_found"));
    await assert.rejects(() => session.revert("nope"), code("entry_not_found"));
    assert.equal(await backend.index.get(KEY), undefined);
    await session.close();
  });

  test("child({ stepId }) writes a subagent_link with stepId and no spawningCallId, and child({ spawningCallId }) the reverse", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const reader = await session.child({ stepId: "step:reader" });
    const caller = await session.child({ spawningCallId: "call-7" });
    const links = (await session.path()).filter((entry) => entry.type === "subagent_link");
    assert.equal(links.length, 2);
    const [byStep, byCall] = links;
    assert.ok(byStep?.type === "subagent_link" && byStep.stepId === "step:reader" && !("spawningCallId" in byStep));
    assert.ok(byCall?.type === "subagent_link" && byCall.spawningCallId === "call-7" && !("stepId" in byCall));
    assert.equal(byStep.childSession, reader.key.sessionId);
    assert.equal(byCall.childSession, caller.key.sessionId);
    assert.equal(session.head(), byCall.id, "each link moves HEAD, as any entry does");
    assert.equal(reader.head(), reader.head());
    const [childHeader] = await all(backend.store.load(reader.key));
    assert.ok(
      childHeader?.type === "session_header" && childHeader.parent === undefined,
      "a child is its own log, with no parent prefix",
    );
    assert.deepEqual(ids(await reader.path()), [childHeader.id]);
    await reader.close();
    await caller.close();
    await session.close();
  });

  test("a child link needs exactly one of spawningCallId and stepId", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    await assert.rejects(
      () => session.child({ spawningCallId: "c", stepId: "s" } as never),
      code("invalid_session_entry"),
    );
    await assert.rejects(() => session.child({} as never), code("invalid_session_entry"));
    assert.equal(session.head(), "r3", "nothing was written");
    await session.close();
  });

  test("a session with no entries has nothing to branch from, and a reader can't branch", async () => {
    const backend = make();
    const empty = await openSession(opts(backend));
    await assert.rejects(() => empty.fork("x"), code("entry_not_found"));
    await empty.close();
    await seed(backend);
    const { lock: _lock, ...readOnly } = opts(backend);
    const reader = await openSession(readOnly);
    await assert.rejects(() => reader.fork("r1"), code("session_read_only"));
    await assert.rejects(() => reader.revert("r1"), code("session_read_only"));
    await assert.rejects(() => reader.child({ stepId: "s" }), code("session_read_only"));
  });
});
