// The first process of the capstone's crash test. It triages the ticket until the escalation pauses, approves it, and
// stops inside the page: once the fake pager has accepted it and before the record is settled or the tool's result is
// in the log. It prints "accepted" there and waits, and the test kills it with SIGKILL.
import process from "node:process";
import { openSession, type Session } from "@buildanagent/harness/session";
import { answerTriage, startTriage, triageHarness } from "../../examples/triage-session.js";
import { triageRegistry } from "../../examples/triage-tools.js";
import { guardedPager, LEASE_MS } from "./crash-systems.js";
import { CUSTOMER, ESCALATE, filesAt, KEY, LOOKUP, recordedModel, signer, TICKET, world } from "./triage-fixture.js";

const [dir, effects, pager] = process.argv.slice(2) as [string, string, string];
const target: { session?: Session; harness?: never } = {};
const escalate = guardedPager({
  target,
  effects,
  pager,
  onAccepted: async () => {
    console.log("accepted");
    await new Promise(() => undefined);
  },
});
const { deps } = world();
const model = recordedModel([LOOKUP, ESCALATE]);
const registry = triageRegistry({ ...deps, escalate });
const harness = triageHarness({ model: model.model, signer: signer(), registry, policy: { version: "triage-1" } });
const session = await openSession({ ...filesAt(dir, LEASE_MS), key: KEY });
Object.assign(target, { session, harness });
const paused = await startTriage({ session, harness, app: CUSTOMER }, TICKET);
const [request] = paused.stopReason === "awaiting_approval" ? paused.pending : [];
await answerTriage({ session, harness, app: CUSTOMER }, [
  { requestId: request?.id ?? "", decision: "allow", by: "lead" },
]);
console.log("not reached");
