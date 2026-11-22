// The second process of the approvals test: it opens the paused session from its files, loads the key ring from its
// file, and resolves the request. It prints the stop reason of the resumed turn.
import process from "node:process";
import { createApprovals, openSession } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { refundHarness } from "./approvals-fixture.js";
import { asTurn } from "./helpers.js";

const [dir, keysPath, runsFile, requestId] = process.argv.slice(2) as [string, string, string, string];
const harness = await refundHarness({
  steps: [{ content: [{ type: "text", text: "Refunded." }] }],
  keysPath,
  runsFile,
});
const session = await openSession({
  store: jsonlStore({ dir: `${dir}/sessions` }),
  index: fileIndex({ dir: `${dir}/pointers` }),
  lock: fileLock({ dir: `${dir}/locks` }),
  key: { userId: "ada", sessionId: "paused" },
});
const result = await createApprovals(harness).resolve(session, [{ requestId, decision: "allow", by: "ada" }]);
await session.close();
console.log(JSON.stringify({ stopReason: asTurn(result).stopReason }));
