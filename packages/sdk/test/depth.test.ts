// The depth cap (D11): ToolContext carries depth and maxDepth, and a run nested deeper than the cap is refused, which a
// tool that spawns it reports to the model as an error result.
import assert from "node:assert/strict";
import {
  type AgentEvent,
  defineTool,
  isSdkError,
  nestedRunDepth,
  type RunOptions,
  run,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "@buildanagent/sdk";
import { sequentialIds } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { determinism, drive, scripted, text, toolCall } from "./run-helpers.js";

const SYSTEM = "You delegate.";

/** Records the context of each call, so a test can read the depth a tool ran at. */
function probe() {
  const seen: Pick<ToolContext, "depth" | "maxDepth">[] = [];
  const tool = defineTool({
    name: "probe",
    description: "Reports its depth.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx) {
      seen.push({ depth: ctx.depth, maxDepth: ctx.maxDepth });
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
  return { seen, tool };
}

test("a top-level run's tools see depth 0 and maxDepth 2 by default", async () => {
  const { seen, tool } = probe();
  const { model } = scripted([toolCall("probe", {}), text("Done.")]);
  await drive(run({ model, system: SYSTEM, input: "Go.", tools: [tool], ...determinism() }));
  assert.deepEqual(seen, [{ depth: 0, maxDepth: 2 }]);
});

test("the depth options reach the tools", async () => {
  const { seen, tool } = probe();
  const { model } = scripted([toolCall("probe", {}), text("Done.")]);
  await drive(run({ model, system: SYSTEM, input: "Go.", tools: [tool], depth: 1, maxDepth: 3, ...determinism() }));
  assert.deepEqual(seen, [{ depth: 1, maxDepth: 3 }]);
});

/** A tool that runs a nested agent one level deeper, and returns what that agent answered. */
function delegating(modelFor: (depth: number) => RunOptions["model"], log: string[]): ToolDefinition {
  return defineTool({
    name: "delegate",
    description: "Hands the task to a sub-agent.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx): Promise<ToolResult> {
      log.push(`at ${ctx.depth} of ${ctx.maxDepth}`);
      const nested = nestedRunDepth(ctx);
      const child = run({
        model: modelFor(nested.depth),
        system: SYSTEM,
        input: "Sub-task.",
        tools: [delegating(modelFor, log)],
        ...nested,
        ...determinism(),
      });
      const result = await child.result;
      const last = result.messages.at(-1);
      const answer =
        last?.role === "assistant" && last.content[0]?.type === "text" ? last.content[0].text : result.stopReason;
      return { content: [{ type: "text", text: `sub-agent: ${answer}` }] };
    },
  });
}

test("a tool at depth === maxDepth that spawns a run gets an error result", async () => {
  const log: string[] = [];
  const models = new Map<number, ReturnType<typeof scripted>>();
  const modelFor = (depth: number) => {
    const entry = models.get(depth) ?? scripted([toolCall("delegate", {}), text(`level ${depth} done`)]);
    models.set(depth, entry);
    return entry.model;
  };
  // maxDepth 1: the top run (depth 0) delegates to depth 1, whose own delegate call would need depth 2.
  const top = scripted([toolCall("delegate", {}), text("Top done.")]);
  const { events, result } = await drive(
    run({
      model: top.model,
      system: SYSTEM,
      input: "Go.",
      tools: [delegating(modelFor, log)],
      maxDepth: 1,
      ...determinism(),
    }),
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(log, ["at 0 of 1", "at 1 of 1"]);
  const results = events.filter((e) => e.type === "tool_call_end");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.result.isError, undefined, "the top run's delegate call worked");

  // The depth-1 run's delegate call failed: its tool result is an error naming the cap.
  const inner = models.get(1)?.adapter.calls.at(-1)?.context.messages.at(-1);
  assert.equal(inner?.role, "tool");
  if (inner?.role !== "tool") return;
  assert.equal(inner.isError, true);
  const body = inner.content[0];
  assert.ok(body?.type === "text" && /deeper than maxDepth 1/.test(body.text));
  // Nothing was run at depth 2: the model for it was never called.
  assert.equal(models.get(2)?.adapter.calls.length ?? 0, 0);
});

test("run() refuses a depth above maxDepth with max_depth_exceeded", () => {
  const { model } = scripted([text("x")]);
  assert.throws(
    () => run({ model, system: SYSTEM, input: "Go.", depth: 3, maxDepth: 2 }),
    (error) => isSdkError(error) && error.code === "max_depth_exceeded",
  );
});

test("depth and maxDepth must be whole numbers from 0", () => {
  const { model } = scripted([text("x")]);
  for (const options of [{ depth: -1 }, { maxDepth: 1.5 }, { depth: Number.NaN }]) {
    assert.throws(
      () => run({ model, system: SYSTEM, input: "Go.", ...options }),
      (error) => isSdkError(error) && error.code === "invalid_run_options",
    );
  }
});

test("nestedRunDepth is one level deeper under the same cap", () => {
  assert.deepEqual(nestedRunDepth({ depth: 1, maxDepth: 4 }), { depth: 2, maxDepth: 4 });
});

// Parent run ids ----------------------------------------------------------------------------------------------------

/** A tool that runs a nested agent with `nestedRunDepth(ctx)` and keeps the nested run's events. */
function parentingTool(nestedEvents: AgentEvent[], extra: Partial<RunOptions> = {}): ToolDefinition {
  return defineTool({
    name: "delegate",
    description: "Hands the task to a sub-agent.",
    inputSchema: { type: "object", properties: {} },
    async execute(_input, ctx): Promise<ToolResult> {
      const { model } = scripted([text("Sub done.")]);
      const child = run({
        model,
        system: SYSTEM,
        input: "Sub-task.",
        ...nestedRunDepth(ctx),
        ...extra,
        ...determinism(),
        idGenerator: sequentialIds("child"),
      });
      nestedEvents.push(...(await drive(child)).events);
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
}

function startOf(events: readonly AgentEvent[]) {
  const start = events.find((event) => event.type === "run_start");
  assert.ok(start?.type === "run_start", "the run emits run_start");
  return start;
}

test("a run a tool starts with nestedRunDepth() names the calling run and call in run_start", async () => {
  const nested: AgentEvent[] = [];
  const { model } = scripted([toolCall("delegate", {}, "call-7"), text("Top done.")]);
  const { events } = await drive(
    run({ model, system: SYSTEM, input: "Go.", tools: [parentingTool(nested)], ...determinism() }),
  );
  const top = startOf(events);
  const child = startOf(nested);
  assert.equal(child.parentRunId, top.runId);
  assert.equal(child.parentCallId, "call-7");
  assert.equal("parentRunId" in top, false, "a top-level run names no parent");
  assert.equal("parentCallId" in top, false);
});

test("parentRun without nestedRunDepth() reaches run_start, and a blank id is refused", async () => {
  const { model } = scripted([text("Hi.")]);
  const base = { model, system: SYSTEM, input: "Go.", ...determinism() };
  const { events } = await drive(run({ ...base, parentRun: { runId: "run-a", callId: "call-b" } }));
  const start = startOf(events);
  assert.deepEqual([start.parentRunId, start.parentCallId], ["run-a", "call-b"]);
  for (const parentRun of [
    { runId: "", callId: "c" },
    { runId: "r", callId: "" },
  ]) {
    assert.throws(
      () => run({ ...base, parentRun }),
      (error) => isSdkError(error) && error.code === "invalid_run_options",
    );
  }
});

test("nestedRunDepth() leaves parentRun out of a context that has no run or call id", () => {
  assert.deepEqual(nestedRunDepth({ depth: 1, maxDepth: 3 }), { depth: 2, maxDepth: 3 });
  assert.deepEqual(nestedRunDepth({ depth: 0, maxDepth: 2, runId: "r", callId: "c" }), {
    depth: 1,
    maxDepth: 2,
    parentRun: { runId: "r", callId: "c" },
  });
});
