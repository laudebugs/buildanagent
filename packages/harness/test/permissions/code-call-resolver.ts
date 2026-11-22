// The second process of the code-call test: it opens the paused session from its files, loads the key ring from its
// file and resolves the code call's request with an allow. It prints the result's status, or the error's code.
import process from "node:process";
import { isHarnessError } from "@buildanagent/harness";
import { createApprovals, openSession } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { codeCallHarness } from "./code-call-fixture.js";

const [dir, keysPath, runsFile, requestId] = process.argv.slice(2) as [string, string, string, string];
const { harness, adapter } = await codeCallHarness({ keysPath, runsFile });
const session = await openSession({
  store: jsonlStore({ dir: `${dir}/sessions` }),
  index: fileIndex({ dir: `${dir}/pointers` }),
  lock: fileLock({ dir: `${dir}/locks` }),
  key: { userId: "ada", sessionId: "code-call" },
});
try {
  const result = await createApprovals(harness).resolve(session, [{ requestId, decision: "allow", by: "ada" }]);
  console.log(
    JSON.stringify({ status: "status" in result ? result.status : "turn", modelCalls: adapter.calls.length }),
  );
} catch (error) {
  console.log(JSON.stringify({ error: isHarnessError(error) ? error.code : "other" }));
} finally {
  await session.close();
}
