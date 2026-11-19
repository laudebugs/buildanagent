// composeInterceptors: the order hooks run in, and how their answers combine.
import assert from "node:assert/strict";
import type { Message } from "@buildanagent/gateway";
import { composeInterceptors, type GateDecision, isSdkError, type ToolCallEvent } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun, hookedRun, lastText, recorder, sentTools } from "./hook-helpers.js";
import { lookup, text, toolCall } from "./run-helpers.js";
import { textOf } from "./tool-helpers.js";

const CALL = toolCall("lookup", { order: 1 });

function user(value: string): Message {
  return { role: "user", content: [{ type: "text", text: value }] };
}

test("transformContext hooks pass the messages through in the order given", async () => {
  const composed = composeInterceptors(
    { transformContext: async (e) => [...e.messages, user("first")] },
    { transformContext: async (e) => [...e.messages, user(`second saw ${e.messages.length}`)] },
  );
  const { adapter } = await drivenRun([text("Done.")], composed);
  assert.equal(lastText(adapter.calls[0]?.context.messages ?? []), "second saw 2");
});

test("beforeModelCall patches merge, a later field replacing an earlier one", async () => {
  const composed = composeInterceptors(
    { beforeModelCall: async () => ({ system: "one", options: { maxOutputTokens: 10 } }) },
    { beforeModelCall: async () => ({ system: "two" }) },
  );
  const { adapter } = await drivenRun([text("Done.")], composed);
  assert.equal(adapter.calls[0]?.context.system, "two");
  assert.equal(adapter.calls[0]?.options.maxOutputTokens, 10);
});

test("a later beforeModelCall sees the system prompt an earlier one set", async () => {
  const seen: string[] = [];
  const composed = composeInterceptors(
    { beforeModelCall: async () => ({ system: "one" }) },
    {
      beforeModelCall: async (e) => {
        seen.push(e.context.system);
      },
    },
  );
  await drivenRun([text("Done.")], composed);
  assert.deepEqual(seen, ["one"]);
});

test("a deny from any gate blocks the call, and a gate after it is not asked", async () => {
  const asked: string[] = [];
  const lookupTool = recorder("lookup");
  const composed = composeInterceptors(
    { beforeToolCall: async () => ({ decision: "deny", reason: "first says no" }) },
    {
      beforeToolCall: async () => {
        asked.push("second");
        return { decision: "allow" };
      },
    },
  );
  await drivenRun([CALL, text("Done.")], composed, { tools: [lookupTool.tool] });
  assert.deepEqual(lookupTool.inputs, []);
  assert.deepEqual(asked, []);
});

test("an ask beats an allow, and a later deny beats an earlier ask", async () => {
  const lookupTool = recorder("lookup");
  const composed = composeInterceptors(
    { beforeToolCall: async () => ({ decision: "ask", reason: "check" }) },
    { beforeToolCall: async () => ({ decision: "deny", reason: "no" }) },
  );
  const { result } = await drivenRun([CALL, text("Done.")], composed, { tools: [lookupTool.tool] });
  const message = result.messages.find((m) => m.role === "tool");
  assert.match(textOf(message?.role === "tool" ? message.content : []), /denied: no/);
});

test("an input one gate replaces is the input the next gate sees and the tool receives", async () => {
  const seen: ToolCallEvent[] = [];
  const lookupTool = recorder("lookup");
  const composed = composeInterceptors(
    { beforeToolCall: async () => ({ decision: "allow", input: { order: 7 } }) },
    {
      beforeToolCall: async (e) => {
        seen.push(e);
        return { decision: "allow" };
      },
    },
  );
  await drivenRun([CALL, text("Done.")], composed, { tools: [lookupTool.tool] });
  assert.deepEqual(seen[0]?.input, { order: 7 });
  assert.deepEqual(lookupTool.inputs, [{ order: 7 }]);
});

test("afterToolCall patches apply in order, each hook seeing the result so far", async () => {
  const lookupTool = recorder("lookup");
  const composed = composeInterceptors(
    { afterToolCall: async () => ({ content: [{ type: "text", text: "one" }] }) },
    { afterToolCall: async (e) => ({ content: [{ type: "text", text: `${textOf(e.result.content)} two` }] }) },
  );
  const { result } = await drivenRun([CALL, text("Done.")], composed, { tools: [lookupTool.tool] });
  const message = result.messages.find((m) => m.role === "tool");
  assert.equal(textOf(message?.role === "tool" ? message.content : []), "one two");
});

test("the first stop from shouldStop wins over a continue before it", async () => {
  const composed = composeInterceptors(
    { shouldStop: async () => ({ continue: "More." }) },
    { shouldStop: async () => ({ stop: "hook", reason: "enough" }) },
  );
  const { result } = await drivenRun([CALL, text("Never.")], composed, { tools: [lookup] });
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "enough");
});

test("afterModelCall hooks each see the message the one before returned", async () => {
  const lookupTool = recorder("lookup");
  const seen: unknown[] = [];
  const composed = composeInterceptors(
    {
      afterModelCall: async (e) => ({
        message: {
          ...e.message,
          content: [{ type: "tool_call", callId: "call-1", name: "lookup", input: { order: 3 } }],
        },
      }),
    },
    {
      afterModelCall: async (e) => {
        seen.push(e.message.content[0]);
      },
    },
  );
  await drivenRun([text("Done.")], composed, { tools: [lookupTool.tool] });
  assert.deepEqual(seen[0], { type: "tool_call", callId: "call-1", name: "lookup", input: { order: 3 } });
});

test("the joined onFailure is continue only when every object that sets it says so", async () => {
  assert.equal(composeInterceptors({ onFailure: "continue" }, {}).onFailure, "fail_closed");
  assert.equal(composeInterceptors({ onFailure: "continue" }, { onFailure: "continue" }).onFailure, "continue");
});

test("a composed object defines only the moments some object defines", () => {
  const composed = composeInterceptors({ shouldStop: async () => false }, {});
  assert.deepEqual(Object.keys(composed).sort(), ["onFailure", "shouldStop"]);
});

test("a composed activeTools still sends tools in definition order", async () => {
  const search = recorder("search_orders", "deferred");
  const composed = composeInterceptors({ beforeModelCall: async () => ({ activeTools: ["search_orders", "lookup"] }) });
  const { adapter } = await drivenRun([text("Done.")], composed, { tools: [lookup, search.tool] });
  assert.deepEqual(sentTools(adapter.calls[0] ?? { context: { tools: [] } }), ["lookup", "search_orders"]);
});

// A joined gate that skipped a member's bad answer would let a forgotten return pass for permission.
for (const [label, bad] of [
  ["nothing", undefined],
  ["a misspelt decision", { decision: "Deny", reason: "no" }],
] as const) {
  for (const onFailure of ["fail_closed", "continue"] as const) {
    test(`a joined gate that returns ${label} rejects the run, even beside an allow, with onFailure ${onFailure}`, async () => {
      const lookupTool = recorder("lookup");
      const composed = composeInterceptors(
        { beforeToolCall: async () => ({ decision: "allow" }), onFailure },
        { beforeToolCall: (async () => bad) as unknown as () => Promise<GateDecision>, onFailure },
      );
      const { started } = hookedRun([CALL, text("Done.")], composed, { tools: [lookupTool.tool] });
      await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
      assert.deepEqual(lookupTool.inputs, []);
    });
  }
}

test("a joined hook checks every member's return, so a bad transformContext between good ones is loud", async () => {
  const composed = composeInterceptors(
    { transformContext: (async () => "no") as never, onFailure: "continue" },
    { transformContext: async () => [user("fine")], onFailure: "continue" },
  );
  const { started } = hookedRun([text("Done.")], composed);
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
});

test("a beforeModelCall field set to undefined keeps the value an earlier hook set", async () => {
  const seen: (string | undefined)[] = [];
  const composed = composeInterceptors(
    { beforeModelCall: async () => ({ system: "S", options: { maxOutputTokens: 7 } }) },
    {
      beforeModelCall: async (e) => {
        seen.push(e.context.system, String(e.options.maxOutputTokens));
        return { system: undefined, messages: [user("only this")] } as never;
      },
    },
  );
  const { adapter } = await drivenRun([text("Done.")], composed);
  assert.deepEqual(seen, ["S", "7"]);
  assert.equal(adapter.calls[0]?.context.system, "S");
  assert.equal(adapter.calls[0]?.options.maxOutputTokens, 7);
  assert.equal(lastText(adapter.calls[0]?.context.messages ?? []), "only this");
});

test("an afterToolCall field set to undefined keeps the content an earlier hook set", async () => {
  const lookupTool = recorder("lookup");
  const composed = composeInterceptors(
    { afterToolCall: async () => ({ content: [{ type: "text", text: "redacted" }] }) },
    { afterToolCall: async () => ({ content: undefined, details: { audited: true } }) as never },
  );
  const { events } = await drivenRun([CALL, text("Done.")], composed, { tools: [lookupTool.tool] });
  const end = events.find((event) => event.type === "tool_call_end");
  assert.deepEqual(end?.type === "tool_call_end" ? [textOf(end.result.content), end.result.details] : undefined, [
    "redacted",
    { audited: true },
  ]);
});
