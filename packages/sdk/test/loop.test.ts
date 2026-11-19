import assert from "node:assert/strict";
import { createModel, type Message, type PriceCatalog } from "@buildanagent/gateway";
import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  clarificationTool,
  continueRun,
  defineTool,
  isSdkError,
  outputTool,
  RunStoppedError,
  run,
  runOrThrow,
} from "@buildanagent/sdk";
import { ScriptedModel, sequentialIds } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { z } from "zod";
import { determinism, drive, lookup, scripted, text, toolCall } from "./run-helpers.js";

const SYSTEM = "You look up orders.";

test("a two-step run with one tool call ends done, and its messages hold the call and the result", async () => {
  const { adapter, model } = scripted([toolCall("lookup", { order: 42 }), text("Order 42 has shipped.")]);
  const { result } = await drive(
    run({ model, system: SYSTEM, input: "Where is order 42?", tools: [lookup], ...determinism() }),
  );
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 2);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["user", "assistant", "tool", "assistant"],
  );
  const [, call, toolResult] = result.messages;
  assert.deepEqual(call?.role === "assistant" ? call.content : undefined, [
    { type: "tool_call", callId: "call-1", name: "lookup", input: { order: 42 } },
  ]);
  assert.deepEqual(toolResult, {
    role: "tool",
    callId: "call-1",
    content: [{ type: "text", text: 'order {"order":42} is shipped' }],
    isError: false,
  });
});

test("a run that keeps calling tools ends max_steps after exactly 20 model calls", async () => {
  const { adapter, model } = scripted(Array.from({ length: 20 }, () => toolCall("lookup", { order: 1 })));
  const { result } = await drive(run({ model, system: SYSTEM, input: "Loop.", tools: [lookup], ...determinism() }));
  adapter.assertComplete();
  assert.equal(adapter.calls.length, 20);
  assert.equal(result.stopReason, "max_steps");
  assert.equal(result.steps, 20);
});

test("reaching the cap emits one warning event with code max_steps, a type AGENT_EVENT_TYPES lists", async () => {
  const { model } = scripted([toolCall("lookup", { order: 1 }), toolCall("lookup", { order: 2 })]);
  const { events } = await drive(run({ model, system: SYSTEM, input: "Loop.", tools: [lookup], maxSteps: 2 }));
  const warnings = events.filter((event) => event.type === "warning");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.type === "warning" ? warnings[0].code : undefined, "max_steps");
  assert.ok(AGENT_EVENT_TYPES.includes("warning"));
});

test("the last response's tool calls still get results when the cap stops the run", async () => {
  const { model } = scripted([toolCall("lookup", { order: 1 })]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Once.", tools: [lookup], maxSteps: 1 }));
  assert.equal(result.stopReason, "max_steps");
  assert.equal(result.messages.at(-1)?.role, "tool");
});

const answer = outputTool({ name: "final_answer", schema: z.object({ total: z.number() }) });

test("a run whose only tool is an output tool ends done after one valid call, with the answer as output", async () => {
  const { adapter, model } = scripted([toolCall("final_answer", { total: 12 })]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Sum it.", output: answer, ...determinism() }));
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 1);
  assert.deepEqual(result.stopReason === "done" ? result.output : undefined, { total: 12 });
});

test("an output call that fails its schema spends one model call of maxSteps", async () => {
  const { adapter, model } = scripted([
    toolCall("final_answer", { total: "twelve" }),
    toolCall("final_answer", { total: 12 }),
  ]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Sum it.", output: answer, maxSteps: 2 }));
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 2);
});

test("an output call that fails its schema on the last allowed call ends max_steps", async () => {
  const { model } = scripted([toolCall("final_answer", { total: "twelve" })]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Sum it.", output: answer, maxSteps: 1 }));
  assert.equal(result.stopReason, "max_steps");
});

test("an output tool also listed in tools is sent once", async () => {
  const { adapter, model } = scripted([toolCall("final_answer", { total: 1 })]);
  await drive(run({ model, system: SYSTEM, input: "Sum it.", tools: [answer, lookup], output: answer }));
  assert.deepEqual(
    adapter.calls[0]?.context.tools.map((tool) => tool.name),
    ["final_answer", "lookup"],
  );
});

test("an adapter overflow error ends the run error with error.kind overflow and the status", async () => {
  const error = { kind: "overflow" as const, message: "prompt is too long", status: 400 };
  const { model } = scripted([{ content: [], error }]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Too long." }));
  assert.equal(result.stopReason, "error");
  assert.deepEqual(result.stopReason === "error" ? result.error : undefined, error);
});

for (const kind of ["quota", "retryable", "fatal"] as const) {
  test(`an adapter ${kind} error ends the run error with error.kind ${kind}`, async () => {
    const { model } = scripted([{ content: [], error: { kind, message: `a ${kind} failure` } }]);
    const { result } = await drive(run({ model, system: SYSTEM, input: "Fail." }));
    assert.deepEqual(result.stopReason === "error" ? result.error : undefined, { kind, message: `a ${kind} failure` });
  });
}

test("a failed response's tool calls get error results and none runs", async () => {
  let ran = false;
  const tool = defineTool({
    name: "lookup",
    description: "Look up an order.",
    inputSchema: { type: "object" },
    async execute() {
      ran = true;
      return { content: [] };
    },
  });
  const failed = { ...toolCall("lookup", {}), error: { kind: "fatal" as const, message: "broken" } };
  const { result } = await drive(run({ model: scripted([failed]).model, system: SYSTEM, input: "Go.", tools: [tool] }));
  assert.equal(ran, false);
  assert.deepEqual(
    result.messages.map((message) => (message.role === "tool" ? message.isError : message.role)),
    ["user", "assistant", true],
  );
});

const archive = defineTool({ ...lookup, name: "archive", exposure: "deferred" });
const audit = defineTool({ ...lookup, name: "audit", exposure: "hidden" });

test("deferred and hidden tools are absent from every recorded request", async () => {
  const { adapter, model } = scripted([toolCall("lookup", { order: 1 }), text("Done.")]);
  await drive(run({ model, system: SYSTEM, input: "Go.", tools: [archive, lookup, audit] }));
  assert.equal(adapter.calls.length, 2);
  for (const request of adapter.calls) {
    assert.deepEqual(
      request.context.tools.map((tool) => tool.name),
      ["lookup"],
    );
  }
});

test("a call to a deferred tool gets the unknown-tool error result", async () => {
  const { model } = scripted([toolCall("archive", { order: 1 }), text("Done.")]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", tools: [archive, lookup] }));
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.role === "tool" ? toolMessage.isError : undefined, true);
});

test("each request sends the tool's name, description and JSON Schema", async () => {
  const { adapter, model } = scripted([text("Hi.")]);
  await drive(run({ model, system: SYSTEM, input: "Hi.", tools: [lookup] }));
  assert.deepEqual(adapter.calls[0]?.context.tools, [
    {
      name: "lookup",
      description: "Look up an order.",
      inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
    },
  ]);
});

test("each request sends the system prompt and the model options", async () => {
  const { adapter, model } = scripted([text("Hi.")]);
  await drive(run({ model, system: SYSTEM, input: "Hi.", modelOptions: { maxOutputTokens: 256, temperature: 0 } }));
  assert.equal(adapter.calls[0]?.context.system, SYSTEM);
  assert.deepEqual(adapter.calls[0]?.options, { maxOutputTokens: 256, temperature: 0 });
});

test("result.messages holds this run's messages, and context.messages the history too", async () => {
  const history: Message[] = [
    { role: "user", content: [{ type: "text", text: "Hello." }] },
    { ...(await scripted([text("Hi.")]).model.complete({ system: "", messages: [], tools: [] })) },
  ];
  const { result } = await drive(
    run({ model: scripted([text("Fine.")]).model, system: SYSTEM, input: "How?", history }),
  );
  assert.equal(result.messages.length, 2);
  assert.equal(result.context.messages.length, 4);
  assert.deepEqual(result.context.messages.slice(0, 2), history);
  assert.equal(result.context.system, SYSTEM);
});

test("usage is summed over every model call", async () => {
  const { model } = scripted([
    { ...toolCall("lookup", { order: 1 }), usage: { uncachedInput: 10, output: 5 } },
    { ...text("Done."), usage: { uncachedInput: 20, output: 7 } },
  ]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", tools: [lookup] }));
  assert.equal(result.usage.uncachedInput, 30);
  assert.equal(result.usage.output, 12);
});

test("cost is summed over every model call, priced from the model's catalog", async () => {
  const rates = { uncachedInput: 1, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 2, upToInputTokens: null };
  const source = "https://provider.test/pricing";
  const catalog: PriceCatalog = {
    models: [
      {
        provider: "scripted",
        id: "priced",
        rates: [rates],
        contextWindow: 1000,
        maxOutputTokens: 100,
        asOf: "2026-11-01",
        sources: { rates: source, contextWindow: source, maxOutputTokens: source },
      },
    ],
  };
  const adapter = new ScriptedModel([
    { ...toolCall("lookup", { order: 1 }), usage: { uncachedInput: 1_000_000 } },
    { ...text("Done."), usage: { output: 1_000_000 } },
  ]);
  const model = createModel({ adapter, id: "priced", catalog });
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", tools: [lookup] }));
  assert.deepEqual(result.cost, { total: 3, basis: "catalog", currency: "USD", catalogAsOf: "2026-11-01" });
});

test("a model whose price is unknown gives the run an unknown cost", async () => {
  const { result } = await drive(run({ model: scripted([text("Hi.")]).model, system: SYSTEM, input: "Hi." }));
  assert.deepEqual(result.cost, { total: null, basis: "unknown", currency: "USD" });
});

test("continueRun goes on from a max_steps context, and its messages hold only what it adds", async () => {
  const first = await drive(
    run({
      model: scripted([toolCall("lookup", { order: 1 })]).model,
      system: SYSTEM,
      input: "Go.",
      tools: [lookup],
      maxSteps: 1,
    }),
  );
  const { adapter, model } = scripted([text("Order 1 has shipped.")]);
  const { result } = await drive(continueRun(first.result.context, { model, tools: [lookup] }));
  assert.equal(result.stopReason, "done");
  assert.deepEqual(adapter.calls[0]?.context.messages, first.result.context.messages);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["assistant"],
  );
});

test("runOrThrow returns the result of a done run", async () => {
  const result = await runOrThrow(run({ model: scripted([text("Hi.")]).model, system: SYSTEM, input: "Hi." }));
  assert.equal(result.stopReason, "done");
});

test("runOrThrow on a max_steps run throws a RunStoppedError that carries the context", async () => {
  const { model } = scripted([toolCall("lookup", { order: 1 })]);
  const started = run({ model, system: SYSTEM, input: "Go.", tools: [lookup], maxSteps: 1 });
  const error = await runOrThrow(started).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  assert.ok(RunStoppedError.isInstance(error));
  assert.equal(error.stopReason, "max_steps");
  assert.deepEqual(error.context, (await started.result).context);
  assert.ok(isSdkError(error) && error.code === "run_stopped");
});

test("RunStoppedError.isInstance is false for other errors", () => {
  assert.equal(RunStoppedError.isInstance(new Error("no")), false);
  assert.equal(RunStoppedError.isInstance("no"), false);
});

test("run() throws SdkError invalid_run_options for a model that isn't from createModel()", () => {
  assert.throws(
    // @ts-expect-error: a bare model id is a type error too
    () => run({ model: "claude-sonnet-4-5", system: SYSTEM, input: "Hi." }),
    (error: unknown) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("run() throws SdkError invalid_run_options for a maxSteps below 1", () => {
  assert.throws(
    () => run({ model: scripted([]).model, system: SYSTEM, input: "Hi.", maxSteps: 0 }),
    (error: unknown) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("run() throws SdkError invalid_tool_definition for two tools with one name", () => {
  assert.throws(
    () => run({ model: scripted([]).model, system: SYSTEM, input: "Hi.", tools: [lookup, defineTool({ ...lookup })] }),
    (error: unknown) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});

test("a tool that returns a malformed result rejects the result with SdkError and keeps earlier results", async () => {
  const broken = defineTool({
    name: "broken",
    description: "Returns a malformed result.",
    inputSchema: { type: "object" },
    // @ts-expect-error: a tool must return a result with content
    async execute() {
      return { text: "no content" };
    },
  });
  const { model } = scripted([
    { content: [...toolCall("lookup", { order: 1 }).content, ...toolCall("broken", {}).content] },
  ]);
  const started = run({ model, system: SYSTEM, input: "Go.", tools: [lookup, broken] });
  await assert.rejects(started.result, (error: unknown) => isSdkError(error) && error.code === "invalid_tool_result");
  const events: AgentEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const event of started) events.push(event);
    },
    (error: unknown) => isSdkError(error) && error.code === "invalid_tool_result",
  );
  assert.equal(events.filter((event) => event.type === "tool_call_end").length, 1);
});

test("the call id the model sends reaches its tool result", async () => {
  const adapter = new ScriptedModel([toolCall("lookup", { order: 1 }, "toolu_1"), text("Done.")], {
    idGenerator: sequentialIds("unused"),
  });
  const { result } = await drive(
    run({ model: createModel({ adapter, id: "m" }), system: SYSTEM, input: "Go.", tools: [lookup] }),
  );
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.role === "tool" ? toolMessage.callId : undefined, "toolu_1");
});

test("a text answer cut off at the output limit ends done, and its message keeps stopReason length", async () => {
  const { result } = await drive(
    run({ model: scripted([{ ...text("The order is"), stopReason: "length" }]).model, system: SYSTEM, input: "Hi." }),
  );
  assert.equal(result.stopReason, "done");
  const last = result.messages.at(-1);
  assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "length");
});

test("a clarification question ends the run clarification_requested and makes no further call", async () => {
  const { adapter, model } = scripted([toolCall("ask_user", { question: "Which order?" })]);
  const { result } = await drive(
    run({ model, system: SYSTEM, input: "Where is my order?", tools: [clarificationTool()], ...determinism() }),
  );
  adapter.assertComplete();
  assert.equal(result.stopReason, "clarification_requested");
  // The asking call waits for the answer, so it has no result yet.
  assert.equal(result.messages.at(-1)?.role, "assistant");
});

test("run() throws SdkError invalid_run_options for an output tool that isn't sent to the model", () => {
  const answer = outputTool({ name: "answer", schema: z.object({ status: z.string() }) });
  assert.throws(
    () => run({ model: scripted([]).model, system: SYSTEM, input: "Hi.", output: { ...answer, exposure: "deferred" } }),
    (error: unknown) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("model_call_start records no signal or caps that an untyped caller put in modelOptions", async () => {
  const modelOptions = { maxOutputTokens: 64, signal: new AbortController().signal, caps: {} } as never;
  const { events } = await drive(
    run({ model: scripted([text("Hi.")]).model, system: SYSTEM, input: "Hi.", modelOptions }),
  );
  const start = events.find((event) => event.type === "model_call_start");
  assert.deepEqual(start?.type === "model_call_start" ? start.request.options : undefined, { maxOutputTokens: 64 });
});
