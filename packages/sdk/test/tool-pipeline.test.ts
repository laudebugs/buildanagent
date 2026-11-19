import assert from "node:assert/strict";
import { defineTool, isSdkError, type ToolDefinition } from "@buildanagent/sdk";
import { test } from "vitest";
import { z } from "zod";
import { DO_NOT_SUBSTITUTE, REDACTED_MESSAGE } from "../src/tools/format-error.js";
import { type AnyTool, runToolCall, runToolCalls } from "../src/tools/pipeline.js";
import { assistant, call, pipelineContext, textOf } from "./tool-helpers.js";

const ORDER_SCHEMA = {
  type: "object",
  properties: { order: { type: "integer" }, note: { type: "string" } },
  required: ["order"],
  additionalProperties: false,
} as const;

// A read-only lookup: it records the inputs it receives and touches nothing outside the test.
function lookupOrder(seen: unknown[] = [], overrides: Partial<ToolDefinition<{ order: number }>> = {}): AnyTool {
  return defineTool<{ order: number }>({
    name: "lookup_order",
    description: "Look up an order by its number.",
    inputSchema: ORDER_SCHEMA,
    async execute(input) {
      seen.push(input);
      return { content: [{ type: "text", text: `Order ${input.order} is shipped.` }] };
    },
    ...overrides,
  });
}

function failing(message: string, overrides: Partial<ToolDefinition<{ order: number }>> = {}): AnyTool {
  return lookupOrder([], {
    async execute() {
      throw new Error(message);
    },
    ...overrides,
  });
}

test("an unknown tool name returns an error result that lists the available tools", async () => {
  const result = await runToolCall(call("lookup_ordr", { order: 1 }), [lookupOrder()], pipelineContext());
  assert.equal(result.isError, true);
  assert.match(
    textOf(result.content),
    /There is no tool named "lookup_ordr"\. The available tools are: lookup_order\./,
  );
});

test("invalid input lists each failing JSON Pointer path and the received arguments", async () => {
  const seen: unknown[] = [];
  const input = { order: "first", extra: true };
  const result = await runToolCall(call("lookup_order", input), [lookupOrder(seen)], pipelineContext());
  const text = textOf(result.content);
  assert.equal(result.isError, true);
  assert.match(text, /^- \/order: /m);
  assert.match(text, /^- \/extra: /m);
  assert.ok(text.includes(`Received arguments: ${JSON.stringify(input)}`), text);
  assert.deepEqual(seen, []);
});

test("an input issue at the root is shown as the whole input", async () => {
  const result = await runToolCall(call("lookup_order", ["not", "an", "object"]), [lookupOrder()], pipelineContext());
  assert.match(textOf(result.content), /^- \(the whole input\): /m);
});

test("every default error message ends with the do-not-substitute line", async () => {
  const tools = [lookupOrder(), failing("database offline", { name: "fetch_order" })];
  const results = [
    await runToolCall(call("nope", {}), tools, pipelineContext()),
    await runToolCall(call("lookup_order", {}), tools, pipelineContext()),
    await runToolCall(call("fetch_order", { order: 1 }), tools, pipelineContext()),
  ];
  for (const result of results) assert.ok(textOf(result.content).endsWith(DO_NOT_SUBSTITUTE));
});

test("a formatError on the tool replaces the default error text", async () => {
  const tool = lookupOrder([], { formatError: (failure) => [{ type: "text", text: `custom ${failure.kind}` }] });
  const result = await runToolCall(call("lookup_order", {}), [tool], pipelineContext());
  assert.deepEqual(result.content, [{ type: "text", text: "custom invalid_input" }]);
  assert.equal(result.isError, true);
});

test("a formatError that throws falls back to the default text and keeps its error in details", async () => {
  const tool = lookupOrder([], {
    formatError: () => {
      throw new Error("formatter bug");
    },
  });
  const result = await runToolCall(call("lookup_order", {}), [tool], pipelineContext());
  assert.ok(textOf(result.content).endsWith(DO_NOT_SUBSTITUTE));
  assert.equal((result.details as { formatterError?: string }).formatterError, "formatter bug");
});

test("a throwing execute returns an error result with its message", async () => {
  const result = await runToolCall(
    call("lookup_order", { order: 7 }),
    [failing("database offline")],
    pipelineContext(),
  );
  assert.equal(result.isError, true);
  assert.match(textOf(result.content), /Tool "lookup_order" failed: database offline/);
});

test("with redactErrors, a thrown message is absent from the model's content and present in details", async () => {
  const secret = "connection to db.internal:5432 refused for user admin";
  const tool = failing(secret, { redactErrors: true });
  const result = await runToolCall(call("lookup_order", { order: 7 }), [tool], pipelineContext());
  assert.equal(result.isError, true);
  assert.ok(!textOf(result.content).includes(secret));
  assert.ok(textOf(result.content).includes(REDACTED_MESSAGE));
  assert.ok(JSON.stringify(result.details).includes(secret));
});

test("with redactErrors, formatError receives the fixed line instead of the thrown message", async () => {
  const messages: string[] = [];
  const tool = failing("secret detail", {
    redactErrors: true,
    formatError: (failure) => {
      if (failure.kind === "execution_error") messages.push(failure.message);
      return [{ type: "text", text: "failed" }];
    },
  });
  await runToolCall(call("lookup_order", { order: 7 }), [tool], pipelineContext());
  assert.deepEqual(messages, [REDACTED_MESSAGE]);
});

test("a repair that returns fixed input runs execute with it", async () => {
  const seen: unknown[] = [];
  const tool = lookupOrder(seen, { repair: async () => ({ order: 42 }) });
  const result = await runToolCall(call("lookup_order", { order_id: 42 }), [tool], pipelineContext());
  assert.equal(result.isError, undefined);
  assert.deepEqual(seen, [{ order: 42 }]);
});

test("repair receives the coerced input and the issues", async () => {
  const received: unknown[] = [];
  const tool = lookupOrder([], {
    repair: async (e) => {
      received.push(e);
      return undefined;
    },
  });
  await runToolCall(call("lookup_order", { order: "5", extra: 1 }), [tool], pipelineContext());
  const [repairInput] = received as { input: unknown; issues: { path: string }[] }[];
  assert.deepEqual(repairInput?.input, { order: 5, extra: 1 });
  assert.deepEqual(
    repairInput?.issues.map((issue) => issue.path),
    ["/extra"],
  );
});

test("a repair that returns undefined reports the original issues", async () => {
  const tool = lookupOrder([], { repair: async () => undefined });
  const result = await runToolCall(call("lookup_order", { order: "x" }), [tool], pipelineContext());
  assert.equal(result.isError, true);
  assert.match(textOf(result.content), /^- \/order: /m);
});

test("a repair whose fix still fails runs nothing and reports the model's own arguments", async () => {
  const seen: unknown[] = [];
  const tool = lookupOrder(seen, { repair: async () => ({ order: "still wrong" }) });
  const result = await runToolCall(call("lookup_order", { order: "x" }), [tool], pipelineContext());
  assert.equal(result.isError, true);
  assert.ok(textOf(result.content).includes('Received arguments: {"order":"x"}'));
  assert.deepEqual(seen, []);
});

test("a repair that throws returns an error result and keeps its error in details", async () => {
  const tool = lookupOrder([], {
    repair: async () => {
      throw new Error("repair bug");
    },
  });
  const result = await runToolCall(call("lookup_order", { order: "x" }), [tool], pipelineContext());
  assert.equal(result.isError, true);
  assert.equal((result.details as { repairError?: string }).repairError, "repair bug");
});

test("a numeric string for an integer field is coerced before validation", async () => {
  const seen: unknown[] = [];
  await runToolCall(call("lookup_order", { order: "42" }), [lookupOrder(seen)], pipelineContext());
  assert.deepEqual(seen, [{ order: 42 }]);
});

test("arguments sent as a JSON string are parsed for an object schema", async () => {
  const seen: unknown[] = [];
  await runToolCall(call("lookup_order", '{"order":3}'), [lookupOrder(seen)], pipelineContext());
  assert.deepEqual(seen, [{ order: 3 }]);
});

test("a Standard Schema validates the input and passes its output value to execute", async () => {
  const seen: unknown[] = [];
  const tool = defineTool({
    name: "tag_order",
    description: "Tag an order.",
    inputSchema: z.object({ order: z.number().int(), tag: z.string().transform((tag) => tag.toUpperCase()) }),
    async execute(input) {
      seen.push(input);
      return { content: [{ type: "text", text: "tagged" }] };
    },
  });
  await runToolCall(call("tag_order", { order: "9", tag: "urgent" }), [tool], pipelineContext());
  assert.deepEqual(seen, [{ order: 9, tag: "URGENT" }]);
});

test("a Standard Schema's issue paths become JSON Pointers", async () => {
  const tool = defineTool({
    name: "ship_items",
    description: "Ship items.",
    inputSchema: z.object({ items: z.array(z.object({ "sku/id": z.string() })) }),
    async execute() {
      return { content: [] };
    },
  });
  const result = await runToolCall(call("ship_items", { items: [{ "sku/id": 1 }] }), [tool], pipelineContext());
  assert.match(textOf(result.content), /^- \/items\/0\/sku~1id: /m);
});

test("received arguments longer than 2,000 characters are cut short", async () => {
  const result = await runToolCall(
    call("lookup_order", { order: "x".repeat(5000) }),
    [lookupOrder()],
    pipelineContext(),
  );
  assert.match(textOf(result.content), /… \(\d+ more characters\)/);
});

test("a length-stopped message returns one re-issue error per tool call and runs nothing", async () => {
  const seen: unknown[] = [];
  const message = assistant([call("lookup_order", { order: 1 }, "a"), call("lookup_order", { ord: 2 }, "b")], "length");
  const results = await runToolCalls(message, [lookupOrder(seen)], pipelineContext());
  assert.deepEqual(
    results.map(({ call }) => call.callId),
    ["a", "b"],
  );
  for (const { result } of results) {
    assert.equal(result.isError, true);
    assert.match(textOf(result.content), /Re-issue the call with complete arguments/);
  }
  assert.deepEqual(seen, []);
});

test("tool calls run one at a time in model order", async () => {
  const seen: unknown[] = [];
  const message = assistant([call("lookup_order", { order: 1 }, "a"), call("lookup_order", { order: 2 }, "b")]);
  const results = await runToolCalls(message, [lookupOrder(seen)], pipelineContext());
  assert.deepEqual(seen, [{ order: 1 }, { order: 2 }]);
  assert.deepEqual(
    results.map(({ result }) => textOf(result.content)),
    ["Order 1 is shipped.", "Order 2 is shipped."],
  );
});

test("execute receives the call's id and the run's context", async () => {
  const contexts: unknown[] = [];
  const tool = lookupOrder([], {
    async execute(_input, ctx) {
      contexts.push({ runId: ctx.runId, callId: ctx.callId, depth: ctx.depth, maxDepth: ctx.maxDepth });
      return { content: [] };
    },
  });
  await runToolCall(call("lookup_order", { order: 1 }, "call-9"), [tool], pipelineContext());
  assert.deepEqual(contexts, [{ runId: "run-1", callId: "call-9", depth: 0, maxDepth: 2 }]);
});

test("a tool's progress updates reach the context's onUpdate with the call id", async () => {
  const updates: unknown[] = [];
  const tool = lookupOrder([], {
    async execute(_input, ctx) {
      ctx.update({ rows: 10 });
      return { content: [] };
    },
  });
  const ctx = pipelineContext({ onUpdate: (callId, details) => updates.push({ callId, details }) });
  await runToolCall(call("lookup_order", { order: 1 }), [tool], ctx);
  assert.deepEqual(updates, [{ callId: "call-1", details: { rows: 10 } }]);
});

test("a result without a content list throws an SdkError", async () => {
  const tool = lookupOrder([], { execute: async () => ({ text: "done" }) as never });
  await assert.rejects(
    () => runToolCall(call("lookup_order", { order: 1 }), [tool], pipelineContext()),
    (error) => isSdkError(error) && error.code === "invalid_tool_result",
  );
});

test("two tools with one name throw an SdkError", async () => {
  await assert.rejects(
    () => runToolCall(call("lookup_order", { order: 1 }), [lookupOrder(), lookupOrder()], pipelineContext()),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});
