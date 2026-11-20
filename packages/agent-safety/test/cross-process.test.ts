import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("./fixtures/approval-process.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
const HOME = mkdtempSync(join(tmpdir(), "agent-safety-cross-process-"));
afterAll(() => rmSync(HOME, { recursive: true, force: true }));

// Two 32-byte keys in the form a Worker secret or environment variable would hold them.
const KEY_RING = JSON.stringify({
  current: "2026-11",
  keys: {
    "2026-10": "b2N0b2Jlci1rZXktMzItYnl0ZXMtbG9uZy0tLS0tLS0",
    "2026-11": "bm92ZW1iZXIta2V5LTMyLWJ5dGVzLWxvbmctLS0tLS0",
  },
});

/** Runs one side in a fresh Node process whose environment holds only what it needs: no credentials, no state. */
function side(mode: "pause" | "resume", signer: "ring" | "ephemeral", input?: string): string {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME, TMPDIR: HOME, LANG: "C.UTF-8" };
  if (signer === "ring") env.KEY_RING = KEY_RING;
  const run = spawnSync(process.execPath, ["--import", TSX, SCRIPT, mode, signer], {
    env,
    input: input ?? "",
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(run.status, 0, `the ${mode} process failed: ${run.stderr}`);
  return run.stdout;
}

test("a pause signed in one process resumes in another that loads only the same key ring", () => {
  const handoff = side("pause", "ring");
  assert.ok(!handoff.includes("bm92ZW1iZXIta2V5"), "the handoff holds no key material");
  assert.deepEqual(JSON.parse(side("resume", "ring", handoff)), { executed: 1, denials: [] });
});

test("an ephemeral signer's pause fails closed in a second process", () => {
  const handoff = side("pause", "ephemeral");
  assert.deepEqual(JSON.parse(side("resume", "ephemeral", handoff)), {
    executed: 0,
    denials: ["signature_invalid"],
  });
});
