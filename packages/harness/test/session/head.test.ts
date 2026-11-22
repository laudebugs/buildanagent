// HEAD: what the next append follows, how a checkout moves it, and how a session is opened for writing or for reading.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { openSession } from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { BACKENDS, counter, KEY, NOW, record, seed } from "./session-helpers.js";

const opts = (backend: ReturnType<(typeof BACKENDS)[number][1]>) => ({
  store: backend.store,
  index: backend.index,
  lock: backend.lock,
  key: KEY,
  now: NOW,
  newId: counter(),
});

const code = (expected: string) => (error: unknown) => isHarnessError(error) && error.code === expected;

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a new session has no HEAD, and each append moves it to the entry appended", async () => {
    const backend = make();
    const session = await openSession(opts(backend));
    assert.equal(session.head(), null);
    await session.append([
      {
        ...record("h1", "x"),
        parentId: null,
        type: "session_header",
        formatVersion: 1,
        harnessVersion: "0",
        sdkVersion: "0",
        defaultsHash: "d",
        capabilities: [],
        ablationHash: "a",
      } as never,
    ]);
    assert.equal(session.head(), "h1");
    await session.append([record("r1", "h1"), record("r2", "r1")]);
    assert.equal(session.head(), "r2");
    assert.deepEqual(
      (await session.path()).map((entry) => entry.id),
      ["h1", "r1", "r2"],
    );
    await session.close();
  });

  test("after checkout(x) and a reload with no further append, head() is x", async () => {
    const backend = make();
    await seed(backend);
    const first = await openSession(opts(backend));
    assert.equal(first.head(), "r3");
    await first.checkout("r1");
    assert.equal(first.head(), "r1");
    await first.close();
    const again = await openSession(opts(backend));
    assert.equal(again.head(), "r1", "the checkout entry in the log put HEAD back");
    assert.deepEqual(
      (await again.path()).map((entry) => entry.id),
      ["h1", "r1"],
      "and the path stops there",
    );
    await again.close();
  });

  test("an append after a checkout branches from it, and the other branch stays in the log", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    await session.checkout("r1");
    await session.append([record("b1", "r1")]);
    assert.deepEqual(
      (await session.path()).map((entry) => entry.id),
      ["h1", "r1", "b1"],
    );
    assert.deepEqual(
      (await session.path("r3")).map((entry) => entry.id),
      ["h1", "r1", "r2", "r3"],
      "the first branch is still there",
    );
    await session.close();
    const reloaded = await openSession(opts(backend));
    assert.equal(reloaded.head(), "b1");
    await reloaded.close();
  });

  test("checkout of an entry that isn't in the log is entry_not_found, and writes nothing", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    await assert.rejects(() => session.checkout("nope"), code("entry_not_found"));
    assert.equal(session.head(), "r3");
    await assert.rejects(() => session.path("nope"), code("entry_not_found"));
    await session.close();
  });

  test("a second writer is refused, and a session opened without a lock can read and not write", async () => {
    const backend = make();
    await seed(backend);
    const writer = await openSession(opts(backend));
    await assert.rejects(() => openSession(opts(backend)), code("session_locked"));
    const { lock: _lock, ...readOnly } = opts(backend);
    const reader = await openSession(readOnly);
    assert.equal(reader.head(), "r3");
    assert.equal(reader.writable(), false);
    await assert.rejects(() => reader.checkout("r1"), code("session_read_only"));
    await assert.rejects(() => reader.append([record("x", "r3")]), code("session_read_only"));
    await writer.close();
    const next = await openSession(opts(backend));
    assert.equal(next.writable(), true, "once the writer closes, the lock is free");
    await next.close();
  });

  test("a writer that lost its lock stops writing", async () => {
    const backend = make();
    await seed(backend);
    let live = true;
    const lock = {
      async acquire() {
        return { token: "t", held: () => live, async release() {} };
      },
    };
    const session = await openSession({ ...opts(backend), lock });
    live = false;
    await assert.rejects(() => session.append([record("x", "r3")]), code("session_locked"));
    await assert.rejects(() => session.checkout("r1"), code("session_locked"));
  });

  test("an append is guarded by the end of the log the session has seen", async () => {
    const backend = make();
    await seed(backend);
    const session = await openSession(opts(backend));
    // Another writer extends the file behind this session's back, as one that lost the lock might.
    await backend.store.append(KEY, [record("other", "r3")]);
    await assert.rejects(() => session.append([record("mine", "r3")]), code("session_conflict"));
    await session.close();
  });
});
