// Retention against a file system the test can watch and stop: what a run reads, and an append the store has already
// started when a pass begins. `node:fs/promises` is wrapped, and every call goes through to the real one.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionKey } from "@buildanagent/harness/session";
import { jsonlStore, pruneSessions } from "@buildanagent/harness/session/jsonl";
import { afterAll, afterEach, describe, test, vi } from "vitest";
import { header, NOW, record } from "./session-helpers.js";

/** What the wrapped calls report, and the hooks a test sets. Hoisted, because `vi.mock` runs before the imports. */
const fs = vi.hoisted(() => ({
  readFile: [] as string[],
  /** Runs before the real `open()`. */
  beforeOpen: undefined as ((path: string, flags: string | undefined) => Promise<void>) | undefined,
  /** Runs before the real `rm()`. */
  beforeRm: undefined as ((path: string) => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: ((path: Parameters<typeof real.readFile>[0], ...rest: unknown[]) => {
      fs.readFile.push(String(path));
      return (real.readFile as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof real.readFile,
    open: (async (path: string, flags?: string, mode?: number) => {
      await fs.beforeOpen?.(String(path), flags);
      return real.open(path, flags, mode);
    }) as typeof real.open,
    rm: (async (path: string, options?: Parameters<typeof real.rm>[1]) => {
      await fs.beforeRm?.(String(path));
      return real.rm(path, options);
    }) as typeof real.rm,
  };
});

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  fs.readFile.length = 0;
  fs.beforeOpen = undefined;
  fs.beforeRm = undefined;
});

const OLD: SessionKey = { userId: "ada", sessionId: "old" };
const OTHER: SessionKey = { userId: "ada", sessionId: "other" };

async function folder() {
  const dir = mkdtempSync(join(tmpdir(), "harness-retention-io-"));
  dirs.push(dir);
  const plain = jsonlStore({ dir });
  await plain.append(OLD, [header(), record("r1", "h1")]);
  await plain.append(OTHER, [header(), record("r1", "h1")]);
  return dir;
}

async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

describe("what a run reads", () => {
  test("a live file with no complete line that gets one just before the purge removes it keeps the session", async () => {
    const dir = await folder();
    await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "archive" }, now: NOW });
    const stub = join(dir, "ada", "old.jsonl");
    await writeFile(stub, '{"id":"torn"');
    let reads = 0;
    fs.beforeOpen = async (path, flags) => {
      if (path !== stub || flags !== "r") return;
      reads += 1;
      // The first read is the scan's and the second the check after the locks; the third is the purge's own.
      if (reads === 3) await writeFile(stub, `${JSON.stringify(header())}\n`);
    };
    const result = await pruneSessions({ dir, userId: "ada", retention: { days: 30, action: "purge" }, now: NOW });
    assert.equal(reads, 3);
    assert.deepEqual(result.purged, ["other"]);
    assert.deepEqual(result.kept, [{ sessionId: "old", reason: "error" }]);
    assert.ok(existsSync(stub));
    assert.ok(existsSync(join(dir, ".archive", "ada", "old.jsonl.gz")));
  });

  test("a live file is read at its two ends, never whole, and an archive is unpacked once while it is unchanged", async () => {
    const dir = await folder();
    const early = () => new Date("2026-01-10T00:00:00.000Z");
    const options = { dir, userId: "ada", retention: { days: 30, action: "archive" as const }, now: early };
    // Nothing is expired under this clock, so the run only reads.
    assert.deepEqual((await pruneSessions(options)).archived, []);
    assert.deepEqual(
      fs.readFile.filter((path) => path.endsWith(".jsonl")),
      [],
      "no live file was read whole",
    );
    await pruneSessions({ ...options, now: NOW });
    fs.readFile.length = 0;
    const purge = { ...options, retention: { days: 30, action: "purge" as const } };
    assert.deepEqual((await pruneSessions(purge)).purged, []);
    assert.deepEqual((await pruneSessions(purge)).purged, []);
    assert.deepEqual(fs.readFile.sort(), [
      join(dir, ".archive", "ada", "old.jsonl.gz"),
      join(dir, ".archive", "ada", "other.jsonl.gz"),
    ]);
  });
});

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

describe("a store call already past expiry when a later pass starts", () => {
  /** A store whose first pass failed, so the first touch a minute later starts a second one; and the clock it reads. */
  async function retrying(dir: string, action: "archive" | "purge") {
    // An archive folder that is a file makes the first pass fail.
    await writeFile(join(dir, ".archive"), "in the way");
    const clock = { now: NOW().getTime() };
    const errors: unknown[] = [];
    const store = jsonlStore({
      dir,
      retention: { days: 30, action },
      now: () => new Date(clock.now),
      onRetentionError: (error) => errors.push(error),
    });
    await all(store.list("ada"));
    assert.equal(errors.length, 1);
    await rm(join(dir, ".archive"));
    return { store, clock, errors };
  }

  /**
   * Starts an append to `other` and holds it just before it writes. Once the pass reaches the rm of other.jsonl, which
   * only a pass that ignores the held append does, the append is let go and the rm waits for it, so its entry lands
   * after the pass's last read of the file.
   */
  async function heldAppend(dir: string, store: ReturnType<typeof jsonlStore>) {
    const live = join(dir, "ada", "other.jsonl");
    const held = gate();
    fs.beforeOpen = async (path, flags) => {
      if (path !== live || flags !== "a") return;
      held.reached();
      await held.opened;
    };
    const appending = store.append(OTHER, [record("r2", "r1")], { expectedLastId: "r1" });
    await held.arrived;
    fs.beforeRm = async (path) => {
      if (path !== live) return;
      held.open();
      await appending.catch(() => undefined);
    };
    return { appending, release: held.open };
  }

  for (const action of ["archive", "purge"] as const) {
    test(`${action === "archive" ? "an archive" : "a purge"} keeps a session whose append is in flight`, async () => {
      const dir = await folder();
      const { store, clock, errors } = await retrying(dir, action);
      const { appending, release } = await heldAppend(dir, store);
      clock.now += 61_000;
      await all(store.load(OLD));
      release();
      assert.deepEqual(
        (await appending).map((entry) => entry.id),
        ["r2"],
      );
      assert.deepEqual(
        (await all(store.load(OTHER))).map((entry) => entry.id),
        ["h1", "r1", "r2"],
        "the acknowledged entry is in the log",
      );
      assert.deepEqual(errors.length, 1, "the second pass had no error");
      const oldArchive = existsSync(join(dir, ".archive", "ada", "old.jsonl.gz"));
      assert.equal(oldArchive, action === "archive", "the pass expired the session it could");
      assert.equal(existsSync(join(dir, "ada", "old.jsonl")), false);
    });
  }
});
