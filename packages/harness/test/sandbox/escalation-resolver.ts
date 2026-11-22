// The second process of the escalation test: it opens the paused session from its files, loads the key ring from its
// file and allows the escalation's request, so the rerun runs here, in a fresh fake sandbox. It prints the result's
// status and what this process ran, or the error's code.
import process from "node:process";
import { isHarnessError } from "@buildanagent/harness";
import { escalation } from "@buildanagent/harness/sandbox";
import { openSession } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { escalationHarness, ROOT } from "./escalation-fixture.js";

const [dir, keysPath, requestId] = process.argv.slice(2) as [string, string, string];
const { approvals, client, adapter } = await escalationHarness({ keysPath });
const session = await openSession({
  store: jsonlStore({ dir: `${dir}/sessions` }),
  index: fileIndex({ dir: `${dir}/pointers` }),
  lock: fileLock({ dir: `${dir}/locks` }),
  key: { userId: "ada", sessionId: "escalation" },
});
try {
  const machine = escalation({ approvalPolicy: "on-request", approvals });
  const result = await machine.resolve(
    session,
    { requestId, decision: "allow", by: "grace" },
    { client, manifest: { root: ROOT }, env: { PATH: "/usr/bin" }, signal: new AbortController().signal },
  );
  const stdout = result.status === "ran" ? result.exec.stdout : "";
  console.log(
    JSON.stringify({ status: result.status, stdout, execs: client.execs.length, modelCalls: adapter.calls.length }),
  );
} catch (error) {
  console.log(JSON.stringify({ error: isHarnessError(error) ? error.code : "other" }));
} finally {
  await session.close();
}
