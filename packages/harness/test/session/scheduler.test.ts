// The scheduler seam: processScheduler() against the conformance suite, its own edge cases, and the file lock's renewals
// running through it. Timers and the clock are driven by hand, so no case waits.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ProcessScheduler, processScheduler } from "@buildanagent/harness/session";
import { fileLock } from "@buildanagent/harness/session/jsonl";
import {
  runSchedulerConformance,
  type SchedulerFactory,
  schedulerConformanceCases,
} from "@buildanagent/harness/testing";
import { afterAll, test } from "vitest";

const START = Date.parse("2026-01-01T00:00:00.000Z");

/** Timers and a clock a test moves by hand: `advanceTo` runs every timer that has come due, earliest first. */
function manualTime() {
  let time = START;
  let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    setTimer: (callback: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimer: (timer: unknown) => {
      timers.delete(timer as number);
    },
    pending: () => timers.size,
    async advanceTo(to: number) {
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        time = Math.max(time, due[1].at);
        due[1].callback();
        await Promise.resolve();
      }
      time = to;
    },
  };
}

const factory: SchedulerFactory = () => {
  const clock = manualTime();
  const scheduler = processScheduler(clock);
  const delivered: { sessionId: string; at: Date }[] = [];
  scheduler.onWake((sessionId, at) => {
    delivered.push({ sessionId, at });
  });
  return {
    scheduler,
    now: () => new Date(clock.now()),
    advanceTo: (to) => clock.advanceTo(to.getTime()),
    delivered: () => delivered,
  };
};

for (const conformance of schedulerConformanceCases(factory)) {
  test(`processScheduler: ${conformance.name}`, async () => {
    await conformance.run();
  });
}

test("processScheduler passes every conformance case and skips none", async () => {
  const report = await runSchedulerConformance(factory);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.skipped, []);
});

test("asking twice for the same id and time is one wake, and a wake is delivered once", async () => {
  const clock = manualTime();
  const scheduler = processScheduler(clock);
  const seen: string[] = [];
  scheduler.onWake((id) => {
    seen.push(id);
  });
  const at = new Date(START + 1_000);
  await scheduler.wake(at, "s1");
  await scheduler.wake(at, "s1");
  assert.equal(clock.pending(), 1);
  await clock.advanceTo(START + 5_000);
  assert.deepEqual(seen, ["s1"]);
  await clock.advanceTo(START + 10_000);
  assert.deepEqual(seen, ["s1"], "a delivered wake does not come again");
});

test("a handler that throws does not stop the next handler, and the error is reported", async () => {
  const clock = manualTime();
  const errors: string[] = [];
  const scheduler = processScheduler({ ...clock, onError: (error, id) => errors.push(`${id}:${String(error)}`) });
  const seen: string[] = [];
  scheduler.onWake(() => {
    throw new Error("first");
  });
  scheduler.onWake(async (id) => {
    seen.push(id);
  });
  await scheduler.wake(new Date(START + 1), "s1");
  await clock.advanceTo(START + 2);
  await Promise.resolve();
  assert.deepEqual(seen, ["s1"]);
  assert.deepEqual(errors, ["s1:Error: first"]);
});

test("a stopped handler gets no more wakes", async () => {
  const clock = manualTime();
  const scheduler = processScheduler(clock);
  const seen: string[] = [];
  const stop = scheduler.onWake((id) => {
    seen.push(id);
  });
  stop();
  await scheduler.wake(new Date(START + 1), "s1");
  await clock.advanceTo(START + 2);
  assert.deepEqual(seen, []);
});

test("a wake farther off than one timer can sleep arrives in steps, once, at its time", async () => {
  const clock = manualTime();
  const scheduler = processScheduler(clock);
  const seen: number[] = [];
  scheduler.onWake((_id, at) => {
    seen.push(at.getTime());
  });
  const far = START + 2 ** 31 * 3;
  await scheduler.wake(new Date(far), "s1");
  await clock.advanceTo(far - 1);
  assert.deepEqual(seen, []);
  await clock.advanceTo(far);
  assert.deepEqual(seen, [far]);
});

test("a timer that fires early looks at the clock and waits again", async () => {
  let time = START;
  const callbacks: (() => void)[] = [];
  const scheduler = processScheduler({
    now: () => time,
    setTimer: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimer: () => undefined,
  });
  const seen: string[] = [];
  scheduler.onWake((id) => {
    seen.push(id);
  });
  await scheduler.wake(new Date(START + 100), "s1");
  time = START + 99;
  callbacks[0]?.();
  assert.deepEqual(seen, [], "no wake before its time");
  assert.equal(callbacks.length, 2, "it armed again");
  time = START + 100;
  callbacks[1]?.();
  await Promise.resolve();
  assert.deepEqual(seen, ["s1"]);
});

test("a cancelled wake whose timer is already due does not fire", async () => {
  const clock = manualTime();
  let fire: (() => void) | undefined;
  const scheduler = processScheduler({
    ...clock,
    setTimer: (callback) => {
      fire = callback;
      return 1;
    },
    clearTimer: () => undefined,
  });
  const seen: string[] = [];
  scheduler.onWake((id) => {
    seen.push(id);
  });
  await scheduler.wake(new Date(START), "s1");
  await scheduler.cancel("s1");
  fire?.();
  await Promise.resolve();
  assert.deepEqual(seen, []);
});

test("an invalid date is refused", async () => {
  await assert.rejects(processScheduler().wake(new Date("nope"), "s1"), TypeError);
});

// The file lock renews its lease through a scheduler.
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-sched-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const KEY = { userId: "ada", sessionId: "s1" };
const leaseUntil = (dir: string) =>
  (JSON.parse(readFileSync(join(dir, "ada", "s1.lock"), "utf8")) as { leaseUntil: number }).leaseUntil;

/** A scheduler a test fires by hand, and a log of what the lock asked it for. */
function manualScheduler() {
  const wakes: { at: Date; id: string }[] = [];
  const cancels: string[] = [];
  const handlers = new Set<(id: string, at: Date) => void | Promise<void>>();
  const scheduler: ProcessScheduler = {
    wake: (at, id) => {
      wakes.push({ at, id });
      return Promise.resolve();
    },
    cancel: (id) => {
      cancels.push(id);
      return Promise.resolve();
    },
    onWake: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return {
    scheduler,
    wakes,
    cancels,
    listeners: () => handlers.size,
    deliver: async (index: number) => {
      const wake = wakes[index];
      if (wake === undefined) throw new Error("no such wake");
      for (const handler of [...handlers]) await handler(wake.id, wake.at);
      // The renewal itself is asynchronous file work.
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  };
}

test("a hold asks the scheduler for its renewal, renews when woken and asks again", async () => {
  const dir = tempDir();
  const sched = manualScheduler();
  let time = 1_000_000;
  const lock = fileLock({ dir, leaseMs: 5_000, renewMs: 1_000, now: () => time, scheduler: sched.scheduler });
  const handle = await lock.acquire(KEY);
  assert.notEqual(handle, "would_block");
  if (handle === "would_block") return;
  assert.equal(sched.wakes.length, 1);
  assert.equal(
    sched.wakes[0]?.id,
    "lease:ada/s1",
    "the id is prefixed so a host's own wakes for the session stay apart",
  );
  const before = leaseUntil(dir);
  time += 3_000;
  await sched.deliver(0);
  assert.equal(leaseUntil(dir), before + 3_000, "the wake renewed the lease");
  assert.equal(sched.wakes.length, 2, "and asked for the next renewal");
  await handle.release();
});

test("a duplicate renewal wake renews once and does not start a second chain", async () => {
  const dir = tempDir();
  const sched = manualScheduler();
  const lock = fileLock({ dir, leaseMs: 5_000, renewMs: 1_000, scheduler: sched.scheduler });
  const handle = await lock.acquire(KEY);
  assert.notEqual(handle, "would_block");
  if (handle === "would_block") return;
  await sched.deliver(0);
  await sched.deliver(0);
  assert.equal(sched.wakes.length, 2, "the second delivery of the first wake asked for nothing");
  await handle.release();
});

test("a wake for another id is ignored, and a release cancels the renewal and stops listening", async () => {
  const dir = tempDir();
  const sched = manualScheduler();
  const lock = fileLock({ dir, leaseMs: 5_000, renewMs: 1_000, scheduler: sched.scheduler });
  const handle = await lock.acquire(KEY);
  assert.notEqual(handle, "would_block");
  if (handle === "would_block") return;
  assert.equal(sched.listeners(), 1);
  await handle.release();
  assert.deepEqual(sched.cancels, ["lease:ada/s1"]);
  assert.equal(sched.listeners(), 0);
  assert.deepEqual(readdirSync(join(dir, "ada")), []);
});

test("the default scheduler renews on a real timer with no scheduler passed", async () => {
  const dir = tempDir();
  const lock = fileLock({ dir, leaseMs: 400, renewMs: 40 });
  const handle = await lock.acquire(KEY);
  assert.notEqual(handle, "would_block");
  if (handle === "would_block") return;
  const first = leaseUntil(dir);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(leaseUntil(dir) > first, "the lease was renewed");
  await handle.release();
});

test("no setInterval remains in src/session", () => {
  const dir = new URL("../../src/session/", import.meta.url);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(new URL(name, dir), "utf8");
    assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /setInterval/, `${name} uses setInterval`);
  }
});
