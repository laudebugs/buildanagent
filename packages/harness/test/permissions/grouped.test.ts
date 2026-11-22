// Grouped approvals: the requests of one step with the same tool and input are answered once.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { createApprovals, runTurn } from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { BACKENDS } from "../session/session-helpers.js";
import { calls, done, entriesOf, open, reuseSetup } from "./reuse-helpers.js";

const groupIds = async (entries: Awaited<ReturnType<typeof entriesOf>>) =>
  entries.flatMap((entry) => (entry.type === "approval_resolved" ? [entry.groupId] : []));

describe.each(BACKENDS)("%s", (_name, make) => {
  test("two grouped write calls with the same input share a group id, and two with different inputs do not", async () => {
    const backend = make();
    const first = reuseSetup([calls("refund", [{ orderId: "o1" }, { orderId: "o1" }, { orderId: "o2" }]), done()]);
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "refund them" });
    const waiting = await createApprovals(first.harness).pending(session);
    assert.equal(waiting.length, 3);
    const resumed = reuseSetup([done()]);
    await createApprovals(resumed.harness).resolve(
      session,
      [{ requestId: waiting[0]?.request.id as string, decision: "allow", by: "ada" }],
      {
        group: true,
      },
    );
    const ids = await groupIds(await entriesOf(backend));
    assert.equal(ids.length, 2, "the answer reached the two requests of its group");
    assert.ok(ids[0] !== undefined && ids[0] === ids[1]);
    assert.deepEqual(resumed.runs, ["refund:o1", "refund:o1"], "both ran once; the other input still waits");
    const left = await createApprovals(resumed.harness).pending(session);
    assert.deepEqual(
      left.map((entry) => entry.request.callId),
      ["c3"],
    );
    await session.close();
  });

  test("a grouped answer to a shell command counts the normalised command, so spacing doesn't split a group", async () => {
    const backend = make();
    const first = reuseSetup([calls("bash", [{ command: "ls  -la" }, { command: "ls -la " }]), done()]);
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "list it twice" });
    const waiting = await createApprovals(first.harness).pending(session);
    const resumed = reuseSetup([done()]);
    await createApprovals(resumed.harness).resolve(
      session,
      [{ requestId: waiting[0]?.request.id as string, decision: "allow" }],
      {
        group: true,
      },
    );
    assert.equal(resumed.runs.length, 2);
    await session.close();
  });

  test("a grouped answer on a tool whose approvalReuse is none or sticky is refused before anything is written", async () => {
    for (const refundReuse of ["none", "sticky"] as const) {
      const backend = make();
      const first = reuseSetup([calls("refund", [{ orderId: "o1" }, { orderId: "o1" }])], { refundReuse });
      const session = await open(backend);
      await runTurn(session, first.harness, { input: "refund them" });
      const waiting = await createApprovals(first.harness).pending(session);
      const before = (await entriesOf(backend)).length;
      await assert.rejects(
        () =>
          createApprovals(first.harness).resolve(
            session,
            [{ requestId: waiting[0]?.request.id as string, decision: "allow" }],
            {
              group: true,
            },
          ),
        (error) => isHarnessError(error) && error.code === "approval_reuse_refused",
        refundReuse,
      );
      assert.equal((await entriesOf(backend)).length, before);
      assert.equal((await createApprovals(first.harness).pending(session)).length, 2, "both still wait");
      await session.close();
    }
  });

  test("shell calls that differ in another field are not one group", async () => {
    const backend = make();
    const first = reuseSetup([
      calls("bash", [
        { command: "rm -rf build", cwd: "/tmp/x" },
        { command: "rm -rf build", cwd: "/" },
      ]),
      done(),
    ]);
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "clean" });
    const waiting = await createApprovals(first.harness).pending(session);
    const resumed = reuseSetup([done()]);
    await createApprovals(resumed.harness).resolve(
      session,
      [{ requestId: waiting[0]?.request.id as string, decision: "allow" }],
      { group: true },
    );
    assert.equal(resumed.runs.length, 1, "only the answered call ran");
    assert.equal((await createApprovals(resumed.harness).pending(session)).length, 1);
    await session.close();
  });

  test("a tool that forbids grouping elsewhere in the step does not refuse an unrelated group", async () => {
    const backend = make();
    const first = reuseSetup(
      [
        {
          content: [
            { type: "tool_call" as const, callId: "c1", name: "refund", input: { orderId: "o1" } },
            { type: "tool_call" as const, callId: "c2", name: "refund", input: { orderId: "o1" } },
            { type: "tool_call" as const, callId: "c3", name: "bash", input: { command: "ls" } },
          ],
        },
        done(),
      ],
      { bashReuse: "none" },
    );
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "do it" });
    const waiting = await createApprovals(first.harness).pending(session);
    const resumed = reuseSetup([done()], { bashReuse: "none" });
    await createApprovals(resumed.harness).resolve(
      session,
      [{ requestId: waiting[0]?.request.id as string, decision: "allow" }],
      { group: true },
    );
    assert.deepEqual(resumed.runs, ["refund:o1", "refund:o1"]);
    await session.close();
  });
});
