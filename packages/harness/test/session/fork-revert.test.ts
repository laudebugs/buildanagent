// Fork, revert and child: each writes a new file, none rewrites one, and a path crosses from a branch into its parent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { isDerivedFile, listSessions, openSession, type SessionIndex } from "@buildanagent/harness/session";
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
    await assert.rejects(() => session.path("r3"), code("entry_not_found"));
    assert.deepEqual(
      ids(await all(backend.store.load(KEY))),
      ["h1", "r1", "r2", "r3"],
      "the entries it went back from stay in the old file, which is no longer part of this session's tree",
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
    assert.equal(reader.head(), (await all(backend.store.load(reader.key)))[0]?.id, "a child starts at its header");
    const [childHeader] = await all(backend.store.load(reader.key));
    assert.ok(childHeader?.type === "session_header");
    assert.deepEqual(
      childHeader.parent,
      { session: "s1", entryId: byStep.id },
      "a child's header names the session and the link that started it",
    );
    assert.deepEqual(childHeader.spawn, { stepId: "step:reader" });
    assert.deepEqual(
      ids(await reader.path()),
      [childHeader.id],
      "but a child is its own log, so its path doesn't cross into the parent",
    );
    const [callerHeader] = await all(backend.store.load(caller.key));
    assert.ok(
      callerHeader?.type === "session_header" &&
        callerHeader.spawn?.spawningCallId === "call-7" &&
        callerHeader.spawn.stepId === undefined,
    );
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
    await assert.rejects(() => empty.fork("x"), /no entries to branch from/);
    await assert.rejects(() => empty.revert("x"), /no entries to branch from/);
    await empty.close();
    await seed(backend);
    const { lock: _lock, ...readOnly } = opts(backend);
    const reader = await openSession(readOnly);
    await assert.rejects(() => reader.fork("r1"), code("session_read_only"));
    await assert.rejects(() => reader.revert("r1"), code("session_read_only"));
    await assert.rejects(() => reader.child({ stepId: "s" }), code("session_read_only"));
  });
});

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a fork holds only the prefix: it can't check out what its parent wrote after the fork point, nor does a later parent entry appear", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const fork = await session.fork("r2");
    await assert.rejects(() => fork.checkout("r3"), code("entry_not_found"));
    await assert.rejects(() => fork.path("r3"), code("entry_not_found"));
    await session.append([record("r4", "r3")]);
    await assert.rejects(
      () => fork.checkout("r4"),
      code("entry_not_found"),
      "the parent growing changes nothing for the fork",
    );
    assert.deepEqual(ids(await fork.path()), ["h1", "r1", "r2"]);
    await fork.checkout("r1");
    assert.equal(fork.head(), "r1", "an entry in the prefix can be checked out");
    await fork.close();
    await session.close();
  });

  test("the files a revert writes are not listed as sessions, and a fork and a child are", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    await session.revert("r2");
    const fork = await session.fork("r1");
    const child = await session.child({ stepId: "step:a" });
    const everything = (await all(backend.store.list("ada"))).map((summary) => summary.sessionId);
    assert.ok(
      everything.some((id) => isDerivedFile(id)),
      "the store itself lists every file",
    );
    const listed = (await all(listSessions(backend.store, "ada"))).map((summary) => summary.sessionId).sort();
    assert.deepEqual(listed, ["s1", fork.key.sessionId, child.key.sessionId].sort());
    await fork.close();
    await child.close();
    await session.close();
  });

  test("a revert whose new file can't be read leaves the session on the file it was on", async () => {
    const backend = make();
    await seed(backend);
    const flaky = {
      ...backend.store,
      async append(
        key: Parameters<typeof backend.store.append>[0],
        entries: Parameters<typeof backend.store.append>[1],
        options?: Parameters<typeof backend.store.append>[2],
      ) {
        return backend.store.append(key, entries, options);
      },
      load(key: Parameters<typeof backend.store.load>[0], options?: Parameters<typeof backend.store.load>[1]) {
        if (key.sessionId.startsWith("~")) throw new Error("transient read error");
        return backend.store.load(key, options);
      },
    };
    const session = await openSession({ ...opts(backend), store: flaky as typeof backend.store });
    await assert.rejects(() => session.revert("r1"), /transient read error/);
    assert.equal(session.file(), "s1");
    assert.equal(session.head(), "r3");
    assert.equal(await backend.index.get(KEY), undefined, "and the pointer didn't move");
    await session.append([record("r4", "r3")]);
    await session.close();
  });
});

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a second revert to an entry before the first one's point drops what came after it, in the tree and in the lookups", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    await session.revert("r3");
    await session.revert("r1");
    assert.deepEqual(ids(await session.path()), ["h1", "r1"]);
    for (const dropped of ["r2", "r3"]) {
      await assert.rejects(() => session.checkout(dropped), code("entry_not_found"), dropped);
      await assert.rejects(() => session.fork(dropped), code("entry_not_found"), dropped);
      await assert.rejects(() => session.path(dropped), code("entry_not_found"), dropped);
    }
    await session.close();
    const again = await openSession(opts(backend));
    await assert.rejects(() => again.checkout("r3"), code("entry_not_found"));
    await again.close();
  });

  test("a fork of an entry before its own fork point holds only the entries up to it", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    const first = await session.fork("r3");
    const second = await first.fork("r1");
    assert.deepEqual(ids(await second.path()), ["h1", "r1"]);
    await assert.rejects(() => second.checkout("r2"), code("entry_not_found"));
    await second.close();
    await first.close();
    await session.close();
  });
});
