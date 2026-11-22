// Reconnecting over WebSockets: the transport serves one socket, so a client that drops comes back on a new socket,
// which the host serves with a new webSocketTransport() call on the same dispatcher, and sends session/open with
// fromSeq. The turn runs on meanwhile; the new socket gets the entries it missed, then the live ones and turn/settled.
import assert from "node:assert/strict";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { describe, test } from "vitest";
import { approvalSetup, callTool, entrySeqs, gate, reply, settledMessages, until } from "./server-helpers.js";
import { initParams, wsRun } from "./websocket-helpers.js";

/** A tool whose calls each wait for their own gate, so the test decides when the turn moves on. */
function heldTool(gates: readonly { promise: Promise<void> }[]): {
  tool: ToolDefinition<unknown, unknown, unknown>;
  calls: () => number;
} {
  let calls = 0;
  const tool = defineTool({
    name: "wait",
    description: "Waits for the test.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      const held = gates[calls];
      calls += 1;
      await held?.promise;
      return { content: [{ type: "text", text: "waited" }] };
    },
  }) as ToolDefinition<unknown, unknown, unknown>;
  return { tool, calls: () => calls };
}

const contiguous = (seqs: readonly number[]) => seqs.every((seq, i) => i === 0 || seq === (seqs[i - 1] as number) + 1);

describe("a client that drops mid-turn and reconnects on a new socket", () => {
  test("gets the entries it missed with fromSeq, then the live ones and turn/settled, with none lost or repeated", async () => {
    const first = gate();
    const second = gate();
    const held = heldTool([first, second]);
    const steps = [
      { content: [callTool("c1", "wait", {})] },
      { content: [callTool("c2", "wait", {})] },
      reply("All done."),
    ];
    const { dispatcher } = approvalSetup(steps, [{ name: "wait", source: "builtin", definition: held.tool }]);

    const before = wsRun(dispatcher);
    await before.request(1, "initialize", initParams);
    await before.request(2, "session/create", { session: "s1", cwd: "/w" });
    await before.request(3, "turn/start", { session: "s1", input: [{ type: "text", text: "go" }] });
    await until(() => held.calls() === 1, "the first tool call");
    await until(() => entrySeqs(before.messages(), "s1").length > 0, "an entry");
    // The network drops: the first socket fails, and its transport stops and closes its connection.
    before.client.fail();
    await before.done;
    const had = entrySeqs(before.messages(), "s1");

    // The turn goes on with nobody connected, and writes entries the client never sees.
    first.open();
    await until(() => held.calls() === 2, "the second tool call");

    const after = wsRun(dispatcher);
    await after.request(1, "initialize", initParams);
    const fromSeq = (had.at(-1) as number) + 1;
    const opened = await after.request(2, "session/open", { session: "s1", cwd: "/w", fromSeq });
    assert.ok("result" in opened);
    await until(() => entrySeqs(after.messages(), "s1").length > 0, "the replay");
    const replayed = entrySeqs(after.messages(), "s1");
    assert.equal(replayed[0], fromSeq);
    assert.ok(replayed.length >= 2, `replayed ${replayed.join(",")}`);

    second.open();
    await until(() => settledMessages(after.messages()).length === 1, "turn/settled on the new socket");
    assert.equal(settledMessages(after.messages())[0]?.result.stopReason, "done");
    // The two sockets together saw every entry once, in order.
    const all = [...had, ...entrySeqs(after.messages(), "s1")];
    assert.equal(all[0], 0);
    assert.ok(contiguous(all), all.join(","));
    assert.deepEqual(settledMessages(before.messages()), []);
    after.client.close(1000);
    await after.done;
  });
});
