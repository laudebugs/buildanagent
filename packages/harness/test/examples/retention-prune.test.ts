// Runs the README's retention example over an empty folder: nothing is old enough to archive or purge, and nothing fails.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "retention-example-"));
process.env.SESSIONS_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the retention example runs one pass over an empty store without errors", async () => {
  const result = await import("../../examples/retention-prune.js");
  assert.deepEqual([result.archived, result.purged, result.errors], [[], [], []]);
  assert.ok(result.store);
});
