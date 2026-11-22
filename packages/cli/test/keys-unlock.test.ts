// `buildanagent keys rotate|prune` and `session unlock --force`: the key ring and the writer lock, from the terminal.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileLock } from "@buildanagent/harness/session/jsonl";
import { afterEach, test } from "vitest";
import { callTool, cli, jsonLines, recordingTool, scripted, stateDir, terminal } from "./cli-helpers.js";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});
const fresh = () => {
  const state = stateDir();
  cleanups.push(state.cleanup);
  return state.dir;
};
const ringOf = (dir: string) =>
  JSON.parse(readFileSync(`${dir}/keys.json`, "utf8")) as { current: string; keys: Record<string, string> };

/** Leaves one session waiting on a refund, signed with the ring's current key. */
async function paused(dir: string): Promise<void> {
  const { model } = scripted([{ content: [callTool("c1", "refund", { order: "o1" })] }]);
  const status = await cli(terminal(), dir, ["run", "Refund o1"], {
    model,
    tools: [recordingTool("refund", [])],
    rules: { ask: [{ tool: "refund" }] },
  });
  assert.equal(status, 3);
}

test("keys rotate adds a current key and keeps the old one", async () => {
  const dir = fresh();
  await paused(dir);
  const before = ringOf(dir);
  const term = terminal();
  assert.equal(await cli(term, dir, ["keys", "rotate", "--json"]), 0);
  const [{ rotated } = {}] = jsonLines(term);
  const after = ringOf(dir);
  assert.equal(after.current, rotated);
  assert.deepEqual(Object.keys(after.keys).sort(), [before.current, rotated as string].sort());
});

test("keys prune keeps a key a waiting request names, and removes it once none does", async () => {
  const dir = fresh();
  await paused(dir);
  const signing = ringOf(dir).current;
  assert.equal(await cli(terminal(), dir, ["keys", "rotate"]), 0);
  const kept = terminal();
  assert.equal(await cli(kept, dir, ["keys", "prune"]), 0);
  assert.equal(kept.stdout.join(""), "no key to remove\n");
  assert.ok(signing in ringOf(dir).keys);

  const other = fresh();
  assert.equal(await cli(terminal(), other, ["keys", "rotate"]), 0);
  const unused = Object.keys(ringOf(other).keys).find((id) => id !== ringOf(other).current) as string;
  const pruned = terminal();
  assert.equal(await cli(pruned, other, ["keys", "prune"]), 0);
  assert.equal(pruned.stdout.join(""), `removed ${unused}\n`);
  assert.deepEqual(Object.keys(ringOf(other).keys), [ringOf(other).current]);
});

test("session unlock without --force removes nothing and exits 2", async () => {
  const dir = fresh();
  const handle = await fileLock({ dir: `${dir}/locks` }).acquire({ userId: "local", sessionId: "s1" });
  assert.notEqual(handle, "would_block");
  try {
    const term = terminal();
    assert.equal(await cli(term, dir, ["session", "unlock", "s1"]), 2);
    assert.match(term.stderr.join(""), /pass --force/);
    assert.ok(existsSync(`${dir}/locks/local/s1.lock`));
  } finally {
    if (handle !== "would_block") await handle.release();
  }
});

test("session unlock --force removes the lock and says whose it was", async () => {
  const dir = fresh();
  const lock = fileLock({ dir: `${dir}/locks` });
  const handle = await lock.acquire({ userId: "local", sessionId: "s1" });
  assert.notEqual(handle, "would_block");
  try {
    const term = terminal();
    assert.equal(await cli(term, dir, ["session", "unlock", "s1", "--force"]), 0);
    assert.match(term.stdout.join(""), new RegExp(`^removed the lock of process ${process.pid} on \\S+ from s1\\n$`));
    assert.ok(!existsSync(`${dir}/locks/local/s1.lock`));
    const again = terminal();
    assert.equal(await cli(again, dir, ["session", "unlock", "s1", "--force"]), 0);
    assert.equal(again.stdout.join(""), "s1 had no lock\n");
  } finally {
    if (handle !== "would_block") await handle.release();
  }
});
