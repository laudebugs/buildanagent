// The interceptors at the model moments and at the stop check: each changes the run's outcome through its return value.
import assert from "node:assert/strict";
import type { Message, ModelRef, Usage } from "@buildanagent/gateway";
import { type ContextEvent, isSdkError } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun, hookedRun, lastText, recorder, SYSTEM, sentTools, withInput } from "./hook-helpers.js";
import { lookup, scripted, text, toolCall, typesOf } from "./run-helpers.js";

const REF: ModelRef = { api: "scripted", provider: "scripted", id: "scripted-model" };

test("a masked view from transformContext reaches that call's request only", async () => {
  const { adapter, result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    {
      transformContext: async (e) => e.messages.slice(-1),
    },
    { tools: [lookup] },
  );
  assert.deepEqual(
    adapter.calls.map((call) => call.context.messages.length),
    [1, 1],
  );
  assert.equal(result.messages.length, 4);
  assert.equal(result.context.messages.length, 4);
});

test("the next call's context event holds the full history, not the earlier call's view", async () => {
  const lengths: number[] = [];
  await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    {
      transformContext: async (e) => {
        lengths.push(e.messages.length);
        return e.messages.slice(-1);
      },
    },
    { tools: [lookup] },
  );
  assert.deepEqual(lengths, [1, 3]);
});

test("a context event carries the system prompt, the messages and the model, and the previous call's usage", async () => {
  const events: ContextEvent[] = [];
  await drivenRun(
    [{ ...toolCall("lookup", { order: 1 }), usage: { uncachedInput: 7, output: 3 } }, text("Done.")],
    {
      transformContext: async (e) => {
        events.push(e);
        return e.messages;
      },
    },
    { tools: [lookup] },
  );
  assert.equal(events[0]?.system, SYSTEM);
  assert.deepEqual(events[0]?.model, REF);
  assert.equal(events[0]?.lastUsage, undefined);
  const lastUsage: Usage | undefined = events[1]?.lastUsage;
  assert.deepEqual([lastUsage?.uncachedInput, lastUsage?.output], [7, 3]);
});

test("each transformed call emits context_transformed with the message counts", async () => {
  const { events } = await drivenRun([text("Done.")], { transformContext: async () => [] });
  const found = events.find((event) => event.type === "context_transformed");
  assert.deepEqual(found?.type === "context_transformed" ? [found.before, found.after] : undefined, [1, 0]);
});

test("beforeModelCall changes this call's system prompt and messages and leaves the transcript alone", async () => {
  const replacement: Message[] = [{ role: "user", content: [{ type: "text", text: "Rewritten." }] }];
  const { adapter, result } = await drivenRun([text("Done.")], {
    beforeModelCall: async () => ({ system: "Patched.", messages: replacement }),
  });
  assert.equal(adapter.calls[0]?.context.system, "Patched.");
  assert.equal(lastText(adapter.calls[0]?.context.messages ?? []), "Rewritten.");
  assert.equal(result.context.system, SYSTEM);
  assert.equal(lastText(result.context.messages.slice(0, 1)), "Go.");
});

test("beforeModelCall replaces the options of this call", async () => {
  const { adapter } = await drivenRun([text("Done.")], {
    beforeModelCall: async () => ({ options: { maxOutputTokens: 55 } }),
  });
  assert.equal(adapter.calls[0]?.options.maxOutputTokens, 55);
});

test("a deferred tool that activeTools names is sent with the next request only", async () => {
  const search = recorder("search_orders", "deferred");
  const { adapter } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    {
      beforeModelCall: async (e) => (e.stepIndex === 0 ? { activeTools: ["lookup", "search_orders"] } : undefined),
    },
    { tools: [lookup, search.tool] },
  );
  assert.deepEqual(adapter.calls.map(sentTools), [["lookup", "search_orders"], ["lookup"]]);
});

test("a reordered activeTools list still sends tools in definition order", async () => {
  const search = recorder("search_orders", "deferred");
  const { adapter } = await drivenRun(
    [text("Done.")],
    {
      beforeModelCall: async () => ({ activeTools: ["search_orders", "lookup"] }),
    },
    { tools: [lookup, search.tool] },
  );
  assert.deepEqual(sentTools(adapter.calls[0] ?? { context: { tools: [] } }), ["lookup", "search_orders"]);
});

test("a call to a deferred tool that this request sent runs", async () => {
  const search = recorder("search_orders", "deferred");
  await drivenRun(
    [toolCall("search_orders", { order: 5 }), text("Done.")],
    {
      beforeModelCall: async (e) => (e.stepIndex === 0 ? { activeTools: ["search_orders"] } : undefined),
    },
    { tools: [search.tool] },
  );
  assert.deepEqual(search.inputs, [{ order: 5 }]);
});

test("a call to a deferred tool that no request activated gets the unknown-tool error", async () => {
  const search = recorder("search_orders", "deferred");
  const { result } = await drivenRun(
    [toolCall("search_orders", { order: 5 }), text("Done.")],
    {},
    {
      tools: [search.tool],
    },
  );
  assert.deepEqual(search.inputs, []);
  assert.equal(result.messages.find((message) => message.role === "tool")?.isError, true);
});

test("activeTools that names no tool rejects the run with invalid_hook_result", async () => {
  const { started } = hookedRun([text("Done.")], { beforeModelCall: async () => ({ activeTools: ["missing"] }) });
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
});

test("beforeModelCall can send the call to another model", async () => {
  const other = scripted([text("From the other model.")]);
  const { adapter, result } = await drivenRun([text("Never used.")], {
    beforeModelCall: async () => ({ model: other.model }),
  });
  assert.equal(adapter.calls.length, 0);
  assert.equal(other.adapter.calls.length, 1);
  assert.equal(result.stopReason, "done");
});

test("afterModelCall's replacement is what the transcript holds and what the run executes", async () => {
  const recorded = recorder("lookup");
  const { events, result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    {
      afterModelCall: async (e) => (e.stepIndex === 0 ? { message: withInput(e.message, { order: 2 }) } : undefined),
    },
    { tools: [recorded.tool] },
  );
  assert.deepEqual(recorded.inputs, [{ order: 2 }]);
  const ended = events.find((event) => event.type === "model_call_end");
  assert.deepEqual(ended?.type === "model_call_end" ? ended.message : undefined, result.messages[1]);
});

test("shouldStop returning true ends the run stopped by hook, and the step's tool results are kept", async () => {
  const { result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Never.")],
    { shouldStop: async () => true },
    {
      tools: [lookup],
    },
  );
  assert.equal(result.stopReason, "stopped");
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "hook");
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["user", "assistant", "tool"],
  );
});

test('shouldStop returning { stop: "hook", reason } ends the run stopped by that reason', async () => {
  const { result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Never.")],
    {
      shouldStop: async () => ({ stop: "hook", reason: "r" }),
    },
    { tools: [lookup] },
  );
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "r");
});

test('shouldStop returning { stop: "no_progress", reason } ends the run no_progress', async () => {
  const { result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Never.")],
    {
      shouldStop: async () => ({ stop: "no_progress", reason: "same call twice" }),
    },
    { tools: [lookup] },
  );
  assert.equal(result.stopReason, "no_progress");
  assert.equal(result.stopReason === "no_progress" ? result.reason : undefined, "same call twice");
});

test("a stop request ends a step_end with stopCheck stop", async () => {
  const { events } = await drivenRun(
    [toolCall("lookup", { order: 1 })],
    { shouldStop: async () => true },
    {
      tools: [lookup],
    },
  );
  const ended = events.find((event) => event.type === "step_end");
  assert.equal(ended?.type === "step_end" ? ended.stopCheck : undefined, "stop");
});

test("shouldStop cannot end a run whose model has already answered", async () => {
  const { result } = await drivenRun([text("Done.")], { shouldStop: async () => true });
  assert.equal(result.stopReason, "done");
});

test("shouldStop's continue keeps a run going with the content as a user message", async () => {
  const { adapter, result } = await drivenRun([text("First."), text("Second.")], {
    shouldStop: async (e) =>
      e.lastMessage.content[0]?.type === "text" && e.lastMessage.content[0].text === "First."
        ? { continue: "Check again." }
        : false,
  });
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 2);
  assert.equal(lastText(adapter.calls[1]?.context.messages ?? []), "Check again.");
});

test("a continue after a step that called tools is not added, because the run goes on anyway", async () => {
  const { adapter, result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    { shouldStop: async (e) => (e.lastMessage.stopReason === "tool_calls" ? { continue: "Check again." } : false) },
    { tools: [lookup] },
  );
  assert.equal(result.stopReason, "done");
  const sent = JSON.stringify(adapter.calls[1]?.context.messages ?? []);
  assert.equal(sent.includes("Check again."), false);
});

test("a continue at the step cap ends the run max_steps", async () => {
  const { result } = await drivenRun(
    [text("First.")],
    { shouldStop: async () => ({ continue: "More." }) },
    { maxSteps: 1 },
  );
  assert.equal(result.stopReason, "max_steps");
});

test("a continue whose blocks aren't text or image rejects the run with invalid_hook_result", async () => {
  const { started } = hookedRun([text("First."), text("Second.")], {
    shouldStop: (async () => ({ continue: [{ text: "go on" }] })) as never,
  });
  await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
});

test("context_transformed comes after step_start and before model_call_start", async () => {
  const { events } = await drivenRun([text("Done.")], { transformContext: async (e) => e.messages });
  assert.deepEqual(typesOf(events).slice(0, 4), ["run_start", "step_start", "context_transformed", "model_call_start"]);
});
