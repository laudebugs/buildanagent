// The second process of the secret key store test: it reads the key ring from the KEY_RING_SECRET variable, as a
// serverless host reads a platform secret, opens the paused session from its files and resolves the request. It prints
// the stop reason of the resumed turn.
import process from "node:process";
import { createApprovals, openSession, secretKeyStore } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { refundHarness } from "./approvals-fixture.js";

const [dir, runsFile, sessionId, requestId] = process.argv.slice(2) as [string, string, string, string];
const harness = await refundHarness({
  steps: [{ content: [{ type: "text", text: "Refunded." }] }],
  keyStore: secretKeyStore({ read: () => process.env.KEY_RING_SECRET ?? "" }),
  runsFile,
});
const session = await openSession({
  store: jsonlStore({ dir: `${dir}/sessions` }),
  index: fileIndex({ dir: `${dir}/pointers` }),
  lock: fileLock({ dir: `${dir}/locks` }),
  key: { userId: "ada", sessionId },
});
const result = await createApprovals(harness).resolve(session, [{ requestId, decision: "allow", by: "ada" }]);
await session.close();
console.log(JSON.stringify({ stopReason: result.stopReason }));
