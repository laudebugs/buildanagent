// The OTel observer: spans for the run, each model call and each tool call, usage that matches the SDK's own sums,
// content that stays off until asked for, and attribute names that all come from one constants file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { totalInput } from "@buildanagent/gateway";
import type { AgentEvent, RunResult } from "@buildanagent/sdk";
import { defineTool } from "@buildanagent/sdk";
import {
  GEN_AI_ATTRIBUTES,
  GEN_AI_CONTENT_ATTRIBUTES,
  otelObserver,
  SEMCONV_GENAI_COMMIT,
  type SpanLike,
  type TracerLike,
} from "@buildanagent/sdk/otel";
import { sequentialIds } from "@buildanagent/sdk/testing";
import { context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { expect, test } from "vitest";
import { drivenRun } from "./hook-helpers.js";
import { lookup, text, toolCall } from "./run-helpers.js";

const USAGE_ONE = { uncachedInput: 100, cacheRead: 40, cacheWrite: { "5m": 10, "1h": 5 }, output: 30, reasoning: 7 };
const USAGE_TWO = { uncachedInput: 20, cacheRead: 150, cacheWrite: { "5m": 0, "1h": 0 }, output: 12, reasoning: 0 };

/** A real tracer provider behind an in-memory exporter, and an observer wired to its tracer with real contexts. */
function setup(options: { captureContent?: boolean; agentName?: string } = {}) {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  const tracer = provider.getTracer("test");
  const observer = otelObserver({
    tracer,
    childContext: (parent) => trace.setSpan(context.active(), parent as Span),
    forceFlush: () => provider.forceFlush(),
    ...options,
  });
  return { exporter, observer };
}

function byOperation(spans: readonly ReadableSpan[], operation: string): ReadableSpan[] {
  return spans.filter((span) => span.attributes[GEN_AI_ATTRIBUTES.operationName] === operation);
}

async function toolRun(observer: ReturnType<typeof otelObserver>) {
  return drivenRun(
    [
      { ...toolCall("lookup", { order: 1 }), usage: USAGE_ONE },
      { ...text("Shipped."), usage: USAGE_TWO },
    ],
    {},
    { tools: [lookup], observers: [observer] },
  );
}

test("a run with one tool call yields one agent span, one span per model call and one tool span, nested", async () => {
  const { exporter, observer } = setup();
  await toolRun(observer);
  const spans = exporter.getFinishedSpans();
  const agent = byOperation(spans, "invoke_agent");
  const chats = byOperation(spans, "chat");
  const tools = byOperation(spans, "execute_tool");
  assert.equal(spans.length, 4);
  assert.equal(agent.length, 1);
  assert.equal(chats.length, 2);
  assert.equal(tools.length, 1);
  const root = agent[0] as ReadableSpan;
  assert.equal(root.parentSpanContext, undefined);
  for (const child of [...chats, ...tools]) {
    assert.equal(child.parentSpanContext?.spanId, root.spanContext().spanId);
    assert.equal(child.spanContext().traceId, root.spanContext().traceId);
  }
  assert.equal(root.name, "invoke_agent");
  assert.deepEqual(
    chats.map((span) => span.name),
    ["chat scripted-model", "chat scripted-model"],
  );
  assert.equal((tools[0] as ReadableSpan).name, "execute_tool lookup");
  assert.equal((tools[0] as ReadableSpan).attributes[GEN_AI_ATTRIBUTES.toolName], "lookup");
});

test("the agent's name names its span and sets gen_ai.agent.name", async () => {
  const { exporter, observer } = setup({ agentName: "triage" });
  await toolRun(observer);
  const root = byOperation(exporter.getFinishedSpans(), "invoke_agent")[0] as ReadableSpan;
  assert.equal(root.name, "invoke_agent triage");
  assert.equal(root.attributes[GEN_AI_ATTRIBUTES.agentName], "triage");
});

test("each model call's input_tokens equals totalInput() of its usage, and the agent span sums the calls", async () => {
  const { exporter, observer } = setup();
  const { events, result } = await toolRun(observer);
  const ends = events.filter(
    (event): event is Extract<AgentEvent, { type: "model_call_end" }> => event.type === "model_call_end",
  );
  const chats = byOperation(exporter.getFinishedSpans(), "chat");
  assert.equal(chats.length, ends.length);
  for (const [index, end] of ends.entries()) {
    const attributes = (chats[index] as ReadableSpan).attributes;
    assert.equal(attributes[GEN_AI_ATTRIBUTES.usageInputTokens], totalInput(end.message.usage));
    assert.equal(attributes[GEN_AI_ATTRIBUTES.usageOutputTokens], end.message.usage.output);
  }
  const first = (chats[0] as ReadableSpan).attributes;
  assert.equal(first[GEN_AI_ATTRIBUTES.usageInputTokens], 155);
  assert.equal(first[GEN_AI_ATTRIBUTES.usageCacheReadInputTokens], 40);
  assert.equal(first[GEN_AI_ATTRIBUTES.usageCacheWriteInputTokens], 15);
  assert.equal(first[GEN_AI_ATTRIBUTES.usageReasoningOutputTokens], 7);
  const second = (chats[1] as ReadableSpan).attributes;
  assert.equal(GEN_AI_ATTRIBUTES.usageCacheWriteInputTokens in second, false, "zero cache writes are left out");
  const root = (byOperation(exporter.getFinishedSpans(), "invoke_agent")[0] as ReadableSpan).attributes;
  assert.equal(root[GEN_AI_ATTRIBUTES.usageInputTokens], totalInput(result.usage));
  assert.equal(root[GEN_AI_ATTRIBUTES.usageInputTokens], 155 + 170);
  assert.equal(root[GEN_AI_ATTRIBUTES.usageOutputTokens], 42);
});

test("a call's finish reason and response model are recorded", async () => {
  const { exporter, observer } = setup();
  await toolRun(observer);
  const chats = byOperation(exporter.getFinishedSpans(), "chat");
  assert.deepEqual((chats[0] as ReadableSpan).attributes[GEN_AI_ATTRIBUTES.responseFinishReasons], ["tool_calls"]);
  assert.deepEqual((chats[1] as ReadableSpan).attributes[GEN_AI_ATTRIBUTES.responseFinishReasons], ["stop"]);
  assert.equal((chats[0] as ReadableSpan).attributes[GEN_AI_ATTRIBUTES.responseModel], "scripted-model");
});

test("no content attribute appears on any span unless captureContent is true", async () => {
  const { exporter, observer } = setup();
  await toolRun(observer);
  for (const span of exporter.getFinishedSpans()) {
    for (const name of GEN_AI_CONTENT_ATTRIBUTES) assert.equal(name in span.attributes, false, `${span.name}: ${name}`);
  }
  const serialized = JSON.stringify(exporter.getFinishedSpans().map((span) => span.attributes));
  assert.equal(serialized.includes("You look up orders"), false);
  assert.equal(serialized.includes("is shipped"), false);
});

test("captureContent: true records the prompt, the messages and the tool's arguments and result", async () => {
  const { exporter, observer } = setup({ captureContent: true });
  await toolRun(observer);
  const spans = exporter.getFinishedSpans();
  const tool = (byOperation(spans, "execute_tool")[0] as ReadableSpan).attributes;
  assert.deepEqual(JSON.parse(String(tool[GEN_AI_ATTRIBUTES.toolCallArguments])), { order: 1 });
  assert.deepEqual(JSON.parse(String(tool[GEN_AI_ATTRIBUTES.toolCallResult])), [
    { type: "text", content: 'order {"order":1} is shipped' },
  ]);
  const chats = byOperation(spans, "chat");
  const firstAttributes = (chats[0] as ReadableSpan).attributes;
  assert.deepEqual(JSON.parse(String(firstAttributes[GEN_AI_ATTRIBUTES.systemInstructions])), [
    { type: "text", content: "You look up orders." },
  ]);
  assert.deepEqual(JSON.parse(String(firstAttributes[GEN_AI_ATTRIBUTES.inputMessages])), [
    { role: "user", parts: [{ type: "text", content: "Go." }] },
  ]);
  const output = JSON.parse(String(firstAttributes[GEN_AI_ATTRIBUTES.outputMessages])) as Array<{ parts: unknown[] }>;
  assert.equal(output[0]?.parts.length, 1);
  const second = JSON.parse(String((chats[1] as ReadableSpan).attributes[GEN_AI_ATTRIBUTES.inputMessages])) as Array<{
    role: string;
  }>;
  assert.deepEqual(
    second.map((message) => message.role),
    ["user", "assistant", "tool"],
  );
});

/** A tracer that records every span name, attribute name and status the observer writes. */
function recordingTracer() {
  const attributeNames = new Set<string>();
  const spanNames: string[] = [];
  const starts: Array<{ context: unknown }> = [];
  const tracer: TracerLike = {
    startSpan(name, options, spanContext) {
      spanNames.push(name);
      starts.push({ context: spanContext });
      for (const key of Object.keys(options?.attributes ?? {})) attributeNames.add(key);
      const span: SpanLike = {
        setAttribute(key) {
          attributeNames.add(key);
          return span;
        },
        setStatus: () => span,
        end: () => undefined,
      };
      return span;
    },
  };
  return { attributeNames, spanNames, starts, tracer };
}

test("every attribute name the observer writes comes from GEN_AI_ATTRIBUTES, content and failures included", async () => {
  const { attributeNames, tracer } = recordingTracer();
  const failing = defineTool({
    name: "fail",
    description: "Always fails.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "no" }], isError: true };
    },
  });
  const observer = otelObserver({ tracer, captureContent: true, agentName: "a" });
  await drivenRun(
    [
      { ...toolCall("fail", {}), usage: USAGE_ONE },
      { ...text("Sorry."), usage: USAGE_TWO },
    ],
    {},
    { tools: [failing], observers: [observer], temperature: 0.2, maxOutputTokens: 500 } as never,
  );
  const allowed = new Set<string>(Object.values(GEN_AI_ATTRIBUTES));
  assert.ok(attributeNames.size > 15);
  for (const name of attributeNames) assert.ok(allowed.has(name), `${name} is not in GEN_AI_ATTRIBUTES`);
  assert.ok(attributeNames.has(GEN_AI_ATTRIBUTES.errorType), "the failing tool sets error.type");
});

test("a failing tool's span has an error status and error.type", async () => {
  const { exporter, observer } = setup();
  const failing = defineTool({
    name: "fail",
    description: "Always fails.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "no" }], isError: true };
    },
  });
  await drivenRun([toolCall("fail", {}), text("Sorry.")], {}, { tools: [failing], observers: [observer] });
  const tool = byOperation(exporter.getFinishedSpans(), "execute_tool")[0] as ReadableSpan;
  assert.equal(tool.status.code, SpanStatusCode.ERROR);
  assert.equal(tool.attributes[GEN_AI_ATTRIBUTES.errorType], "tool_error");
});

test("a model call that fails marks its span and the agent's span as errors", async () => {
  const { exporter, observer } = setup();
  await drivenRun(
    [{ content: [], error: { kind: "fatal", message: "bad request", status: 400 } }],
    {},
    { observers: [observer] },
  );
  const spans = exporter.getFinishedSpans();
  const chat = byOperation(spans, "chat")[0] as ReadableSpan;
  assert.equal(chat.status.code, SpanStatusCode.ERROR);
  assert.equal(chat.attributes[GEN_AI_ATTRIBUTES.errorType], "400");
  const agent = byOperation(spans, "invoke_agent")[0] as ReadableSpan;
  assert.equal(agent.status.code, SpanStatusCode.ERROR);
  assert.equal(agent.attributes[GEN_AI_ATTRIBUTES.errorType], "fatal");
});

test("a usage the provider did not report writes no token attributes", async () => {
  const { exporter, observer } = setup();
  await drivenRun([{ ...text("Hi."), usage: { unreported: true } }], {}, { observers: [observer] });
  const chat = byOperation(exporter.getFinishedSpans(), "chat")[0] as ReadableSpan;
  assert.equal(GEN_AI_ATTRIBUTES.usageInputTokens in chat.attributes, false);
});

test("the caller's trace context reaches the run's span, and flush() flushes the exporter", async () => {
  const { starts, tracer } = recordingTracer();
  const parentContext = { marker: "incoming request" };
  let flushed = 0;
  const observer = otelObserver({
    tracer,
    parentContext,
    childContext: (parent) => ({ parent }),
    forceFlush: async () => {
      flushed += 1;
    },
  });
  await drivenRun([text("Hi.")], {}, { observers: [observer] });
  assert.equal(starts[0]?.context, parentContext);
  assert.ok((starts[1]?.context as { parent: unknown } | undefined)?.parent, "the model span gets the child context");
  assert.equal(flushed, 0);
  await observer.flush();
  assert.equal(flushed, 1);
  await otelObserver({ tracer }).flush();
});

test("a tracer that throws is reported as a hook_error and the run still finishes", async () => {
  const tracer: TracerLike = {
    startSpan() {
      throw new Error("tracer is down");
    },
  };
  const { events, result } = await drivenRun([text("Hi.")], {}, { observers: [otelObserver({ tracer })] });
  assert.equal(result.stopReason, "done" satisfies RunResult["stopReason"]);
  assert.ok(events.some((event) => event.type === "hook_error" && event.error.includes("tracer is down")));
});

test("one observer keeps the spans of two runs apart", async () => {
  const { exporter, observer } = setup();
  await Promise.all([
    drivenRun([text("One.")], {}, { observers: [observer], idGenerator: sequentialIds("first") }),
    drivenRun([text("Two.")], {}, { observers: [observer], idGenerator: sequentialIds("second") }),
  ]);
  assert.equal(byOperation(exporter.getFinishedSpans(), "invoke_agent").length, 2);
  assert.equal(new Set(exporter.getFinishedSpans().map((span) => span.spanContext().traceId)).size, 2);
});

test("the package exports the pinned convention commit", () => {
  assert.equal(SEMCONV_GENAI_COMMIT, "d28355d");
  expect(Object.isFrozen(GEN_AI_ATTRIBUTES)).toBe(true);
});

test("@opentelemetry/api is not a runtime dependency, and no source file imports it", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    assert.deepEqual(
      Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith("@opentelemetry/")),
      [],
    );
  }
  for (const file of ["attributes", "content", "observer", "index"]) {
    const source = readFileSync(new URL(`../src/otel/${file}.ts`, import.meta.url), "utf8");
    assert.equal(/from "@opentelemetry/.test(source), false, file);
  }
});
