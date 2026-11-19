// run.steer() and run.followUp(): messages applied only at step boundaries, with receipts.
import assert from "node:assert/strict";
import type { ContentBlock, Message } from "@buildanagent/gateway";
import { type AgentEvent, type DeliveryReceipt, defineTool, isSdkError, type Run, run } from "@buildanagent/sdk";
import { test } from "vitest";
import { determinism, drive, scripted, text, typesOf } from "./run-helpers.js";
import { Probe } from "./scheduler-helpers.js";

const SYSTEM = "You run probes.";

function twoProbeCalls(): { content: ContentBlock[] } {
  return {
    content: [
      { type: "tool_call", callId: "a", name: "probe", input: { id: "a" } },
      { type: "tool_call", callId: "b", name: "probe", input: { id: "b" } },
    ],
  };
}

function userTexts(messages: readonly Message[]): string[] {
  return messages.flatMap((message) =>
    message.role === "user" ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])) : [],
  );
}

function applied(events: readonly AgentEvent[]) {
  return events.flatMap((event) => (event.type === "steer_applied" ? [event] : []));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("the promise resolved");
}

test("a steer sent during a tool batch is applied after the batch, never inside it", async () => {
  const probe = new Probe();
  const { adapter, model } = scripted([twoProbeCalls(), text("Done.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", tools: [probe.tool()], ...determinism() });
  const driven = drive(started);
  await Promise.all([probe.started("a"), probe.started("b")]);
  const got = { resolved: false };
  const sent = started.steer("Use order 2 instead.").then((value) => {
    got.resolved = true;
    return value;
  });
  probe.release("a");
  await Promise.resolve();
  assert.equal(got.resolved, false, "a steer is not applied while a call of the batch still runs");
  probe.release("b");
  const { events, result } = await driven;
  const receipt = await sent;
  const types = typesOf(events);
  const steerAt = types.indexOf("steer_applied");
  assert.ok(steerAt > types.lastIndexOf("tool_call_end"), "the steer follows the last tool_call_end");
  assert.ok(steerAt > types.indexOf("step_end"), "the steer follows the step that ran the batch");
  assert.equal(receipt.stepIndex, 1);
  assert.deepEqual(
    adapter.calls[1]?.context.messages.map((message) => message.role),
    ["user", "assistant", "tool", "tool", "user"],
  );
  assert.deepEqual(userTexts(result.messages), ["Go.", "Use order 2 instead."]);
});

test("a steer sent before the first model call is applied before it, at step 0", async () => {
  const { adapter, model } = scripted([text("Hello.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  const sent = started.steer("Be brief.");
  const { events, result } = await drive(started);
  assert.equal((await sent).stepIndex, 0);
  assert.deepEqual(userTexts(adapter.calls[0]?.context.messages ?? []), ["Go.", "Be brief."]);
  assert.deepEqual(typesOf(events).slice(0, 4), ["run_start", "step_start", "steer_applied", "model_call_start"]);
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 1);
});

test("a follow-up sent before done extends the run by one step", async () => {
  let started: Run | undefined;
  let sent: Promise<DeliveryReceipt> | undefined;
  const { adapter, model } = scripted([
    () => {
      sent = started?.followUp("Now summarise it.");
      return text("The order shipped.");
    },
    text("Summary: shipped."),
  ]);
  started = run({ model, system: SYSTEM, input: "Where is order 1?", ...determinism() });
  const { events, result } = await drive(started);
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 2);
  assert.deepEqual(userTexts(adapter.calls[1]?.context.messages ?? []), ["Where is order 1?", "Now summarise it."]);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
  const receipt = await sent;
  assert.equal(receipt?.stepIndex, 1);
  assert.equal(applied(events)[0]?.stepIndex, 1);
});

test("a follow-up waits for the end of the run: tool steps in between don't apply it", async () => {
  let started: Run | undefined;
  const { adapter, model } = scripted([
    () => {
      void started?.followUp("And the invoice?");
      return { content: [{ type: "tool_call", callId: "a", name: "probe", input: { id: "a" } }] };
    },
    text("Done with the first order."),
    text("The invoice is paid."),
  ]);
  const probe = new Probe();
  probe.release("a");
  started = run({ model, system: SYSTEM, input: "Go.", tools: [probe.tool()], ...determinism() });
  const { events, result } = await drive(started);
  assert.deepEqual(userTexts(adapter.calls[1]?.context.messages ?? []), ["Go."]);
  assert.deepEqual(userTexts(adapter.calls[2]?.context.messages ?? []), ["Go.", "And the invoice?"]);
  assert.equal(result.steps, 3);
  assert.equal(applied(events)[0]?.receipt.stepIndex, 2);
});

test("a steer and a follow-up each emit one steer_applied that carries kind, message and stepIndex", async () => {
  let started: Run | undefined;
  const { model } = scripted([
    () => {
      void started?.steer("Be brief.");
      void started?.followUp([{ type: "text", text: "One more thing." }]);
      return text("First answer.");
    },
    text("Second answer."),
    text("Third answer."),
  ]);
  started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  const { events, result } = await drive(started);
  const receipts = applied(events).map((event) => event.receipt);
  assert.deepEqual(
    receipts.map(({ kind, message, stepIndex }) => ({ kind, message, stepIndex })),
    [
      { kind: "steer", message: [{ type: "text", text: "Be brief." }], stepIndex: 1 },
      { kind: "follow_up", message: [{ type: "text", text: "One more thing." }], stepIndex: 2 },
    ],
  );
  assert.equal(new Set(receipts.map((receipt) => receipt.id)).size, 2);
  assert.deepEqual(userTexts(result.messages), ["Go.", "Be brief.", "One more thing."]);
  assert.equal(result.steps, 3);
  for (const event of applied(events)) assert.equal(event.stepIndex, event.receipt.stepIndex);
});

test("every receipt resolves with the step index at which its message was applied", async () => {
  const probe = new Probe();
  const { model } = scripted([twoProbeCalls(), text("Done.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", tools: [probe.tool()], ...determinism() });
  const driven = drive(started);
  const early = started.steer("first");
  const second = started.steer("second");
  await Promise.all([probe.started("a"), probe.started("b")]);
  const late = started.steer("third");
  probe.release("a");
  probe.release("b");
  await driven;
  assert.deepEqual(
    (await Promise.all([early, second, late])).map((receipt) => receipt.stepIndex),
    [0, 0, 1],
  );
});

test("steers are applied in the order they were sent", async () => {
  const { adapter, model } = scripted([text("Ok.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  void started.steer("one");
  void started.steer("two");
  await drive(started);
  assert.deepEqual(userTexts(adapter.calls[0]?.context.messages ?? []), ["Go.", "one", "two"]);
});

test("a message that arrives after the run's outcome rejects with undelivered_message", async () => {
  const { model } = scripted([text("Done.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  await drive(started);
  for (const send of [started.steer("late"), started.followUp("late")]) {
    const error = await rejection(send);
    assert.ok(isSdkError(error) && error.code === "undelivered_message");
  }
});

test("a message still waiting when an abort ends the run rejects", async () => {
  const probe = new Probe();
  const { model } = scripted([twoProbeCalls()]);
  const started = run({ model, system: SYSTEM, input: "Go.", tools: [probe.tool()], ...determinism() });
  const driven = drive(started);
  await Promise.all([probe.started("a"), probe.started("b")]);
  const pending = rejection(started.steer("too late"));
  started.abort("stop");
  probe.release("a");
  probe.release("b");
  const { result } = await driven;
  assert.equal(result.stopReason, "aborted");
  const error = await pending;
  assert.ok(isSdkError(error) && error.code === "undelivered_message");
});

test("a follow-up does not extend a run that is at maxSteps, and rejects", async () => {
  let started: Run | undefined;
  let pending: Promise<unknown> | undefined;
  const { model } = scripted([
    () => {
      pending = rejection(started?.followUp("more") ?? Promise.resolve());
      return text("Done.");
    },
  ]);
  started = run({ model, system: SYSTEM, input: "Go.", maxSteps: 1, ...determinism() });
  const { result } = await drive(started);
  assert.equal(result.stopReason, "done");
  const error = await pending;
  assert.ok(isSdkError(error) && error.code === "undelivered_message");
});

test("a run that shouldStop ends while a follow-up waits rejects the follow-up", async () => {
  let started: Run | undefined;
  let pending: Promise<unknown> | undefined;
  const probe = new Probe();
  probe.release("a");
  const { model } = scripted([
    () => {
      pending = rejection(started?.followUp("more") ?? Promise.resolve());
      return { content: [{ type: "tool_call", callId: "a", name: "probe", input: { id: "a" } }] };
    },
  ]);
  started = run({
    model,
    system: SYSTEM,
    input: "Go.",
    tools: [probe.tool()],
    interceptors: { shouldStop: () => ({ stop: "hook", reason: "enough" }) },
    ...determinism(),
  });
  const { result } = await drive(started);
  assert.equal(result.stopReason, "stopped");
  const error = await pending;
  assert.ok(isSdkError(error) && error.code === "undelivered_message");
});

test("an empty message, or a block that isn't text or an image, rejects with invalid_run_options", async () => {
  const { model } = scripted([text("Done.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  const toolBlock = [{ type: "tool_call", callId: "x", name: "y", input: {} }] as unknown as ContentBlock[];
  const image: ContentBlock = { type: "image", mediaType: "image/png", data: "AAAA" };
  void started.steer([image]);
  const refused = ["", [], toolBlock].map((bad) => rejection(started.steer(bad)));
  for (const error of await Promise.all(refused)) {
    assert.ok(isSdkError(error) && error.code === "invalid_run_options");
  }
  const { result } = await drive(started);
  assert.deepEqual(result.messages[1], { role: "user", content: [image] });
});

test("continueRun carries an applied steer in its context", async () => {
  const { model } = scripted([text("Ok.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  void started.steer("Be brief.");
  const { result } = await drive(started);
  assert.deepEqual(userTexts(result.context.messages), ["Go.", "Be brief."]);
});

async function undeliveredBy(promise: Promise<unknown>): Promise<void> {
  const error = await rejection(promise);
  assert.ok(isSdkError(error) && error.code === "undelivered_message", `expected undelivered_message, got ${error}`);
}

test("a programmer error that rejects the run also rejects waiting and later messages", async () => {
  const broken = defineTool({
    name: "broken",
    description: "Returns a malformed result.",
    inputSchema: { type: "object" },
    // @ts-expect-error: a tool must return a result with content
    async execute() {
      return {};
    },
  });
  let started: Run | undefined;
  let waiting: Promise<void> | undefined;
  const { model } = scripted([
    () => {
      waiting = undeliveredBy(started?.steer("x") ?? Promise.reject(new Error("no run")));
      return { content: [{ type: "tool_call", callId: "a", name: "broken", input: {} }] };
    },
  ]);
  started = run({ model, system: SYSTEM, input: "Go.", tools: [broken], ...determinism() });
  await assert.rejects(started.result, (error: unknown) => isSdkError(error) && error.code === "invalid_tool_result");
  await waiting;
  await undeliveredBy(started.followUp("y"));
});

test("a shouldStop hook that ends a text-answered run wins over a waiting steer", async () => {
  let started: Run | undefined;
  let waiting: Promise<void> | undefined;
  const { adapter, model } = scripted([
    () => {
      waiting = undeliveredBy(started?.steer("also X") ?? Promise.reject(new Error("no run")));
      return text("Done.");
    },
  ]);
  started = run({
    model,
    system: SYSTEM,
    input: "Go.",
    interceptors: { shouldStop: () => ({ stop: "hook", reason: "budget policy" }) },
    ...determinism(),
  });
  const { result } = await drive(started);
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 1);
  assert.equal(adapter.calls.length, 1);
  await waiting;
});

test("an abort that comes after a finished answer still ends the run done while a steer waits", async () => {
  let started: Run | undefined;
  let waiting: Promise<void> | undefined;
  const { model } = scripted([
    () => {
      waiting = undeliveredBy(started?.steer("also X") ?? Promise.reject(new Error("no run")));
      return text("The answer.");
    },
  ]);
  started = run({
    model,
    system: SYSTEM,
    input: "Go.",
    interceptors: {
      shouldStop: () => {
        started?.abort("late");
        return false;
      },
    },
    ...determinism(),
  });
  const { result } = await drive(started);
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 1);
  await waiting;
});

test("changing a receipt's message does not change the transcript", async () => {
  const { adapter, model } = scripted([text("Ok.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  const sent = started.steer("Be brief.");
  const driven = drive(started);
  const receipt = await sent;
  (receipt.message as ContentBlock[]).push({ type: "text", text: "injected" });
  const { result } = await driven;
  assert.deepEqual(userTexts(result.messages), ["Go.", "Be brief."]);
  assert.deepEqual(userTexts(adapter.calls[0]?.context.messages ?? []), ["Go.", "Be brief."]);
});

test("a blank message or text block is refused, and a block keeps only its own fields", async () => {
  const { model } = scripted([text("Done.")]);
  const started = run({ model, system: SYSTEM, input: "Go.", ...determinism() });
  const blank: ContentBlock[] = [{ type: "text", text: "" }];
  const spaces: ContentBlock[] = [{ type: "text", text: "  " }];
  const extra = [{ type: "text", text: "Be brief.", cache: true }] as unknown as ContentBlock[];
  void started.steer(extra);
  const refused = ["  ", blank, spaces].map((bad) => rejection(started.steer(bad)));
  for (const error of await Promise.all(refused)) {
    assert.ok(isSdkError(error) && error.code === "invalid_run_options");
  }
  const { result } = await drive(started);
  assert.deepEqual(result.messages[1], { role: "user", content: [{ type: "text", text: "Be brief." }] });
});

test("a follow-up and a later steer that meet at one boundary are applied in the order they were sent", async () => {
  let started: Run | undefined;
  const { adapter, model } = scripted([
    () => {
      void started?.followUp("first sent");
      return text("Answer.");
    },
    text("Next."),
    text("Last."),
  ]);
  started = run({
    model,
    system: SYSTEM,
    input: "Go.",
    observers: [
      (event) => {
        // The follow-up is waiting and the run was kept going for it; this steer arrives before the next step.
        if (event.type === "step_end") void started?.steer("second sent");
      },
    ],
    ...determinism(),
  });
  const { events } = await drive(started);
  assert.deepEqual(
    applied(events).map((event) => event.receipt.id.split(":").pop()),
    ["message-1", "message-2"],
  );
  assert.deepEqual(userTexts(adapter.calls[1]?.context.messages ?? []), ["Go.", "first sent", "second sent"]);
});

test("a steer or follow-up that nobody awaits never becomes an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    let started: Run | undefined;
    const { model } = scripted([
      () => {
        void started?.followUp("never applied");
        return text("Done.");
      },
    ]);
    started = run({ model, system: SYSTEM, input: "Go.", maxSteps: 1, ...determinism() });
    await drive(started);
    void started.steer("after the end");
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off("unhandledRejection", record);
  }
  assert.deepEqual(unhandled, []);
});
