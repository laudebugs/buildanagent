// Retention against a file system the test can watch and stop: what a run reads, and an append the store has already
// started when a pass begins. `node:fs/promises` is wrapped, and every call goes through to the real one.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionKey } from "@buildanagent/harness/session";
import { jsonlStore, pruneSessions } from "@buildanagent/harness/session/jsonl";
import { afterAll, afterEach, describe, test, vi } from "vitest";
import { header, NOW, record } from "./session-helpers.js";

/** What the wrapped calls report, and the hooks a test sets. Hoisted, because `vi.mock` runs before the imports. */
const fs = vi.hoisted(() => ({
  readFile: [] as string[],
  /** Runs before the real `open()` of a file for appending. */
  beforeAppend: undefined as ((path: string) => Promise<void>) | undefined,
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
      if (flags === "a") await fs.beforeAppend?.(String(path));
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
  fs.beforeAppend = undefined;
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
