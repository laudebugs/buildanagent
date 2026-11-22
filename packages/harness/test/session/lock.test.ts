// The writer lock: fail fast, a lease that lapses, and staleness that needs both a lapsed lease and a dead process on
// the same host. The clock, the process check and the host are injected, so no case waits for a real lease.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import type { LockHandle } from "@buildanagent/harness/session";
import { fileLock, unlockSession } from "@buildanagent/harness/session/jsonl";
import { afterAll, afterEach, test } from "vitest";

const dirs: string[] = [];
const handles: { release(): Promise<void> }[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-lock-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.release();
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const KEY = { userId: "ada", sessionId: "s1" };
const lockFile = (dir: string) => join(dir, "ada", "s1.lock");
const readRecord = (dir: string) =>
  JSON.parse(readFileSync(lockFile(dir), "utf8")) as { pid: number; host: string; token: string; leaseUntil: number };

/**
 * Polls until `check` holds, up to a generous deadline. A renewal runs on a real timer, and a loaded worker can run it
 * late, so a fixed sleep would turn scheduling delay into a failure.
 */
async function eventually(check: () => boolean, message: string, deadlineMs = 10_000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (!check()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A clock a test moves by hand. */
function clock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

async function held(lock: ReturnType<typeof fileLock>, key = KEY): Promise<LockHandle> {
  const result = await lock.acquire(key);
  if (result === "would_block") throw new Error("expected the lock to be free");
  handles.push(result);
  return result;
}

test("a second acquire returns would_block at once, and a release frees the lock", async () => {
  const lock = fileLock({ dir: tempDir() });
  const first = await held(lock);
  const started = performance.now();
  assert.equal(await lock.acquire(KEY), "would_block");
  assert.ok(performance.now() - started < 50, "it did not wait");
  assert.equal(first.held(), true);
  await first.release();
  assert.equal(first.held(), false);
  assert.notEqual(await lock.acquire(KEY), "would_block", "the released lock can be taken");
});

test("the lock file holds the pid, host, token and lease end", async () => {
  const dir = tempDir();
  const time = clock();
  const handle = await held(fileLock({ dir, leaseMs: 30_000, renewMs: 10_000, now: time.now, host: "h1", pid: 4242 }));
  assert.deepEqual(readRecord(dir), { pid: 4242, host: "h1", token: handle.token, leaseUntil: time.now() + 30_000 });
});

test("two sessions, and two users with the same session id, have separate locks", async () => {
  const lock = fileLock({ dir: tempDir() });
  await held(lock);
  await held(lock, { userId: "ada", sessionId: "s2" });
  await held(lock, { userId: "bob", sessionId: "s1" });
  assert.equal(await lock.acquire(KEY), "would_block");
});

test("a lock whose lease lapsed and whose process is gone is taken over, and the old holder never frees the new holder's lock", async () => {
  const dir = tempDir();
  const time = clock();
  const old = await held(
    fileLock({ dir, now: time.now, host: "h1", pid: 1, isAlive: () => true, renewMs: 1000, leaseMs: 5000 }),
  );
  time.advance(6000);
  const taker = fileLock({ dir, now: time.now, host: "h1", pid: 2, isAlive: (pid) => pid !== 1 });
  const next = await held(taker);
  assert.equal(readRecord(dir).token, next.token);
  await old.release();
  assert.equal(readRecord(dir).token, next.token, "the old holder's release did not free the new holder's lock");
});

test("a lock is not stale while its lease runs, even when its process is gone", async () => {
  const dir = tempDir();
  const time = clock();
  await held(fileLock({ dir, now: time.now, host: "h1", pid: 1, leaseMs: 5000, renewMs: 1000 }));
  time.advance(4000);
  const other = fileLock({ dir, now: time.now, host: "h1", pid: 2, isAlive: () => false });
  assert.equal(await other.acquire(KEY), "would_block");
});

test("a lock with a live process is never reclaimed, however long its lease has lapsed", async () => {
  const dir = tempDir();
  const time = clock();
  await held(fileLock({ dir, now: time.now, host: "h1", pid: 1, leaseMs: 5000, renewMs: 1000 }));
  time.advance(10 * 60_000);
  const other = fileLock({ dir, now: time.now, host: "h1", pid: 2, isAlive: () => true });
  assert.equal(await other.acquire(KEY), "would_block");
});

test("a lock from another host is reclaimed only by the force path", async () => {
  const dir = tempDir();
  const time = clock();
  await held(fileLock({ dir, now: time.now, host: "elsewhere", pid: 1, leaseMs: 5000, renewMs: 1000 }));
  time.advance(10 * 60_000);
  const here = fileLock({ dir, now: time.now, host: "here", pid: 2, isAlive: () => false });
  assert.equal(await here.acquire(KEY), "would_block", "this host can't tell whether that process lives");
  const removed = await unlockSession({ dir }, KEY);
  assert.ok(
    removed !== undefined && removed !== "unreadable" && removed.host === "elsewhere",
    "the force path says what it removed",
  );
  assert.notEqual(await here.acquire(KEY), "would_block");
  assert.equal(
    await unlockSession({ dir }, { userId: "ada", sessionId: "none" }),
    undefined,
    "no lock, nothing removed",
  );
});

test("the holder renews the lease, and a renewal that finds another token gives up", async () => {
  const dir = tempDir();
  const handle = await held(fileLock({ dir, leaseMs: 400, renewMs: 50 }));
  const before = readRecord(dir).leaseUntil;
  await eventually(() => readRecord(dir).leaseUntil > before, "the lease moved on");
  assert.equal(handle.held(), true);
  writeFileSync(
    lockFile(dir),
    JSON.stringify({ pid: 9, host: "x", token: "someone-else", leaseUntil: Date.now() + 60_000 }),
  );
  await eventually(() => !handle.held(), "the holder noticed the takeover");
  assert.equal(readRecord(dir).token, "someone-else", "and left the other lock alone");
});

test("a lock file with no readable record blocks until it is older than a lease, then is reclaimed", async () => {
  const dir = tempDir();
  // The injected clock is nowhere near the files' real modification times, and an empty lock must still age out.
  const lock = fileLock({ dir, leaseMs: 5000, renewMs: 1000, now: () => 1_000_000 });
  await (await held(lock)).release();
  writeFileSync(lockFile(dir), "");
  assert.equal(await lock.acquire(KEY), "would_block", "a fresh empty file is a lock being written");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockFile(dir), old, old);
  assert.notEqual(await lock.acquire(KEY), "would_block", "an old one was left by a process that died");
});

test("two writers racing for a stale lock: exactly one wins, and the lock holds the winner's token", async () => {
  const dir = tempDir();
  const time = clock();
  await held(fileLock({ dir, now: time.now, host: "h1", pid: 1, leaseMs: 5000, renewMs: 1000 }));
  time.advance(10_000);
  const racers = Array.from({ length: 8 }, (_, i) =>
    fileLock({ dir, now: time.now, host: "h1", pid: 10 + i, isAlive: (pid) => pid !== 1 }),
  );
  const results = await Promise.all(racers.map((racer) => racer.acquire(KEY)));
  const winners = results.filter((result) => result !== "would_block");
  for (const winner of winners) handles.push(winner);
  assert.equal(winners.length, 1);
  assert.equal(readRecord(dir).token, winners[0]?.token);
  assert.deepEqual(
    readdirSync(join(dir, "ada")).filter((name) => name.endsWith(".reclaim")),
    [],
    "the takeover guard is gone",
  );
});

test("a bad key and bad options are refused", async () => {
  const dir = tempDir();
  await assert.rejects(
    () => fileLock({ dir }).acquire({ userId: "", sessionId: "s" }),
    (error) => isHarnessError(error) && error.code === "invalid_session_key",
  );
  assert.throws(
    () => fileLock({ dir, leaseMs: 100, renewMs: 100 }),
    (error) => isHarnessError(error),
  );
});

test("a renewal can't bring a released lock back, and a release leaves no lock behind", async () => {
  const dir = tempDir();
  const lock = fileLock({ dir, leaseMs: 100, renewMs: 1 });
  for (let round = 0; round < 10; round += 1) {
    const handle = await held(lock);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await handle.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(readdirSync(join(dir, "ada")), [], `round ${round}: nothing was left or recreated`);
  }
  const again = await lock.acquire(KEY);
  assert.notEqual(again, "would_block", "so the next acquire in this process works");
  if (again !== "would_block") handles.push(again);
});

test("a handle that lost its lock can still release without freeing the next holder's lock", async () => {
  const dir = tempDir();
  const handle = await held(fileLock({ dir, leaseMs: 400, renewMs: 20 }));
  writeFileSync(
    lockFile(dir),
    JSON.stringify({ pid: 9, host: "x", token: "someone-else", leaseUntil: Date.now() + 60_000 }),
  );
  await eventually(() => !handle.held(), "the holder noticed the takeover");
  await handle.release();
  assert.equal(readRecord(dir).token, "someone-else");
});

test("a guard left by a writer that died mid-takeover is cleared once, and exactly one racer wins", async () => {
  const dir = tempDir();
  const time = clock();
  await held(fileLock({ dir, now: time.now, host: "h1", pid: 1, leaseMs: 5000, renewMs: 1000 }));
  time.advance(10_000);
  writeFileSync(`${lockFile(dir)}.reclaim`, JSON.stringify({ token: "dead", createdAt: Date.now() - 60_000 }));
  const racers = Array.from({ length: 8 }, (_, i) =>
    fileLock({ dir, now: time.now, host: "h1", pid: 10 + i, isAlive: (pid) => pid !== 1 }),
  );
  const results = await Promise.all(racers.map((racer) => racer.acquire(KEY)));
  const winners = results.filter((result) => result !== "would_block");
  for (const winner of winners) handles.push(winner);
  assert.equal(winners.length, 1);
  assert.equal(readRecord(dir).token, winners[0]?.token);
  assert.deepEqual(
    readdirSync(join(dir, "ada")).filter((name) => name.includes("reclaim") || name.endsWith(".stale")),
    [],
  );
});

test("a fresh takeover guard blocks another reclaimer", async () => {
  const dir = tempDir();
  const time = clock();
  await held(fileLock({ dir, now: time.now, host: "h1", pid: 1, leaseMs: 5000, renewMs: 1000 }));
  time.advance(10_000);
  writeFileSync(`${lockFile(dir)}.reclaim`, JSON.stringify({ token: "busy", createdAt: Date.now() }));
  const other = fileLock({ dir, now: time.now, host: "h1", pid: 2, isAlive: (pid) => pid !== 1 });
  assert.equal(await other.acquire(KEY), "would_block");
});

test("options that would break the lease are refused with their own code", () => {
  const dir = tempDir();
  const refused = (error: unknown) => isHarnessError(error) && error.code === "invalid_lock_options";
  for (const options of [
    { leaseMs: Number.POSITIVE_INFINITY },
    { leaseMs: Number.NaN },
    { leaseMs: 100, renewMs: 100 },
    { leaseMs: 0 },
    { leaseMs: 2 ** 40, renewMs: 2 ** 33 },
  ]) {
    assert.throws(() => fileLock({ dir, ...options }), refused, JSON.stringify(options));
  }
});

test("a short lease alone works, because the renewal default follows it", async () => {
  const lock = fileLock({ dir: tempDir(), leaseMs: 5000 });
  const handle = await held(lock);
  assert.equal(handle.held(), true);
});

test("a host name is measured in bytes: a multi-byte one over 1 KiB is refused, and a smaller one keeps the record's size", async () => {
  const dir = tempDir();
  await assert.rejects(
    () => fileLock({ dir, host: "é".repeat(600) }).acquire(KEY),
    (error) => isHarnessError(error) && error.code === "invalid_lock_options",
  );
  await held(fileLock({ dir, host: "é".repeat(300) }));
  assert.equal(readFileSync(lockFile(dir)).length, 1024, "the record fills its 1 KiB exactly, in bytes");
});
