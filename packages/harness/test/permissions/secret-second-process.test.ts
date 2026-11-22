// ADR 0035's acceptance test: a pause signed under a key ring read from a secret resumes in a second process that reads
// the same secret, and a process that reads another secret fails closed and runs nothing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApprovals, openSession, runTurn, secretKeyStore } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";
import { testEnv } from "../sandbox/home.js";
import { refundHarness } from "./approvals-fixture.js";

const dir = mkdtempSync(join(tmpdir(), "harness-secret-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const resolver = fileURLToPath(new URL("./secret-resolver.ts", import.meta.url));
const sourceCondition = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

const ringText = (id: string) => JSON.stringify({ current: id, keys: { [id]: randomBytes(32).toString("base64url") } });
const SECRET = ringText("2026-11");

/** Pauses a refund in this process, signed under the ring in `SECRET`, and returns the waiting request. */
async function pause(sessionId: string, runsFile: string) {
  const harness = await refundHarness({
    steps: [{ content: [{ type: "tool_call", callId: "c1", name: "refund", input: { orderId: "o1" } }] }],
    keyStore: secretKeyStore({ read: () => SECRET }),
    runsFile,
  });
  const session = await openSession({
    store: jsonlStore({ dir: join(dir, "sessions") }),
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
    key: { userId: "ada", sessionId },
  });
  const paused = await runTurn(session, harness, { input: "refund o1" });
  assert.equal(paused.stopReason, "awaiting_approval");
  const [waiting] = await createApprovals(harness).pending(session);
  await session.close();
  assert.equal(waiting?.request.keyId, "2026-11", "the pause is signed under the secret's current key");
  return waiting?.request.id as string;
}

/** Resolves the request in a child process that reads its ring from `secret`, and returns the resumed stop reason. */
function resolveInChild(sessionId: string, requestId: string, runsFile: string, secret: string): unknown {
  // A cleared environment that holds only the secret: nothing else is inherited.
  const output = execFileSync(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      sourceCondition,
      "--import",
      "tsx",
      resolver,
      dir,
      runsFile,
      sessionId,
      requestId,
    ],
    { cwd: packageDir, env: testEnv([], { KEY_RING_SECRET: secret }), encoding: "utf8" },
  );
  return JSON.parse(output.trim().split("\n").at(-1) as string);
}

test("a pause signed under a key from secretKeyStore() resumes in a second process that reads the same secret", async () => {
  const runsFile = join(dir, "same.log");
  const requestId = await pause("same", runsFile);
  assert.deepEqual(resolveInChild("same", requestId, runsFile, SECRET), { stopReason: "done" });
  assert.deepEqual(readFileSync(runsFile, "utf8").trim().split("\n"), ["o1"], "the call ran once, in the child");
});

test("a second process that reads a different secret fails closed: nothing runs and the call asks again", async () => {
  const runsFile = join(dir, "other.log");
  const requestId = await pause("other", runsFile);
  const other = ringText("2026-11");
  assert.deepEqual(resolveInChild("other", requestId, runsFile, other), { stopReason: "awaiting_approval" });
  assert.equal(existsSync(runsFile), false, "the refund never ran");
});
