// Observers only watch: they see every event in order, and nothing they do can break or change the run.
import assert from "node:assert/strict";
import type { ContentBlock } from "@buildanagent/gateway";
import { type AgentEvent, isSdkError, type Observer, run } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun, hookedRun } from "./hook-helpers.js";
import { determinism, drive, lookup, scripted, text, toolCall, typesOf } from "./run-helpers.js";
import { deferred, flush, Probe } from "./scheduler-helpers.js";

function collector(): { events: AgentEvent[]; observer: Observer } {
  const events: AgentEvent[] = [];
  return { events, observer: (event) => void events.push(event) };
}

function throwOn(type: AgentEvent["type"]): Observer {
  return (event) => {
    if (event.type === type) throw new Error(`observer failed on ${type}`);
  };
}

test("an observer in the options receives every event, run_start first, in the run's own order", async () => {
  const { events: seen, observer } = collector();
  const { events } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    {},
    {
      tools: [lookup],
      observers: [observer],
    },
  );
  assert.deepEqual(seen, events);
  assert.equal(seen[0]?.type, "run_start");
});

test("run.on() returns a function that stops delivery", async () => {
  const { events: seen, observer } = collector();
  const { started } = hookedRun([toolCall("lookup", { order: 1 }), text("Done.")], {}, { tools: [lookup] });
  const unsubscribe = started.on(observer);
  unsubscribe();
  await drive(started);
  assert.deepEqual(seen, []);
});

test("an observer that unsubscribes stops receiving events from then on", async () => {
  const seen: string[] = [];
  const { started } = hookedRun([toolCall("lookup", { order: 1 }), text("Done.")], {}, { tools: [lookup] });
  const unsubscribe = started.on((event) => {
    seen.push(event.type);
    if (event.type === "step_start") unsubscribe();
  });
  await drive(started);
  assert.deepEqual(seen, ["step_start"]);
});

test("an observer added with run.on() right after run() sees every event but run_start, in order", async () => {
  const { events: seen, observer } = collector();
  const { started } = hookedRun([text("Done.")], {});
  started.on(observer);
  const { events } = await drive(started);
  assert.deepEqual(seen, events.slice(1));
});

test("each observer sees the whole sequence in order, whatever the others do", async () => {
  const slow = deferred();
  const first = collector();
  const second = collector();
  const { started } = hookedRun(
    [text("Done.")],
    {},
    {
      observers: [
        async (event) => {
          if (event.type === "run_start") await slow.promise;
          first.events.push(event);
        },
        second.observer,
      ],
    },
  );
  const driven = drive(started);
  await flush();
  assert.ok(second.events.length > first.events.length);
  slow.resolve();
  const { events } = await driven;
  assert.deepEqual(first.events, events);
  assert.deepEqual(second.events, events);
});

test("an observer that throws becomes a hook_error event, and the run still ends done", async () => {
  const { events, result } = await drivenRun([text("Done.")], {}, { observers: [throwOn("step_start")] });
  assert.equal(result.stopReason, "done");
  const failed = events.find((event) => event.type === "hook_error");
  assert.deepEqual(failed?.type === "hook_error" ? [failed.hook, failed.error] : undefined, [
    "observer",
    "observer failed on step_start",
  ]);
});

test("an observer that rejects becomes a hook_error event, and the run still ends done", async () => {
  const { events, result } = await drivenRun(
    [text("Done.")],
    {},
    {
      observers: [
        async (event) => {
          if (event.type === "step_end") throw new Error("late failure");
        },
      ],
    },
  );
  assert.equal(result.stopReason, "done");
  assert.ok(events.some((event) => event.type === "hook_error" && event.error === "late failure"));
});

test("a throwing observer does not stop another observer from seeing the event", async () => {
  const { events: seen, observer } = collector();
  const { events } = await drivenRun([text("Done.")], {}, { observers: [throwOn("step_start"), observer] });
  assert.deepEqual(typesOf(seen), typesOf(events));
});

test("an observer that throws on every event, hook_error included, does not loop", async () => {
  const { events, result } = await drivenRun(
    [text("Done.")],
    {},
    {
      observers: [
        () => {
          throw new Error("always");
        },
      ],
    },
  );
  assert.equal(result.stopReason, "done");
  assert.ok(events.filter((event) => event.type === "hook_error").length > 0);
});

test("a failure while handling agent_settled is reported before run_end", async () => {
  const { events } = await drivenRun([text("Done.")], {}, { observers: [throwOn("agent_settled")] });
  const types = typesOf(events);
  assert.ok(types.indexOf("hook_error") > types.indexOf("agent_settled"));
  assert.deepEqual(types.slice(-2), ["hook_error", "run_end"]);
});

test("a failure while handling run_end is dropped, so run_end stays the last event", async () => {
  const { events, result } = await drivenRun([text("Done.")], {}, { observers: [throwOn("run_end")] });
  assert.equal(result.stopReason, "done");
  assert.equal(events.at(-1)?.type, "run_end");
  assert.equal(
    events.some((event) => event.type === "hook_error"),
    false,
  );
});

test("an observer's promise is waited for before it gets the next event", async () => {
  const seen: string[] = [];
  const gate = deferred();
  const { started } = hookedRun(
    [text("Done.")],
    {},
    {
      observers: [
        async (event) => {
          seen.push(`start ${event.type}`);
          if (event.type === "run_start") await gate.promise;
          seen.push(`end ${event.type}`);
        },
      ],
    },
  );
  await flush();
  assert.deepEqual(seen, ["start run_start"]);
  gate.resolve();
  await drive(started);
  assert.deepEqual(seen.slice(0, 4), ["start run_start", "end run_start", "start step_start", "end step_start"]);
});

test("the result settles only after observers have handled run_end", async () => {
  const gate = deferred();
  let finished = false;
  const { started } = hookedRun(
    [text("Done.")],
    {},
    {
      observers: [
        async (event) => {
          if (event.type !== "run_end") return;
          await gate.promise;
          finished = true;
        },
      ],
    },
  );
  const settled = started.result.then(() => finished);
  await flush();
  gate.resolve();
  assert.equal(await settled, true);
});

test("a throwing observer in a parallel step leaves every call with a result, settled before run_end", async () => {
  const probe = new Probe();
  const calls: ContentBlock[] = [
    { type: "tool_call", callId: "a", name: "probe", input: { id: "a" } },
    { type: "tool_call", callId: "b", name: "probe", input: { id: "b" } },
  ];
  const { model } = scripted([{ content: calls }, text("Done.")]);
  const started = run({
    model,
    system: "You run probes.",
    input: "Go.",
    tools: [probe.tool()],
    observers: [throwOn("tool_call_end")],
    ...determinism(),
  });
  const driven = drive(started);
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("b");
  probe.release("a");
  const { events, result } = await driven;
  assert.equal(result.stopReason, "done");
  assert.deepEqual(
    result.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : [])),
    ["a", "b"],
  );
  assert.equal(events.filter((event) => event.type === "hook_error").length, 2);
  assert.deepEqual(typesOf(events).slice(-2), ["agent_settled", "run_end"]);
});

test("an observer that isn't a function rejects run() with invalid_run_options", () => {
  assert.throws(
    () => hookedRun([text("Done.")], {}, { observers: ["nope" as never] }),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("an observer that calls abort() while the run ends adds no abort event and leaves the outcome", async () => {
  for (const type of ["agent_settled", "run_end"] as const) {
    const { started } = hookedRun([text("Done.")], {});
    started.on((event) => {
      if (event.type === type) started.abort("too late");
    });
    const { events, result } = await drive(started);
    assert.equal(result.stopReason, "done");
    assert.deepEqual(typesOf(events).slice(-2), ["agent_settled", "run_end"], type);
    assert.equal(
      events.some((event) => event.type === "abort"),
      false,
      type,
    );
  }
});

test("an observer whose promise never settles is removed after observerTimeoutMs, and the run still settles", async () => {
  const { events: seen, observer } = collector();
  const { events, result } = await drivenRun(
    [text("Done.")],
    {},
    {
      observerTimeoutMs: 5,
      observers: [(event) => (event.type === "step_end" ? new Promise<void>(() => {}) : undefined), observer],
    },
  );
  assert.equal(result.stopReason, "done");
  const failed = events.find((event) => event.type === "hook_error");
  assert.match(failed?.type === "hook_error" ? failed.error : "", /did not handle a step_end event within 5 ms/);
  assert.deepEqual(typesOf(events).slice(-2), ["agent_settled", "run_end"]);
  assert.deepEqual(seen, events);
});

test("an observer gets a frozen copy of each event, so it can't change the run's result", async () => {
  const { events, result } = await drivenRun(
    [text("Done.")],
    {},
    {
      observers: [
        (event) => {
          if (event.type === "run_end") (event.result.messages as unknown[]).length = 0;
        },
      ],
    },
  );
  assert.equal(result.messages.length, 2);
  const failed = events.find((event) => event.type === "hook_error");
  assert.equal(failed, undefined, "a run_end failure is dropped");
});

test("an observer that mutates an event mid-run fails, and the transcript keeps its messages", async () => {
  const { events, result } = await drivenRun(
    [toolCall("lookup", { order: 1 }), text("Done.")],
    {},
    {
      tools: [lookup],
      observers: [
        (event) => {
          if (event.type === "model_call_end") (event.message.content as unknown[]).push({ type: "text", text: "x" });
        },
      ],
    },
  );
  assert.equal(result.stopReason, "done");
  assert.ok(events.some((event) => event.type === "hook_error" && /not extensible/.test(event.error)));
  const first = result.messages[1];
  assert.equal(first?.role === "assistant" ? first.content.length : undefined, 1);
});

test("an observerTimeoutMs that isn't a positive number rejects run() with invalid_run_options", () => {
  for (const observerTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => hookedRun([text("Done.")], {}, { observerTimeoutMs }),
      (error) => isSdkError(error) && error.code === "invalid_run_options",
    );
  }
});
