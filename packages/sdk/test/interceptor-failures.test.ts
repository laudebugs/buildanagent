// What a throwing interceptor does: fail closed by default, skip the hook with onFailure "continue", and read-only inputs.
import assert from "node:assert/strict";
import type { Interceptors } from "@buildanagent/sdk";
import { defineTool } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun, hookedRun, recorder } from "./hook-helpers.js";
import { lookup, text, toolCall, typesOf } from "./run-helpers.js";

function boom(): never {
  throw new Error("boom");
}

// Each hook that is not a gate, with a script whose run reaches it.
const HOOKS: [keyof Interceptors, Interceptors][] = [
  ["transformContext", { transformContext: boom }],
  ["beforeModelCall", { beforeModelCall: boom }],
  ["afterModelCall", { afterModelCall: boom }],
  ["shouldStop", { shouldStop: boom }],
];

for (const [name, interceptors] of HOOKS) {
  test(`a ${name} that throws ends the run with an error result of kind hook`, async () => {
    const { events, result } = await drivenRun([toolCall("lookup", { order: 1 }), text("Done.")], interceptors, {
      tools: [lookup],
    });
    assert.equal(result.stopReason, "error");
    assert.deepEqual(result.stopReason === "error" ? result.error.kind : undefined, "hook");
    assert.match(result.stopReason === "error" ? result.error.message : "", new RegExp(`${name} hook failed: boom`));
    assert.ok(events.some((event) => event.type === "hook_error" && event.hook === name));
  });

  test(`a ${name} that throws with onFailure "continue" is skipped and the run ends done`, async () => {
    const { events, result } = await drivenRun(
      [toolCall("lookup", { order: 1 }), text("Done.")],
      { ...interceptors, onFailure: "continue" },
      { tools: [lookup] },
    );
    assert.equal(result.stopReason, "done");
    assert.ok(events.some((event) => event.type === "hook_error" && event.hook === name));
  });
}

test("a hook that mutates its event fails closed, because the event's data is frozen", async () => {
  const { result } = await drivenRun([text("Done.")], {
    transformContext: async (e) => {
      (e.messages as unknown[]).push("extra");
      return e.messages;
    },
  });
  assert.equal(result.stopReason, "error");
  assert.match(result.stopReason === "error" ? result.error.message : "", /not extensible/);
});

test("a hook that mutates a message inside its event throws as well", async () => {
  let caught: unknown;
  await drivenRun([text("Done.")], {
    transformContext: async (e) => {
      try {
        (e.messages[0] as { content: unknown[] }).content.push("extra");
      } catch (error) {
        caught = error;
      }
      return e.messages;
    },
  });
  assert.ok(caught instanceof TypeError);
});

test("a hook that fails because the run was aborted ends the run aborted, not in error", async () => {
  const controller = new AbortController();
  const { result } = await drivenRun(
    [text("Done.")],
    {
      beforeModelCall: async () => {
        controller.abort();
        throw new Error("cancelled");
      },
    },
    { signal: controller.signal },
  );
  assert.equal(result.stopReason, "aborted");
});

test("a failed hook's run still ends with agent_settled before run_end", async () => {
  const { events } = await drivenRun([text("Done.")], { beforeModelCall: boom });
  assert.deepEqual(
    events.slice(-2).map((event) => event.type),
    ["agent_settled", "run_end"],
  );
});

test("a hook that returns the wrong shape rejects the run, whatever onFailure says", async () => {
  const { hookedRun } = await import("./hook-helpers.js");
  const { started } = hookedRun([text("Done.")], {
    onFailure: "continue",
    transformContext: (async () => "no") as never,
  });
  await assert.rejects(started.result, { code: "invalid_hook_result" });
});

test("a failed afterModelCall records a withheld stand-in, so the billed call stays on record and nothing runs", async () => {
  const tool = recorder("lookup");
  const { events, result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    { afterModelCall: boom },
    {
      tools: [tool.tool],
    },
  );
  assert.equal(result.stopReason, "error");
  assert.deepEqual(tool.inputs, []);
  const types = typesOf(events);
  assert.ok(types.indexOf("model_call_end") > types.indexOf("hook_error"));
  const end = events.find((event) => event.type === "model_call_end");
  const recorded = result.messages.at(-1);
  assert.deepEqual(end?.type === "model_call_end" ? end.message : undefined, recorded);
  assert.deepEqual(recorded?.role === "assistant" ? [recorded.content, recorded.stopReason] : undefined, [[], "error"]);
  assert.equal(result.steps, 1);
  assert.deepEqual(recorded?.role === "assistant" ? recorded.usage : undefined, result.usage);
});

test("a failed afterToolCall under fail_closed says the tool ran and keeps a write's outcome", async () => {
  const write = defineTool({
    name: "edit",
    description: "Edits a file.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      return {
        content: [{ type: "text", text: "ok" }],
        outcome: { kind: "applied", operation: "edit_file", next: "Tell the user" },
      };
    },
  } as never);
  const { events } = await drivenRun(
    [toolCall("edit", {}), text("Done.")],
    { afterToolCall: boom },
    { tools: [write] },
  );
  const end = events.find((event) => event.type === "tool_call_end");
  const result = end?.type === "tool_call_end" ? end.result : undefined;
  assert.equal(result?.isError, true);
  assert.match(result?.content[0]?.type === "text" ? result.content[0].text : "", /ran, but its result was withheld/);
  assert.equal(result?.outcome?.kind, "applied");
});

test("a replacement input from a gate is writable, so a tool that edits its input doesn't throw", async () => {
  const seen: unknown[] = [];
  const editing = defineTool({
    name: "lookup",
    description: "Looks up.",
    inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
    async execute(input: { order: number }) {
      input.order += 1;
      seen.push(input.order);
      return { content: [{ type: "text", text: "ok" }] };
    },
  } as never);
  const { result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    { beforeToolCall: async (e) => ({ decision: "allow", input: e.input }) },
    { tools: [editing] },
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(seen, [2]);
});

test("an afterToolCall patch with a non-boolean isError or terminate throws invalid_hook_result", async () => {
  for (const patch of [{ isError: "no" }, { terminate: 1 }]) {
    const { started } = hookedRun(
      [toolCall("lookup", { order: 1 }), text("Done.")],
      {
        afterToolCall: async () => patch as never,
      },
      { tools: [lookup] },
    );
    await assert.rejects(started.result, { code: "invalid_hook_result" });
  }
});

test("an afterModelCall that returns a wrong shape still records the billed call before the run rejects", async () => {
  const { started } = hookedRun(
    [text("Done.")],
    {
      afterModelCall: async () => ({ message: "text" }) as never,
    },
    { observers: [(event) => void seen.push(event.type)] },
  );
  const seen: string[] = [];
  await assert.rejects(started.result, { code: "invalid_hook_result" });
  assert.ok(seen.includes("model_call_end"));
});
