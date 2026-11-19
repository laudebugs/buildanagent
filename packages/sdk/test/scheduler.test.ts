import assert from "node:assert/strict";
import { defineTool, isSdkError } from "@buildanagent/sdk";
import { test } from "vitest";
import { type AnyTool, runToolCalls, type ToolCallResult } from "../src/tools/pipeline.js";
import { deferred, flush, Probe } from "./scheduler-helpers.js";
import { assistant, call, textOf } from "./tool-helpers.js";

function probeCall(id: string, key?: string, name = "probe") {
  return call(name, key === undefined ? { id } : { id, key }, id);
}

const byKey = { resourceKey: (input: { key?: string }) => input.key ?? "" };

// A tool whose result is malformed, which is a programmer error, so it throws an SdkError.
const MALFORMED: AnyTool = defineTool({
  name: "malformed",
  description: "Returns a result with no content.",
  inputSchema: { type: "object" },
  // @ts-expect-error: a tool must return a result with content
  async execute() {
    return { text: "no content" };
  },
});

test("three independent calls all start before any of them ends", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a"), probeCall("b"), probeCall("c")]),
    [probe.tool()],
    probe.context(),
  );
  await Promise.all([probe.started("a"), probe.started("b"), probe.started("c")]);
  assert.deepEqual(probe.log, ["start a", "start b", "start c"]);
  for (const id of ["a", "b", "c"]) probe.release(id);
  await running;
  const starts = ["a", "b", "c"].map((id) => probe.times.get(id)?.start ?? "");
  const ends = ["a", "b", "c"].map((id) => probe.times.get(id)?.end ?? "");
  assert.ok(Math.max(...starts.map((time) => Date.parse(time))) < Math.min(...ends.map((time) => Date.parse(time))));
});

test("calls with the same resourceKey never overlap and run in model order", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a", "file"), probeCall("b", "file")]),
    [probe.tool(byKey)],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  probe.release("a");
  await probe.started("b");
  probe.release("b");
  await running;
  assert.deepEqual(probe.log, ["start a", "end a", "start b", "end b"]);
});

test("calls with different resourceKeys run together", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a", "one"), probeCall("b", "two")]),
    [probe.tool(byKey)],
    probe.context(),
  );
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("a");
  probe.release("b");
  await running;
});

test("two different tools that return the same key never overlap", async () => {
  const probe = new Probe();
  const other = probe.tool({ ...byKey, name: "other" });
  const running = runToolCalls(
    assistant([probeCall("a", "file"), probeCall("b", "file", "other")]),
    [probe.tool(byKey), other],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  probe.release("a");
  await probe.started("b");
  probe.release("b");
  await running;
});

test("a call with a different key is not queued behind a keyed call", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a", "file"), probeCall("b", "file"), probeCall("c")]),
    [probe.tool({ resourceKey: (input) => input.key ?? "" })],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  // `c` has the empty key, a different resource from "file".
  await probe.started("c");
  assert.deepEqual(probe.log, ["start a", "start c"]);
  for (const id of ["a", "b", "c"]) probe.release(id);
  await running;
});

test("a call to a tool without a resourceKey is not queued behind a keyed call", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a", "file"), probeCall("b", "file"), probeCall("c", undefined, "free")]),
    [probe.tool(byKey), probe.tool({ name: "free" })],
    probe.context(),
  );
  await Promise.all([probe.started("a"), probe.started("c")]);
  await flush();
  // A keyed call waits one turn for its lane, so `c` may start first; only `b` must wait.
  assert.deepEqual([...probe.log].sort(), ["start a", "start c"]);
  for (const id of ["a", "b", "c"]) probe.release(id);
  await running;
});

test("results arrive in model order whatever order the calls finish in", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a"), probeCall("b"), probeCall("c")]),
    [probe.tool()],
    probe.context(),
  );
  await Promise.all([probe.started("a"), probe.started("b"), probe.started("c")]);
  for (const id of ["c", "b", "a"]) probe.release(id);
  const results = await running;
  assert.deepEqual(
    results.map(({ call: { callId } }) => callId),
    ["a", "b", "c"],
  );
  assert.deepEqual(probe.log.slice(3), ["end c", "end b", "end a"]);
});

test("onResult passes a result on as soon as every result before it is in, and not before", async () => {
  const probe = new Probe();
  const delivered: string[] = [];
  const ctx = probe.context({ onResult: ({ call: { callId } }) => delivered.push(callId) });
  const running = runToolCalls(assistant([probeCall("a"), probeCall("b"), probeCall("c")]), [probe.tool()], ctx);
  await Promise.all([probe.started("a"), probe.started("b"), probe.started("c")]);
  probe.release("b");
  await flush();
  assert.deepEqual(delivered, []);
  probe.release("a");
  await flush();
  assert.deepEqual(delivered, ["a", "b"]);
  probe.release("c");
  await running;
  assert.deepEqual(delivered, ["a", "b", "c"]);
});

test("a sequential tool makes its step run one call at a time, in model order", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a"), probeCall("b"), probeCall("c")]),
    [probe.tool({ executionMode: "sequential" })],
    probe.context(),
  );
  for (const id of ["a", "b", "c"]) {
    await probe.started(id);
    await flush();
    assert.equal(probe.log.at(-1), `start ${id}`);
    probe.release(id);
  }
  await running;
  assert.deepEqual(probe.log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("one sequential tool also holds back the parallel calls of its step", async () => {
  const probe = new Probe();
  const sequential = probe.tool({ name: "sequential", executionMode: "sequential" });
  const running = runToolCalls(
    assistant([probeCall("a"), probeCall("b", undefined, "sequential"), probeCall("c")]),
    [probe.tool(), sequential],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  for (const id of ["a", "b", "c"]) {
    await probe.started(id);
    probe.release(id);
  }
  await running;
  assert.deepEqual(probe.log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("a sequential tool holds back its step even when its own call fails validation", async () => {
  const probe = new Probe();
  const sequential = probe.tool({ name: "sequential", executionMode: "sequential" });
  const running = runToolCalls(
    assistant([call("sequential", {}, "s"), probeCall("a"), probeCall("b")]),
    [probe.tool(), sequential],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  probe.release("a");
  await probe.started("b");
  probe.release("b");
  const results = await running;
  assert.equal(results[0]?.result.isError, true);
  assert.deepEqual(probe.log, ["start a", "end a", "start b", "end b"]);
});

test("a readOnlyHint without firstParty does not make a call read-only", async () => {
  const probe = new Probe();
  const mcpStyle = probe.tool({ ...byKey, annotations: { readOnlyHint: true } });
  const running = runToolCalls(
    assistant([probeCall("a", "file"), probeCall("b", "file")]),
    [mcpStyle],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  probe.release("a");
  await probe.started("b");
  probe.release("b");
  await running;
});

test("a first-party readOnlyHint lets calls that share a key run together", async () => {
  const probe = new Probe();
  const trusted = probe.tool({ ...byKey, firstParty: true, annotations: { readOnlyHint: true } });
  const running = runToolCalls(assistant([probeCall("a", "file"), probeCall("b", "file")]), [trusted], probe.context());
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("a");
  probe.release("b");
  await running;
});

test("a first-party readOnlyHint is not read-only when it is false", async () => {
  const probe = new Probe();
  const writer = probe.tool({ ...byKey, firstParty: true, annotations: { readOnlyHint: false } });
  const running = runToolCalls(assistant([probeCall("a", "file"), probeCall("b", "file")]), [writer], probe.context());
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  probe.release("a");
  await probe.started("b");
  probe.release("b");
  await running;
});

test("a first-party readOnlyHint is ignored for a tool that declares an effect", async () => {
  const probe = new Probe();
  const writer = probe.tool({
    ...byKey,
    firstParty: true,
    annotations: { readOnlyHint: true },
    effect: { kind: "write" },
  });
  const running = runToolCalls(assistant([probeCall("a", "file"), probeCall("b", "file")]), [writer], probe.context());
  await probe.started("a");
  await flush();
  assert.deepEqual(probe.log, ["start a"]);
  probe.release("a");
  await probe.started("b");
  probe.release("b");
  await running;
});

test("a read waits for the write before it, and a write waits for the reads before it", async () => {
  const probe = new Probe();
  const reader = probe.tool({ ...byKey, name: "reader", firstParty: true, annotations: { readOnlyHint: true } });
  const writer = probe.tool({ ...byKey, name: "writer" });
  const running = runToolCalls(
    assistant([
      probeCall("w1", "file", "writer"),
      probeCall("r1", "file", "reader"),
      probeCall("r2", "file", "reader"),
      probeCall("w2", "file", "writer"),
    ]),
    [reader, writer],
    probe.context(),
  );
  await probe.started("w1");
  await flush();
  assert.deepEqual(probe.log, ["start w1"]);
  probe.release("w1");
  await Promise.all([probe.started("r1"), probe.started("r2")]);
  assert.deepEqual(probe.log, ["start w1", "end w1", "start r1", "start r2"]);
  probe.release("r1");
  await flush();
  assert.equal(probe.log.includes("start w2"), false);
  probe.release("r2");
  await probe.started("w2");
  probe.release("w2");
  await running;
});

test("a programmer error in one call fires the signal its siblings hold", async () => {
  const probe = new Probe();
  const running = runToolCalls(
    assistant([probeCall("a"), call("malformed", {}, "b")]),
    [probe.tool(), MALFORMED],
    probe.context(),
  );
  const outcome = assert.rejects(running, (error) => isSdkError(error) && error.code === "invalid_tool_result");
  await probe.started("a");
  await flush();
  assert.equal(probe.signals.get("a")?.aborted, true);
  probe.release("a");
  await outcome;
});

test("an error result the model can read cancels no sibling", async () => {
  const probe = new Probe();
  const failing = defineTool({
    name: "failing",
    description: "Returns an error result.",
    inputSchema: { type: "object" },
    async execute() {
      return { content: [{ type: "text", text: "no such order" }], isError: true };
    },
  });
  const running = runToolCalls(
    assistant([probeCall("a"), call("failing", {}, "b")]),
    [probe.tool(), failing],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.equal(probe.signals.get("a")?.aborted, false);
  probe.release("a");
  const results = await running;
  assert.deepEqual(
    results.map(({ result }) => result.isError === true),
    [false, true],
  );
});

test("a tool that throws an ordinary error cancels no sibling", async () => {
  const probe = new Probe();
  const throwing = defineTool({
    name: "throwing",
    description: "Throws.",
    inputSchema: { type: "object" },
    async execute(): Promise<never> {
      throw new Error("database offline");
    },
  });
  const running = runToolCalls(
    assistant([probeCall("a"), call("throwing", {}, "b")]),
    [probe.tool(), throwing],
    probe.context(),
  );
  await probe.started("a");
  await flush();
  assert.equal(probe.signals.get("a")?.aborted, false);
  probe.release("a");
  const results = await running;
  assert.match(textOf(results[1]?.result.content ?? []), /database offline/);
});

test("after a programmer error, every other call's result is still passed on, in model order", async () => {
  const probe = new Probe();
  const delivered: string[] = [];
  const ctx = probe.context({ onResult: ({ call: { callId } }) => delivered.push(callId) });
  const running = runToolCalls(
    assistant([probeCall("a"), call("malformed", {}, "b"), probeCall("c")]),
    [probe.tool(), MALFORMED],
    ctx,
  );
  const outcome = assert.rejects(running);
  await Promise.all([probe.started("a"), probe.started("c")]);
  probe.release("c");
  await flush();
  // `c` ran, but its result waits for `a`, which comes before it.
  assert.deepEqual(delivered, []);
  probe.release("a");
  await outcome;
  assert.deepEqual(delivered, ["a", "c"]);
});

test("a call queued behind a failing sibling is not run, and still gets a result", async () => {
  const probe = new Probe();
  const failing = defineTool({
    name: "malformed_keyed",
    description: "Returns a result with no content.",
    inputSchema: { type: "object" },
    resourceKey: () => "file",
    // @ts-expect-error: a tool must return a result with content
    async execute() {
      return { text: "no content" };
    },
  });
  const delivered: ToolCallResult[] = [];
  const running = runToolCalls(
    assistant([call("malformed_keyed", {}, "a"), probeCall("b", "file")]),
    [failing as AnyTool, probe.tool(byKey)],
    probe.context({ onResult: (entry) => delivered.push(entry) }),
  );
  await assert.rejects(running, (error) => isSdkError(error));
  assert.deepEqual(probe.log, []);
  assert.deepEqual(
    delivered.map(({ call: { callId } }) => callId),
    ["b"],
  );
  assert.match(textOf(delivered[0]?.result.content ?? []), /another call in the same step failed/);
});

test("an aborted run gives every call a result, and none that had not started runs", async () => {
  const probe = new Probe();
  const controller = new AbortController();
  const ctx = probe.context({ signal: controller.signal });
  const running = runToolCalls(assistant([probeCall("a", "file"), probeCall("b", "file")]), [probe.tool(byKey)], ctx);
  await probe.started("a");
  controller.abort("stop");
  assert.equal(probe.signals.get("a")?.aborted, true);
  probe.release("a");
  const results: ToolCallResult[] = await running;
  assert.equal(results.length, 2);
  assert.match(textOf(results[1]?.result.content ?? []), /because the run was cancelled/);
  assert.deepEqual(probe.log, ["start a", "end a"]);
});

test("every call is gated, one at a time in model order, before any call executes", async () => {
  const probe = new Probe();
  const opened = [deferred(), deferred()];
  const asked: string[] = [];
  const ctx = probe.context({
    async gate({ call: { callId } }) {
      asked.push(callId);
      await opened[asked.length - 1]?.promise;
      return undefined;
    },
  });
  const running = runToolCalls(assistant([probeCall("a"), probeCall("b")]), [probe.tool()], ctx);
  await flush();
  assert.deepEqual(asked, ["a"]);
  assert.deepEqual(probe.log, []);
  opened[0]?.resolve();
  await flush();
  assert.deepEqual(asked, ["a", "b"]);
  assert.deepEqual(probe.log, []);
  opened[1]?.resolve();
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("a");
  probe.release("b");
  await running;
});

test("a call the gate blocks is not executed and keeps its place in the results", async () => {
  const probe = new Probe();
  const ctx = probe.context({
    async gate({ call: { callId } }) {
      return callId === "a" ? { blocked: { content: [{ type: "text", text: "denied" }], isError: true } } : undefined;
    },
  });
  const running = runToolCalls(assistant([probeCall("a"), probeCall("b")]), [probe.tool()], ctx);
  await probe.started("b");
  probe.release("b");
  const results = await running;
  assert.deepEqual(
    results.map(({ call: { callId }, result }) => [callId, textOf(result.content)]),
    [
      ["a", "denied"],
      ["b", "done b"],
    ],
  );
  assert.deepEqual(probe.log, ["start b", "end b"]);
});

test("onStart is called for every call before the first one executes", async () => {
  const probe = new Probe();
  const started: string[] = [];
  const ctx = probe.context({ onStart: ({ callId }) => started.push(callId) });
  const running = runToolCalls(assistant([probeCall("a"), probeCall("b")]), [probe.tool()], ctx);
  await probe.started("a");
  assert.deepEqual(started, ["a", "b"]);
  probe.release("a");
  probe.release("b");
  await running;
});

test("a resourceKey that returns something other than a string is a programmer error", async () => {
  const probe = new Probe();
  const tool = probe.tool({ resourceKey: (() => 42) as never });
  await assert.rejects(
    () => runToolCalls(assistant([probeCall("a")]), [tool], probe.context()),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
  assert.deepEqual(probe.log, []);
});

test("a resourceKey that throws is a programmer error", async () => {
  const probe = new Probe();
  const tool = probe.tool({
    resourceKey: () => {
      throw new Error("no key");
    },
  });
  await assert.rejects(
    () => runToolCalls(assistant([probeCall("a")]), [tool], probe.context()),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});

test("a resourceKey that throws for a later call still gives the calls checked before it a result", async () => {
  const probe = new Probe();
  const keyless = probe.tool({
    name: "keyless",
    resourceKey: () => {
      throw new Error("no key");
    },
  });
  const delivered: ToolCallResult[] = [];
  const started: string[] = [];
  const ctx = probe.context({
    onStart: ({ callId }) => started.push(callId),
    onResult: (entry) => delivered.push(entry),
  });
  await assert.rejects(
    () =>
      runToolCalls(
        assistant([call("missing", {}, "x"), probeCall("a"), probeCall("k", undefined, "keyless"), probeCall("z")]),
        [probe.tool(), keyless],
        ctx,
      ),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
  assert.deepEqual(started, ["x", "a", "k"]);
  assert.deepEqual(
    delivered.map(({ call: { callId }, result }) => [callId, result.isError]),
    [
      ["x", true],
      ["a", true],
    ],
  );
  assert.match(textOf(delivered[1]?.result.content ?? []), /was not run/);
  assert.deepEqual(probe.log, []);
});

test("defineTool rejects an executionMode that is neither parallel nor sequential", () => {
  assert.throws(
    () =>
      defineTool({
        name: "bad_mode",
        description: "Has a bad mode.",
        inputSchema: { type: "object" },
        executionMode: "serial" as never,
        execute: async () => ({ content: [] }),
      }),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});

test("defineTool rejects a resourceKey that is not a function", () => {
  assert.throws(
    () =>
      defineTool({
        name: "bad_key",
        description: "Has a bad key.",
        inputSchema: { type: "object" },
        resourceKey: "path" as never,
        execute: async () => ({ content: [] }),
      }),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});
