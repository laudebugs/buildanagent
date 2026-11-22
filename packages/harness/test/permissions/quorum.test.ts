// Quorum: a policy decides when a request has enough answers; an approver may not be the requester.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { createApprovals, type QuorumPolicy, quorumOf, runTurn } from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { BACKENDS } from "../session/session-helpers.js";
import { calls, done, entriesOf, open, reuseSetup } from "./reuse-helpers.js";

describe.each(BACKENDS)("%s", (_name, make) => {
  async function paused(backend: ReturnType<typeof make>) {
    const first = reuseSetup([calls("refund", [{ orderId: "o1" }])]);
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "refund o1" });
    const [waiting] = await createApprovals(first.harness).pending(session);
    return { session, id: waiting?.request.id as string };
  }

  test("a quorum of two keeps the call pending after one answer and runs it after a second distinct approver", async () => {
    const backend = make();
    const { session, id } = await paused(backend);
    const second = reuseSetup([done()]);
    const approvals = createApprovals(second.harness, { quorum: quorumOf(2) });
    const one = await approvals.resolve(session, [{ requestId: id, decision: "allow", by: "ada" }]);
    assert.equal(one.stopReason, "awaiting_approval");
    assert.deepEqual(second.runs, [], "one answer is not enough");
    assert.equal((await approvals.pending(session)).length, 1);
    const same = await approvals.resolve(session, [{ requestId: id, decision: "allow", by: "ada" }]);
    assert.equal(same.stopReason, "awaiting_approval", "the same approver twice is still one");
    const two = await approvals.resolve(session, [{ requestId: id, decision: "allow", by: "grace" }]);
    assert.equal(two.stopReason, "done");
    assert.deepEqual(second.runs, ["refund:o1"], "the call ran once");
    await session.close();
  });

  test("an approver equal to the requester is rejected before anything is written", async () => {
    const backend = make();
    const { session, id } = await paused(backend);
    const before = (await entriesOf(backend)).length;
    const approvals = createApprovals(reuseSetup([done()]).harness);
    await assert.rejects(
      () => approvals.resolve(session, [{ requestId: id, decision: "allow", by: "ada" }], { requesterId: "ada" }),
      (error) => isHarnessError(error) && error.code === "approver_is_requester",
    );
    assert.equal((await entriesOf(backend)).length, before);
    await session.close();
  });

  test("a deny from any approver refuses the call under the default policy", async () => {
    const backend = make();
    const { session, id } = await paused(backend);
    const second = reuseSetup([done()]);
    const result = await createApprovals(second.harness).resolve(session, [
      { requestId: id, decision: "deny", by: "ada" },
    ]);
    assert.equal(result.stopReason, "done");
    assert.deepEqual(second.runs, []);
    const refused = (await entriesOf(backend)).find((entry) => entry.type === "tool_result");
    assert.ok(refused?.type === "tool_result" && refused.isError);
    await session.close();
  });

  test("a custom policy that returns expired turns the pending call into a denial result", async () => {
    const backend = make();
    const { session } = await paused(backend);
    const expiring: QuorumPolicy = { evaluate: () => "expired" };
    const second = reuseSetup([done()]);
    // No answer is needed: asking the policy about every waiting request is how an old request is refused.
    const result = await createApprovals(second.harness, { quorum: expiring }).resolve(session, []);
    assert.equal(result.stopReason, "done");
    assert.deepEqual(second.runs, []);
    const refused = (await entriesOf(backend)).find((entry) => entry.type === "tool_result");
    assert.ok(refused?.type === "tool_result" && refused.isError);
    assert.match(JSON.stringify(refused.content), /expired/);
    await session.close();
  });
});
