// The lock file is checked and read through one open handle, so a file swapped in between the check and the read,
// or a pipe put at its path, is never read. The swap is made deterministic by replacing the file the moment the first
// file-system call on it returns.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test, vi } from "vitest";

const swap = vi.hoisted(() => ({ armed: undefined as undefined | (() => void) }));

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  const after =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await call(...args);
      const run = swap.armed;
      swap.armed = undefined;
      run?.();
      return result;
    };
  return { ...real, lstat: after(real.lstat), stat: after(real.stat), open: after(real.open) };
});

const { readMcpPins } = await import("../../src/extensions/lock.js");

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function lockDir(): { dir: string; lock: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-lock-race-"));
  dirs.push(dir);
  return { dir, lock: join(dir, "extensions.lock.json") };
}

test("a file swapped in after the check is not the one read", async () => {
  const { dir, lock } = lockDir();
  writeFileSync(lock, JSON.stringify({ version: 1, mcp: { srv: { tools: { small: "x" } } } }));
  const big = join(dir, "big");
  writeFileSync(
    big,
    JSON.stringify({ version: 1, mcp: { srv: { tools: { big: "x" } } }, pad: "a".repeat(2 * 1024 * 1024) }),
  );
  swap.armed = () => renameSync(big, lock);
  const pins = await readMcpPins(lock, "srv");
  assert.deepEqual(Object.keys(pins ?? {}), ["small"], "the file read is the one that was checked");
});

test("a pipe swapped in after the check is never read, so the read can't block", async () => {
  const { dir, lock } = lockDir();
  writeFileSync(lock, JSON.stringify({ version: 1, mcp: { srv: { tools: {} } } }));
  const fifo = join(dir, "fifo");
  execFileSync("mkfifo", [fifo]);
  swap.armed = () => renameSync(fifo, lock);
  const outcome = await Promise.race([
    readMcpPins(lock, "srv").then(
      () => "read",
      () => "refused",
    ),
    new Promise((resolve) => setTimeout(resolve, 2000, "blocked")),
  ]);
  assert.notEqual(outcome, "blocked");
});
