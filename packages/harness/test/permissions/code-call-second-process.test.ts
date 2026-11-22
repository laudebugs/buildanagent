// A code call asked in one process is resolved in another: the log and the key file are all the second process has,
// the tool runs exactly once, there, with no model call, and a replay of the same answer runs nothing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSession } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";
import { testEnv } from "../sandbox/home.js";
import { codeCallHarness } from "./code-call-fixture.js";

const dir = mkdtempSync(join(tmpdir(), "harness-code-call-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const resolver = fileURLToPath(new URL("./code-call-resolver.ts", import.meta.url));
const sourceCondition = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

/** Resolves the request in a child process with a cleared environment, and returns what it printed last. */
function resolveInChild(keysPath: string, runsFile: string, requestId: string): unknown {
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
      keysPath,
      runsFile,
      requestId,
    ],
    { cwd: packageDir, env: testEnv([]), encoding: "utf8" },
  );
  return JSON.parse(output.trim().split("\n").at(-1) as string);
}

test("a second process resolves a code call with an allow, runs the tool exactly once and returns done; a replay runs nothing", async () => {
  const keysPath = join(dir, "state", "keys.json");
  const runsFile = join(dir, "runs.log");
  const { harness, runs } = await codeCallHarness({ keysPath, runsFile });
  const session = await openSession({
    store: jsonlStore({ dir: join(dir, "sessions") }),
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
    key: { userId: "ada", sessionId: "code-call" },
  });
  const asked = await harness.invokeTool(session, { tool: "refund", input: { orderId: "o1" } });
  await session.close();
  assert.ok(asked.status === "awaiting_approval");
  assert.deepEqual(runs, [], "nothing ran in the process that asked");
  assert.deepEqual(resolveInChild(keysPath, runsFile, asked.pending.id), { status: "done", modelCalls: 0 });
  assert.deepEqual(readFileSync(runsFile, "utf8").trim().split("\n"), [`refund:o1:${asked.callId}`]);
  assert.deepEqual(resolveInChild(keysPath, runsFile, asked.pending.id), { error: "approval_not_pending" });
  assert.deepEqual(readFileSync(runsFile, "utf8").trim().split("\n"), [`refund:o1:${asked.callId}`], "still once");
});
