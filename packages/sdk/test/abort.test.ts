import assert from "node:assert/strict";
import { createModel, type Message, type ModelMiddleware } from "@buildanagent/gateway";
import { defineTool, run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { determinism, drive, lookup, scripted, text, toolCall, typesOf } from "./run-helpers.js";

const SYSTEM = "You look up orders.";

/** A tool that aborts the run through `controller`, then waits for its own signal and throws, as an I/O call would. */
function abortingTool(controller: AbortController) {
  return defineTool({
    name: "slow_lookup",
    description: "Look up an order slowly.",
    inputSchema: { type: "object" },
    async execute(_input, ctx) {
      controller.abort("user cancelled");
      await new Promise((resolve) => {
        if (ctx.signal.aborted) resolve(undefined);
        else ctx.signal.addEventListener("abort", resolve, { once: true });
      });
      throw new Error("the lookup was cancelled");
    },
  });
}

/** A middleware that aborts `controller` after the first text delta of a call. */
function abortAfterFirstDelta(controller: AbortController): ModelMiddleware {
  return {
    async *wrapStream({ next }) {
      for await (const event of next()) {
        yield event;
        if (event.type === "text_delta") controller.abort();
      }
    },
  };
}

async function abortedMidTool() {
  const controller = new AbortController();
  const twoCalls = { content: [...toolCall("slow_lookup", {}).content, ...toolCall("lookup", { order: 1 }).content] };
  const { adapter, model } = scripted([twoCalls]);
  const tools = [abortingTool(controller), lookup];
  const driven = await drive(
    run({ model, system: SYSTEM, input: "Go.", tools, signal: controller.signal, ...determinism() }),
  );
  return { adapter, ...driven };
}

function toolResults(messages: readonly Message[]) {
  return messages.flatMap((message) => (message.role === "tool" ? [message] : []));
}

test("aborting mid-tool gives every tool call a result and ends the transcript with an aborted message", async () => {
  const { result } = await abortedMidTool();
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(
    toolResults(result.messages).map((message) => [message.callId, message.isError]),
    [
      ["call-1", true],
      ["call-2", true],
    ],
  );
  const last = result.messages.at(-1);
  assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "aborted");
});

test("aborting mid-tool runs none of the calls that had not started", async () => {
  const { result } = await abortedMidTool();
  const second = result.messages.find((message) => message.role === "tool" && message.callId === "call-2");
  const text = second?.role === "tool" ? second.content.map((block) => (block.type === "text" ? block.text : "")) : [];
  assert.match(text.join("\n"), /was not run/);
});

test("aborting mid-tool makes no further model call", async () => {
  const { adapter } = await abortedMidTool();
  adapter.assertComplete();
  assert.equal(adapter.calls.length, 1);
});

test("agent_settled is the last event before run_end, after the abort event", async () => {
  const { events } = await abortedMidTool();
  const types = typesOf(events);
  assert.deepEqual(types.slice(-2), ["agent_settled", "run_end"]);
  assert.ok(types.indexOf("abort") < types.indexOf("agent_settled"));
});

test("the abort event carries the abort reason", async () => {
  const { events } = await abortedMidTool();
  const abort = events.find((event) => event.type === "abort");
  assert.equal(abort?.type === "abort" ? abort.reason : undefined, "user cancelled");
});

test("an abort mid-stream ends the run with the partial response as its last message", async () => {
  const controller = new AbortController();
  const { model } = scripted([text("Order 42 has shipped.")], { middleware: [abortAfterFirstDelta(controller)] });
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", signal: controller.signal }));
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(result.messages.at(-1)?.content, [{ type: "text", text: "Orde" }]);
});

test("an abort mid-stream gives a finished tool call a result and ends with an aborted message", async () => {
  const controller = new AbortController();
  const response = { content: [...toolCall("lookup", { order: 1 }).content, ...text("Looking it up now.").content] };
  const { model } = scripted([response], { middleware: [abortAfterFirstDelta(controller)] });
  const { result } = await drive(
    run({ model, system: SYSTEM, input: "Go.", tools: [lookup], signal: controller.signal }),
  );
  assert.deepEqual(
    toolResults(result.messages).map((message) => [message.callId, message.isError]),
    [["call-1", true]],
  );
  const last = result.messages.at(-1);
  assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "aborted");
});

test("a run whose signal is already aborted makes no model call and ends aborted", async () => {
  const { adapter, model } = scripted([text("Hi.")]);
  const { result, events } = await drive(
    run({ model, system: SYSTEM, input: "Hi.", signal: AbortSignal.abort("stop") }),
  );
  assert.equal(adapter.calls.length, 0);
  assert.equal(result.stopReason, "aborted");
  assert.equal(result.steps, 0);
  assert.deepEqual(typesOf(events), ["run_start", "abort", "agent_settled", "run_end"]);
});

test("an aborted run's cost and its closing message's cost are the same exact zero, even for an unpriced model", async () => {
  const { result } = await drive(
    run({ model: scripted([text("Hi.")]).model, system: SYSTEM, input: "Hi.", signal: AbortSignal.abort() }),
  );
  const zero = { total: 0, basis: "provider", currency: "USD" };
  assert.deepEqual(result.cost, zero);
  const last = result.messages.at(-1);
  assert.deepEqual(last?.role === "assistant" ? last.cost : undefined, zero);
});

test("run.abort() stops the run like the signal option", async () => {
  const { model } = scripted([text("Hi.")]);
  const started = run({ model, system: SYSTEM, input: "Hi." });
  started.abort("changed my mind");
  const { result, events } = await drive(started);
  assert.equal(result.stopReason, "aborted");
  assert.ok(events.some((event) => event.type === "abort" && event.reason === "changed my mind"));
});

test("run.abort() after the run ended adds no event", async () => {
  const started = run({ model: scripted([text("Hi.")]).model, system: SYSTEM, input: "Hi." });
  const before = (await drive(started)).events.length;
  started.abort();
  const after = (await drive(started)).events.length;
  assert.equal(after, before);
});

test("agent_settled fires only after an aborted retry has stopped", async () => {
  const controller = new AbortController();
  const adapter = new ScriptedModel([
    { content: [], error: { kind: "retryable", message: "overloaded", status: 529 } },
  ]);
  const sleep = async () => controller.abort();
  const model = createModel({ adapter, id: "m", retries: 2, sleep });
  const { events, result } = await drive(run({ model, system: SYSTEM, input: "Hi.", signal: controller.signal }));
  const types = typesOf(events);
  assert.equal(result.stopReason, "aborted");
  assert.ok(types.lastIndexOf("retry") < types.indexOf("agent_settled"));
  assert.ok(types.indexOf("model_call_end") < types.indexOf("agent_settled"));
  assert.deepEqual(types.slice(-2), ["agent_settled", "run_end"]);
});
