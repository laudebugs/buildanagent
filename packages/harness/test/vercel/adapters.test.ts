// What the Vercel adapters promise beyond the shared suite: the store's compare-and-swap under racing writers, the
// lock's database clock, fencing number and local lease deadline, the scheduler's duplicate and cancel paths, and a
// key store that never shows the secret. Postgres is PGlite, run in this process.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import { isHarnessError } from "@buildanagent/harness";
import {
  ConflictError,
  type EntryInput,
  processScheduler,
  rotateKeys,
  type SessionKey,
} from "@buildanagent/harness/session";
import {
  createPostgresHarnessTables,
  deliverWake,
  envKeyStore,
  type PgClientLike,
  type PostgresLockHandle,
  postgresLock,
  postgresStore,
  postgresWakeLedger,
  wakeToken,
  workflowScheduler,
} from "@buildanagent/harness/vercel";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, test } from "vitest";
import { fakeWorkflow } from "./fake-workflow.js";
import { TEST_KEY, TEST_RING } from "./ring.js";

const KEY: SessionKey = { userId: "ada", sessionId: "s1" };
const START = Date.parse("2026-11-24T00:00:00.000Z");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await createPostgresHarnessTables(db);
}, 60_000);
afterAll(async () => {
  await db.close();
});

async function fresh(): Promise<PGlite> {
  await db.query("TRUNCATE harness_session_entries, harness_session_locks, harness_wakes");
  return db;
}

const header: EntryInput = {
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
};
const record = (id: string, parentId: string): EntryInput => ({
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  origin: "harness",
  type: "product_record",
  name: "test.record",
  data: {},
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

/** A client that fails the next `inserts` INSERT statements with `error`, and passes everything else through. */
function failingInserts(client: PgClientLike, error: unknown, inserts: number): PgClientLike {
  let left = inserts;
  return {
    query(text, values) {
      if (left > 0 && text.trimStart().startsWith("INSERT")) {
        left -= 1;
        return Promise.reject(error);
      }
      return client.query(text, values);
    },
  };
}

describe("workflowScheduler cancel", () => {
  test("a resumeHook that throws at once still lets every wake of the id be removed and every hook be tried", async () => {
    const client = await fresh();
    const tried: string[] = [];
    const scheduler = workflowScheduler({
      ledger: postgresWakeLedger(client),
      start: async () => undefined,
      resumeHook: ((token: string) => {
        tried.push(token);
        throw new Error("not async");
      }) as never,
    });
    await scheduler.wake(new Date(START + 1_000), "s1");
    await scheduler.wake(new Date(START + 2_000), "s1");
    await scheduler.cancel("s1");
    assert.equal(tried.length, 2);
    assert.equal((await client.query("SELECT 1 FROM harness_wakes")).rows.length, 0);
  });
});

describe("postgresStore", () => {
  test("of two writers expecting the same tail, exactly one appends and the other gets a ConflictError", async () => {
    const client = await fresh();
    const a = postgresStore(client);
    const b = postgresStore(client);
    await a.append(KEY, [header]);
    const results = await Promise.allSettled([
      a.append(KEY, [record("a1", "h1")], { expectedLastId: "h1" }),
      b.append(KEY, [record("b1", "h1")], { expectedLastId: "h1" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const lost = results.find((result) => result.status === "rejected");
    assert.ok(lost?.status === "rejected" && lost.reason instanceof ConflictError);
    assert.equal((await collect(a.load(KEY))).length, 2);
  });

  test("list leaves out a session whose last entry is corrupt and still lists the others", async () => {
    const client = await fresh();
    const store = postgresStore(client);
    await store.append(KEY, [header]);
    await store.append({ userId: "ada", sessionId: "bad" }, [header]);
    await client.query("UPDATE harness_session_entries SET entry = $1 WHERE session_id = 'bad'", ["{not json"]);
    const listed = await collect(store.list("ada"));
    assert.deepEqual(
      listed.map((summary) => summary.sessionId),
      ["s1"],
    );
  });

  test("writers that set no expected tail both append, each at its own seq", async () => {
    const client = await fresh();
    await postgresStore(client).append(KEY, [header]);
    await Promise.all(["x", "y", "z"].map((id) => postgresStore(client).append(KEY, [record(id, "h1")])));
    const seqs = (await collect(postgresStore(client).load(KEY))).map((entry) => entry.seq);
    assert.deepEqual(seqs, [0, 1, 2, 3]);
  });

  test("an append that loses the race for its seq plans again, and gives up with a ConflictError", async () => {
    const client = await fresh();
    const taken = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const written = await postgresStore(failingInserts(client, taken, 1)).append(KEY, [header]);
    assert.equal(written[0]?.seq, 0);
    await assert.rejects(
      () => postgresStore(failingInserts(client, taken, 10)).append(KEY, [record("r1", "h1")]),
      (error) => error instanceof ConflictError,
    );
    const other = new Error("connection refused");
    await assert.rejects(
      () => postgresStore(failingInserts(client, other, 1)).append(KEY, [record("r1", "h1")]),
      other,
    );
  });

  test("load reads in pages, from a sequence, and stops at the tail it began with", async () => {
    const client = await fresh();
    const store = postgresStore(client, { pageSize: 2 });
    await store.append(KEY, [header, record("r1", "h1"), record("r2", "r1"), record("r3", "r2"), record("r4", "r3")]);
    const ids = (await collect(store.load(KEY, { fromSeq: 1 }))).map((entry) => entry.id);
    assert.deepEqual(ids, ["r1", "r2", "r3", "r4"]);
    assert.ok(store.loadRaw !== undefined);
    assert.deepEqual(await collect(store.loadRaw(KEY)), await collect(store.load(KEY)));
    assert.throws(
      () => postgresStore(client, { pageSize: 0 }),
      (error) => isHarnessError(error) && error.code === "invalid_store_options",
    );
  });

  test("load refuses a log in another format as unsupported and a bad row as corrupt, and loadRaw reads both", async () => {
    const client = await fresh();
    const store = postgresStore(client);
    await store.append(KEY, [header, record("r1", "h1")]);
    await client.query(
      "UPDATE harness_session_entries SET entry = jsonb_set(entry::jsonb, '{formatVersion}', '99')::text WHERE seq = 0",
    );
    await assert.rejects(
      () => collect(store.load(KEY)),
      (error) => isHarnessError(error) && error.code === "unsupported_format",
    );
    assert.ok(store.loadRaw !== undefined);
    const raw = (await collect(store.loadRaw(KEY))) as { formatVersion?: number }[];
    assert.equal(raw[0]?.formatVersion, 99);
    await client.query('UPDATE harness_session_entries SET entry = \'{"id":"r1"}\' WHERE seq = 1');
    await assert.rejects(
      () => collect(store.load(KEY, { fromSeq: 1 })),
      (error) => isHarnessError(error) && error.code === "session_corrupt",
    );
  });

  test("a retry whose batch another writer partly stored between its reads still lands after that part", async () => {
    const client = await fresh();
    await postgresStore(client).append(KEY, [header]);
    // The other writer stores the batch's first entry just before this writer reads the batch's ids.
    let raced = false;
    const racing: PgClientLike = {
      async query(text, values) {
        if (!raced && text.includes("entry_id IN")) {
          raced = true;
          await postgresStore(client).append(KEY, [record("a", "h1")]);
        }
        return client.query(text, values);
      },
    };
    const written = await postgresStore(racing).append(KEY, [record("a", "h1"), record("b", "a")]);
    assert.deepEqual(
      written.map((entry) => [entry.id, entry.seq]),
      [
        ["a", 1],
        ["b", 2],
      ],
    );
  });
});

describe("postgresLock", () => {
  test("on the database's clock, a second writer is refused and the fence grows on every acquire", async () => {
    const client = await fresh();
    const lock = postgresLock(client, { leaseMs: 60_000 });
    const first = (await lock.acquire(KEY)) as PostgresLockHandle;
    assert.notEqual(first, "would_block");
    assert.equal(await postgresLock(client).acquire(KEY), "would_block");
    await first.release();
    const second = (await lock.acquire(KEY)) as PostgresLockHandle;
    assert.equal(second.fence, first.fence + 1);
    await second.release();
  });

  test("a holder counts its lease as gone at its local deadline, and a renewal moves the deadline", async () => {
    const client = await fresh();
    let time = START;
    const timers = new Map<number, () => void>();
    let next = 0;
    const scheduler = processScheduler({
      now: () => time,
      setTimer: (callback) => {
        timers.set(next, callback);
        return next++;
      },
      clearTimer: (id) => timers.delete(id as number),
    });
    const fire = async () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      for (let spin = 0; spin < 50; spin += 1) await new Promise((done) => setImmediate(done));
    };
    const lock = postgresLock(client, { leaseMs: 3_000, renewMs: 1_000, now: () => time, scheduler });
    const peer = postgresLock(client, { leaseMs: 3_000, renewMs: 1_000, now: () => time, scheduler });
    const hold = (await lock.acquire(KEY)) as PostgresLockHandle;
    time += 1_000;
    await fire();
    time += 2_500;
    assert.equal(hold.held(), true, "the renewal at 1 s moved the deadline to 4 s");
    assert.equal(await peer.acquire(KEY), "would_block");
    time += 1_000;
    assert.equal(hold.held(), false, "with no renewal since, the lease is gone at 4 s");
    const taker = (await peer.acquire(KEY)) as PostgresLockHandle;
    assert.ok(taker.fence > hold.fence);
    await hold.release();
    assert.equal(await lock.acquire(KEY), "would_block", "a late release must not free the new holder's lock");
    await taker.release();
  });

  test("a renewal that finds another writer's token ends the hold", async () => {
    const client = await fresh();
    let time = START;
    const timers: (() => void)[] = [];
    const scheduler = processScheduler({ now: () => time, setTimer: (callback) => timers.push(callback) });
    const lock = postgresLock(client, { leaseMs: 2_000, renewMs: 1_000, now: () => time, scheduler });
    const hold = (await lock.acquire(KEY)) as PostgresLockHandle;
    // An operator's forced unlock and another writer's acquire leave the row with a token that is not this hold's.
    await client.query("UPDATE harness_session_locks SET token = 'another-writer'");
    time += 1_000;
    for (const callback of timers.splice(0)) callback();
    for (let spin = 0; spin < 50; spin += 1) await new Promise((done) => setImmediate(done));
    assert.equal(hold.held(), false);
  });

  test("a lease or renewal it can't use is refused", () => {
    for (const options of [{ leaseMs: 0 }, { leaseMs: 1_000, renewMs: 1_000 }, { leaseMs: 1.5 }]) {
      assert.throws(
        () => postgresLock(db, options),
        (error) => isHarnessError(error) && error.code === "invalid_lock_options",
      );
    }
  });
});

describe("workflowScheduler", () => {
  test("a wake asked for twice starts two runs, and the second ends as a duplicate", async () => {
    const workflow = fakeWorkflow({ ledger: postgresWakeLedger(await fresh()), start: START });
    const at = new Date(START + 1_000);
    await workflow.under.scheduler.wake(at, "s1");
    await workflow.under.scheduler.wake(at, "s1");
    await workflow.under.advanceTo(new Date(START + 2_000));
    assert.deepEqual([...workflow.outcomes()].sort(), ["delivered", "duplicate"]);
    assert.equal(workflow.under.delivered().length, 1);
  });

  test("a cancel ends a waiting run at once, and ignores a run that is gone", async () => {
    const ledger = postgresWakeLedger(await fresh());
    const tokens: string[] = [];
    const workflow = fakeWorkflow({
      ledger,
      start: START,
      failStart: (request) => {
        tokens.push(request.token);
        return request.sessionId === "lost";
      },
    });
    await workflow.under.scheduler.wake(new Date(START + 60_000), "s1");
    await workflow.settle();
    await workflow.under.scheduler.cancel("s1");
    await workflow.settle();
    assert.deepEqual(workflow.outcomes(), ["cancelled"]);
    await assert.rejects(() => workflow.under.scheduler.wake(new Date(START + 1_000), "lost"), /did not start/);
    const pending = async (sessionId: string) =>
      (await db.query("SELECT 1 FROM harness_wakes WHERE session_id = $1", [sessionId])).rows.length > 0;
    assert.equal(await pending("lost"), true, "a failed start leaves the wake for a retry");
    await workflow.under.scheduler.cancel("lost");
    assert.deepEqual(workflow.resumed(), tokens);
    assert.equal(await pending("lost"), false);
  });

  test("a wake asked for again after a cancel is delivered, though the cancelled run still holds its hook", async () => {
    const workflow = fakeWorkflow({ ledger: postgresWakeLedger(await fresh()), start: START, deferResume: true });
    const at = new Date(START + 1_000);
    await workflow.under.scheduler.wake(at, "s1");
    await workflow.settle();
    await workflow.under.scheduler.cancel("s1");
    await workflow.under.scheduler.wake(at, "s1");
    await workflow.settle();
    await workflow.flushResumes();
    await workflow.under.advanceTo(new Date(START + 2_000));
    assert.deepEqual([...workflow.outcomes()].sort(), ["cancelled", "delivered"]);
    assert.equal(workflow.under.delivered().length, 1);
  });

  test("a run that a cancel beats to the step reports that it was cancelled", async () => {
    const ledger = postgresWakeLedger(await fresh());
    let workflow: ReturnType<typeof fakeWorkflow> | undefined;
    // The ledger's claim is the first thing the step does, so a cancel just before it stands for one after the sleep.
    const racing = {
      ...ledger,
      claim: async (sessionId: string, at: number, nonce: string) => {
        await workflow?.under.scheduler.cancel(sessionId);
        return ledger.claim(sessionId, at, nonce);
      },
    };
    workflow = fakeWorkflow({ ledger: racing, start: START });
    await workflow.under.scheduler.wake(new Date(START + 1_000), "s1");
    await workflow.under.advanceTo(new Date(START + 2_000));
    assert.deepEqual(workflow.outcomes(), ["cancelled"]);
    assert.equal(workflow.under.delivered().length, 0);
  });

  test("a handler that throws keeps the wake in the ledger, so a retried step delivers it", async () => {
    const ledger = postgresWakeLedger(await fresh());
    const nonce = await ledger.add("s1", START);
    const request = { sessionId: "s1", at: START, nonce, token: wakeToken("s1", START, nonce) };
    await assert.rejects(() =>
      deliverWake(request, {
        ledger,
        handler: () => {
          throw new Error("turn failed");
        },
      }),
    );
    const { rows } = await db.query("SELECT nonce FROM harness_wakes WHERE session_id = 's1'");
    assert.deepEqual(rows, [{ nonce }], "the claimed wake is still in the ledger");
    assert.equal(await deliverWake(request, { ledger, handler: () => undefined }), "delivered");
    assert.equal(await deliverWake(request, { ledger, handler: () => undefined }), "cancelled");
  });

  test("a handler that asks for its own wake again gets a new wake, which the delivery leaves in place", async () => {
    const ledger = postgresWakeLedger(await fresh());
    const nonce = await ledger.add("s1", START);
    assert.equal(await ledger.add("s1", START), nonce, "a pending wake asked for again keeps its nonce");
    const request = { sessionId: "s1", at: START, nonce, token: wakeToken("s1", START, nonce) };
    let again = "";
    const handler = async () => {
      again = await ledger.add("s1", START);
    };
    assert.equal(await deliverWake(request, { ledger, handler }), "delivered");
    assert.notEqual(again, nonce);
    assert.deepEqual(await ledger.removeAll("s1"), [{ at: START, nonce: again }]);
  });

  test("a token holds no separator from the id, and options it can't use are refused", () => {
    assert.equal(wakeToken("a:b", 5, "n"), "harness-wake:a%3Ab:5:n");
    assert.throws(
      () => workflowScheduler({ ledger: {} as never, start: async () => undefined, resumeHook: async () => undefined }),
      (error) => isHarnessError(error) && error.code === "invalid_scheduler_options",
    );
  });
});

describe("envKeyStore", () => {
  const leaked = (text: string) => text.includes(TEST_KEY) || text.includes(TEST_RING);

  test("loads the ring from the variable, and is read-only", async () => {
    const store = envKeyStore({ env: { HARNESS_KEY_RING: TEST_RING } });
    assert.equal((await store.load()).current, "2026-11");
    await assert.rejects(
      () => rotateKeys(store, { platformHint: "vercel env" }),
      (error) => isHarnessError(error) && error.code === "key_store_read_only" && error.message.includes("vercel env"),
    );
  });

  test("neither the store nor any error it throws shows the variable's value", async () => {
    const store = envKeyStore({ env: { HARNESS_KEY_RING: TEST_RING } });
    assert.ok(!leaked(inspect(store, { depth: 10, showHidden: true })));
    assert.ok(!leaked(JSON.stringify(store)));
    // A ring whose id is the key, and text that is not JSON but holds the key, must not echo it either.
    for (const value of [`{"current":"${TEST_KEY}","keys":{}}`, `not json ${TEST_KEY}`, ` `, undefined]) {
      const error = await envKeyStore({ env: { HARNESS_KEY_RING: value } })
        .load()
        .then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
      assert.ok(isHarnessError(error) && error.code === "invalid_key_store");
      assert.equal(error.cause, undefined);
      assert.ok(!leaked(`${error.message} ${error.stack} ${inspect(error, { depth: 10 })} ${JSON.stringify(error)}`));
    }
  });

  test("names the variable when it is missing, reads process.env by default, and refuses a name it can't use", async () => {
    const name = "HARNESS_VERCEL_TEST_RING";
    await assert.rejects(() => envKeyStore({ name }).load(), new RegExp(`environment variable ${name} is not set`));
    process.env[name] = TEST_RING;
    try {
      assert.equal((await envKeyStore({ name }).load()).current, "2026-11");
    } finally {
      delete process.env[name];
    }
    assert.throws(
      () => envKeyStore({ name: "lower-case" }),
      (error) => isHarnessError(error),
    );
  });
});

test("the Vercel entries import no driver or SDK, and the workflow body imports nothing", () => {
  const dir = new URL("../../src/vercel/", import.meta.url).pathname;
  for (const file of readdirSync(dir)) {
    const code = readFileSync(join(dir, file), "utf8");
    const specs = [...code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    if (file === "workflow.ts") assert.deepEqual(specs, [], "the workflow body must import nothing");
    for (const spec of specs) {
      assert.ok(spec.startsWith(".") || spec.startsWith("@buildanagent/"), `${file} imports ${spec}`);
    }
  }
});
