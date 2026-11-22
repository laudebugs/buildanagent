// A second process resolves a pause the first one wrote: the log and the key file are all it has, and the call runs once.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApprovals, openSession, runTurn } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";
import { testEnv } from "../sandbox/home.js";
import { refundHarness } from "./approvals-fixture.js";

const dir = mkdtempSync(join(tmpdir(), "harness-approvals-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const resolver = fileURLToPath(new URL("./approvals-resolver.ts", import.meta.url));
const sourceCondition = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

test("a second process resolves the pause from the log and the key file, and the call runs once", async () => {
  const keysPath = join(dir, "state", "keys.json");
  const runsFile = join(dir, "runs.log");
  const harness = await refundHarness({
    steps: [{ content: [{ type: "tool_call", callId: "c1", name: "refund", input: { orderId: "o1" } }] }],
    keysPath,
    runsFile,
  });
  const key = { userId: "ada", sessionId: "paused" };
  const session = await openSession({
    store: jsonlStore({ dir: join(dir, "sessions") }),
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
    key,
  });
  const paused = await runTurn(session, harness, { input: "refund o1" });
  assert.equal(paused.stopReason, "awaiting_approval");
  const [waiting] = await createApprovals(harness).pending(session);
  await session.close();
  // A cleared environment: the child gets the key from its file, and nothing else is inherited.
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
      waiting?.request.id as string,
    ],
    { cwd: packageDir, env: testEnv([]), encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output.trim().split("\n").at(-1) as string), { stopReason: "done" });
  assert.deepEqual(readFileSync(runsFile, "utf8").trim().split("\n"), ["o1"], "the call ran once, in the child");
});
