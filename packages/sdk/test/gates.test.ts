// beforeToolCall and afterToolCall: the gate's decisions, its failure policy, and the replaced result.
import assert from "node:assert/strict";
import { defineTool, isSdkError, type ToolCallEvent } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun, hookedRun, recorder } from "./hook-helpers.js";
import { text, toolCall } from "./run-helpers.js";
import { textOf } from "./tool-helpers.js";

const CALL = toolCall("lookup", { order: 1 });

function toolMessage(result: { readonly messages: readonly { readonly role: string }[] }) {
  const found = result.messages.find((message) => message.role === "tool");
  return found as { content: { type: "text"; text: string }[]; isError: boolean } | undefined;
}

test("a gate that allows a call lets it run", async () => {
  const lookup = recorder("lookup");
  await drivenRun(
    [CALL, text("Done.")],
    { beforeToolCall: async () => ({ decision: "allow" }) },
    { tools: [lookup.tool] },
  );
  assert.deepEqual(lookup.inputs, [{ order: 1 }]);
});

test("a gate that denies a call blocks it, and the model reads the reason", async () => {
  const lookup = recorder("lookup");
  const { result } = await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async () => ({ decision: "deny", reason: "orders are closed today" }),
    },
    { tools: [lookup.tool] },
  );
  assert.deepEqual(lookup.inputs, []);
  const message = toolMessage(result);
  assert.equal(message?.isError, true);
  assert.match(textOf(message?.content ?? []), /denied: orders are closed today/);
});

test("a gate that allows with a new input runs the call with it", async () => {
  const lookup = recorder("lookup");
  await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async () => ({ decision: "allow", input: { order: 9 } }),
    },
    { tools: [lookup.tool] },
  );
  assert.deepEqual(lookup.inputs, [{ order: 9 }]);
});

test("a replacement input that fails the tool's schema rejects the run with invalid_hook_result", async () => {
  const lookup = recorder("lookup");
  const { started } = hookedRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async () => ({ decision: "allow", input: { order: "nine" } }),
    },
    { tools: [lookup.tool] },
  );
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
  assert.deepEqual(lookup.inputs, []);
});

test("a gate that asks blocks the call with a message that says approval isn't available", async () => {
  const lookup = recorder("lookup");
  const { result } = await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async () => ({ decision: "ask", reason: "refunds need a manager" }),
    },
    { tools: [lookup.tool] },
  );
  assert.deepEqual(lookup.inputs, []);
  assert.match(textOf(toolMessage(result)?.content ?? []), /needs approval \(refunds need a manager\).*can't ask/);
});

test("a gate that returns nothing rejects the run with invalid_hook_result", async () => {
  const lookup = recorder("lookup");
  const { started } = hookedRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: (async () => undefined) as never,
    },
    { tools: [lookup.tool] },
  );
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
});

test("a gate that throws denies the call and emits hook_error", async () => {
  const lookup = recorder("lookup");
  const { events, result } = await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async () => {
        throw new Error("policy service is down");
      },
    },
    { tools: [lookup.tool] },
  );
  assert.deepEqual(lookup.inputs, []);
  assert.equal(toolMessage(result)?.isError, true);
  const failed = events.find((event) => event.type === "hook_error");
  assert.deepEqual(failed?.type === "hook_error" ? [failed.hook, failed.error] : undefined, [
    "beforeToolCall",
    "policy service is down",
  ]);
  assert.equal(result.stopReason, "done");
});

test('a gate that throws with onFailure "continue" lets the call run', async () => {
  const lookup = recorder("lookup");
  await drivenRun(
    [CALL, text("Done.")],
    {
      onFailure: "continue",
      beforeToolCall: async () => {
        throw new Error("policy service is down");
      },
    },
    { tools: [lookup.tool] },
  );
  assert.deepEqual(lookup.inputs, [{ order: 1 }]);
});

test("a gate's event carries the run id, step, call id, signal and a clock timestamp", async () => {
  const seen: ToolCallEvent[] = [];
  const lookup = recorder("lookup");
  await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async (e) => {
        seen.push(e);
        return { decision: "allow" };
      },
    },
    { tools: [lookup.tool] },
  );
  const [event] = seen;
  assert.deepEqual([event?.runId, event?.stepIndex, event?.callId, event?.tool], ["run-1", 0, "call-1", "lookup"]);
  assert.ok(event?.signal instanceof AbortSignal);
  assert.match(event?.timestamp ?? "", /^2026-11-19T12:00:\d\d\.000Z$/);
});

test("a gate that mutates its input throws, and the call is denied", async () => {
  let caught: unknown;
  const lookup = recorder("lookup");
  await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async (e) => {
        try {
          (e.input as { order: number }).order = 99;
        } catch (error) {
          caught = error;
        }
        return { decision: "allow" };
      },
    },
    { tools: [lookup.tool] },
  );
  assert.ok(caught instanceof TypeError);
  assert.deepEqual(lookup.inputs, [{ order: 1 }]);
});

test("afterToolCall's result is the one tool_call_end reports and the model reads", async () => {
  const lookup = recorder("lookup");
  const { events, result } = await drivenRun(
    [CALL, text("Done.")],
    {
      afterToolCall: async () => ({ content: [{ type: "text", text: "Redacted." }] }),
    },
    { tools: [lookup.tool] },
  );
  const ended = events.find((event) => event.type === "tool_call_end");
  assert.deepEqual(ended?.type === "tool_call_end" ? textOf(ended.result.content) : undefined, "Redacted.");
  assert.equal(textOf(toolMessage(result)?.content ?? []), "Redacted.");
});

test("afterToolCall can turn a result into an error", async () => {
  const lookup = recorder("lookup");
  const { result } = await drivenRun(
    [CALL, text("Done.")],
    { afterToolCall: async () => ({ isError: true }) },
    {
      tools: [lookup.tool],
    },
  );
  assert.equal(toolMessage(result)?.isError, true);
});

test("afterToolCall that throws withholds the result and emits hook_error", async () => {
  const lookup = recorder("lookup");
  const { events, result } = await drivenRun(
    [CALL, text("Done.")],
    {
      afterToolCall: async () => {
        throw new Error("redactor crashed");
      },
    },
    { tools: [lookup.tool] },
  );
  assert.match(textOf(toolMessage(result)?.content ?? []), /withheld/);
  assert.doesNotMatch(textOf(toolMessage(result)?.content ?? []), /lookup ran/);
  assert.ok(events.some((event) => event.type === "hook_error" && event.hook === "afterToolCall"));
});

test('afterToolCall that throws with onFailure "continue" keeps the original result', async () => {
  const lookup = recorder("lookup");
  const { result } = await drivenRun(
    [CALL, text("Done.")],
    {
      onFailure: "continue",
      afterToolCall: async () => {
        throw new Error("redactor crashed");
      },
    },
    { tools: [lookup.tool] },
  );
  assert.match(textOf(toolMessage(result)?.content ?? []), /lookup ran/);
});

test("afterToolCall does not run for a call the gate denied", async () => {
  let asked = 0;
  const lookup = recorder("lookup");
  await drivenRun(
    [CALL, text("Done.")],
    {
      beforeToolCall: async () => ({ decision: "deny", reason: "no" }),
      afterToolCall: async () => {
        asked += 1;
      },
    },
    { tools: [lookup.tool] },
  );
  assert.equal(asked, 0);
});

test("afterToolCall runs for a tool that threw, and sees the error result", async () => {
  const seen: boolean[] = [];
  const broken = defineTool({
    name: "lookup",
    description: "Breaks.",
    inputSchema: { type: "object" },
    async execute() {
      throw new Error("backend down");
    },
  });
  await drivenRun(
    [CALL, text("Done.")],
    {
      afterToolCall: async (e) => {
        seen.push(e.result.isError === true);
      },
    },
    { tools: [broken] },
  );
  assert.deepEqual(seen, [true]);
});
