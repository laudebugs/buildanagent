// An escalation asked in one process is resolved in another: the log and the key file are all the second process
// has. The rerun runs exactly once, there, under the widened policy, with no model call, and a replay of the same
// answer runs nothing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { escalation } from "@buildanagent/harness/sandbox";
import { openSession } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { afterAll, test } from "vitest";
import { BASE_POLICY, escalationHarness, ROOT } from "./escalation-fixture.js";
import { testEnv } from "./home.js";

const dir = mkdtempSync(join(tmpdir(), "harness-escalation-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const resolver = fileURLToPath(new URL("./escalation-resolver.ts", import.meta.url));
const sourceCondition = fileURLToPath(new URL("../permissions/source-condition.mjs", import.meta.url));
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

/** Resolves the request in a child process with a cleared environment, and returns what it printed last. */
function resolveInChild(keysPath: string, requestId: string): unknown {
  const output = execFileSync(
    process.execPath,
    ["--conditions=source", "--import", sourceCondition, "--import", "tsx", resolver, dir, keysPath, requestId],
    { cwd: packageDir, env: testEnv([]), encoding: "utf8" },
  );
  return JSON.parse(output.trim().split("\n").at(-1) as string);
}

test("a second process allows an escalation, reruns the command exactly once and returns ran; a replay runs nothing", async () => {
  const keysPath = join(dir, "state", "keys.json");
  const { approvals, client } = await escalationHarness({ keysPath });
  const session = await openSession({
    store: jsonlStore({ dir: join(dir, "sessions") }),
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
    key: { userId: "ada", sessionId: "escalation" },
  });
  const asked = await escalation({ approvalPolicy: "on-request", approvals }).run(session, {
    tool: "run",
    input: { command: ["net-probe", "example.com"] },
    command: ["net-probe", "example.com"],
    env: { PATH: "/usr/bin" },
    signal: new AbortController().signal,
    client,
    manifest: { root: ROOT },
    policy: BASE_POLICY,
  });
  await session.close();
  assert.ok(asked.status === "awaiting_approval");
  assert.equal(client.execs.length, 1, "only the first, denied run happened here");
  assert.deepEqual(resolveInChild(keysPath, asked.pending.id), {
    status: "ran",
    stdout: "reached example.com\n",
    execs: 1,
    modelCalls: 0,
  });
  assert.deepEqual(resolveInChild(keysPath, asked.pending.id), { error: "approval_not_pending" });
});
