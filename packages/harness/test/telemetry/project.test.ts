// The log projection: the span tree a recorded session gives, what the spans leave out by default, the keyed hash, and
// the price of an unknown model.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isHarnessError } from "@buildanagent/harness";
import { projectSpans } from "@buildanagent/harness/telemetry";
import type { SessionEntry } from "@buildanagent/protocol";
import { GEN_AI_CONTENT_ATTRIBUTES } from "@buildanagent/sdk/otel";
import { beforeAll, describe, test } from "vitest";
import { capstoneEntries, SECRETS } from "./capstone.js";
import { exportSpans, type SpanTree, treeOf } from "./spans.js";

let entries: SessionEntry[] = [];
let unpriced: SessionEntry[] = [];
beforeAll(async () => {
  entries = await capstoneEntries(true);
  unpriced = await capstoneEntries(false);
});

const fixture = (): SpanTree =>
  JSON.parse(readFileSync(new URL("./fixtures/capstone-spans.json", import.meta.url), "utf8")) as SpanTree;

/** Everything a backend would receive from the spans: names, attribute names and values, as one string. */
const everything = (spans: Awaited<ReturnType<typeof exportSpans>>): string =>
  JSON.stringify(spans.map((span) => [span.name, span.attributes, span.status]));

describe("the span tree", () => {
  test("a recorded capstone session projects to the tree its fixture holds", async () => {
    assert.deepEqual(treeOf(await exportSpans(entries)), fixture());
  });

  test("the same entries project to the same tree twice", async () => {
    assert.deepEqual(treeOf(await exportSpans(entries)), treeOf(await exportSpans(entries)));
  });

  test("the approval-wait span lasts from the request entry to the resolution entry", async () => {
    const requested = entries.find((entry) => entry.type === "approval_requested");
    const resolved = entries.find((entry) => entry.type === "approval_resolved");
    assert.ok(requested && resolved);
    const gap = Date.parse(resolved.timestamp) - Date.parse(requested.timestamp);
    const wait = (await exportSpans(entries)).find((span) => span.name === "approval_wait");
    assert.ok(wait);
    assert.equal(wait.duration[0] * 1000 + wait.duration[1] / 1e6, gap);
    assert.ok(gap > 0, "a gap of zero would pass for any bug");
    assert.equal(wait.attributes["buildanagent.approval.decision"], "allow");
  });

  test("a call that waited for a person ends in the turn that resumed it, under the call's own span", async () => {
    const spans = await exportSpans(entries);
    const refund = spans.find((span) => span.name === "execute_tool refund");
    const wait = spans.find((span) => span.name === "approval_wait");
    assert.equal(wait?.parentSpanContext?.spanId, refund?.spanContext().spanId);
    const result = entries.find((entry) => entry.type === "tool_result" && entry.tool === "refund");
    assert.ok(refund && result);
    assert.equal(refund.endTime[0] * 1000 + refund.endTime[1] / 1e6, Date.parse(result.timestamp));
  });

  test("a log that ends while a call waits closes its spans at the last entry and says so", async () => {
    const cut = entries.findIndex((entry) => entry.type === "approval_requested");
    const spans = await exportSpans(entries.slice(0, cut + 1));
    const wait = spans.find((span) => span.name === "approval_wait");
    assert.equal(wait?.attributes["buildanagent.span.unfinished"], true);
    assert.equal(spans.filter((span) => span.attributes["buildanagent.span.unfinished"] === true).length >= 2, true);
  });

  test("an empty log projects no spans, and a stream of entries projects like a list", async () => {
    assert.deepEqual(await exportSpans([]), []);
    async function* stream() {
      yield* entries;
    }
    const spans: Awaited<ReturnType<typeof exportSpans>> = [];
    const { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } = await import("@opentelemetry/sdk-trace");
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
    await projectSpans(stream(), { tracer: provider.getTracer("t"), childContext: () => undefined });
    spans.push(...exporter.getFinishedSpans());
    assert.equal(spans.length, treeCount(fixture()));
  });
});

const treeCount = (tree: SpanTree): number => 1 + tree.children.reduce((sum, child) => sum + treeCount(child), 0);

describe("content", () => {
  test("with default options no span holds a prompt, a message, a tool argument or a tool result", async () => {
    const text = everything(await exportSpans(entries));
    for (const secret of [SECRETS.prompt, SECRETS.argument, SECRETS.result, "Checking the customer"]) {
      assert.ok(!text.includes(secret), `the spans hold ${JSON.stringify(secret)}`);
    }
    assert.ok(!text.includes("gen_ai.input.messages"), "no content attribute is present");
    assert.ok(!text.includes("gen_ai.tool.call.arguments"));
  });

  test("level attributes writes messages and results, and still holds back the arguments", async () => {
    const text = everything(await exportSpans(entries, { content: "attributes" }));
    assert.ok(text.includes(SECRETS.prompt) && text.includes(SECRETS.result));
    assert.ok(!text.includes(SECRETS.argument), "the argument stays out until toolArguments is on");
    assert.ok(text.includes("You triage tickets."), "the system prompt is a content attribute too");
  });

  test("toolArguments writes the arguments alone, whatever the content level", async () => {
    const text = everything(await exportSpans(entries, { toolArguments: true }));
    assert.ok(text.includes(SECRETS.argument));
    assert.ok(!text.includes(SECRETS.prompt) && !text.includes(SECRETS.result));
    const both = everything(await exportSpans(entries, { content: "attributes", toolArguments: true }));
    assert.ok(both.includes(SECRETS.argument) && both.includes(SECRETS.prompt));
  });

  test("level refs writes the ids of the entries that hold the content and none of the text", async () => {
    const spans = await exportSpans(entries, { content: "refs" });
    const text = everything(spans);
    for (const secret of [SECRETS.prompt, SECRETS.argument, SECRETS.result]) assert.ok(!text.includes(secret));
    const refund = spans.find((span) => span.name === "execute_tool refund");
    const result = entries.find((entry) => entry.type === "tool_result" && entry.tool === "refund");
    const refs = refund?.attributes["buildanagent.content.ref"] as string[];
    assert.ok(result && refs.includes(result.id), "the result's entry id is the reference");
    const known = new Set(entries.map((entry) => entry.id));
    assert.ok(
      refs.every((id) => known.has(id)),
      "every reference names an entry of the log",
    );
  });
});

describe("price", () => {
  test("a known price gives every priced span a catalog basis and a dollar cost", async () => {
    const spans = (await exportSpans(entries)).filter((span) => "buildanagent.cost.basis" in span.attributes);
    assert.ok(spans.length >= 5);
    for (const span of spans) {
      assert.equal(span.attributes["buildanagent.cost.basis"], "catalog");
      assert.equal(typeof span.attributes["buildanagent.cost.usd"], "number");
    }
  });

  test("a session with an unknown price has basis unknown and no cost on every span that reports one", async () => {
    const spans = (await exportSpans(unpriced)).filter((span) => "buildanagent.cost.basis" in span.attributes);
    assert.ok(spans.length >= 5);
    for (const span of spans) {
      assert.equal(span.attributes["buildanagent.cost.basis"], "unknown");
      assert.ok(!("buildanagent.cost.usd" in span.attributes), `${span.name} carries a cost for an unknown price`);
    }
  });

  test("input tokens count the cached tokens, as the conventions say, and the split uses the conventions' cache names", async () => {
    const chat = (await exportSpans(entries)).find((span) => span.name === "chat priced");
    assert.equal(chat?.attributes["gen_ai.usage.input_tokens"], 1500);
    assert.equal(chat?.attributes["gen_ai.usage.output_tokens"], 200);
    assert.equal(chat?.attributes["gen_ai.usage.cache_read.input_tokens"], 400);
    assert.equal(chat?.attributes["gen_ai.usage.cache_write.input_tokens"], 100);
  });

  test("the root span carries the commit of the conventions the names follow", async () => {
    const root = (await exportSpans(entries)).find((span) => span.name === "invoke_agent");
    assert.equal(root?.attributes["buildanagent.semconv.genai.commit"], "d28355d");
  });
});

describe("hashAttributes", () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const hmac = (value: string) => createHmac("sha256", key).update(value).digest("hex");

  test("a named attribute carries the keyed hash of its value on every span, and its value is nowhere", async () => {
    const spans = await exportSpans(entries, {
      toolArguments: true,
      hashAttributes: { key, names: ["gen_ai.tool.name", "gen_ai.tool.call.arguments"] },
    });
    const tools = spans.filter((span) => span.attributes["gen_ai.operation.name"] === "execute_tool");
    assert.equal(tools.length, 2);
    for (const span of tools) {
      const call = String(span.attributes["gen_ai.tool.call.id"]);
      const name = call === "c1" ? "lookup" : "refund";
      assert.equal(span.attributes["gen_ai.tool.name"], hmac(name));
      assert.equal(span.name, "execute_tool", "a hashed tool name is left out of the span's name too");
    }
    const text = everything(spans);
    assert.ok(!text.includes(SECRETS.argument), "the argument's value was hashed");
    assert.ok(!text.includes('"lookup"') && !text.includes('"refund"'));
  });

  test("two spans with the same value carry the same hash, so a backend can still group them", async () => {
    const spans = await exportSpans(entries, { hashAttributes: { key, names: ["gen_ai.request.model"] } });
    const hashes = spans.flatMap((span) => (span.name === "chat" ? [span.attributes["gen_ai.request.model"]] : []));
    assert.equal(hashes.length, 2);
    assert.equal(hashes[0], hashes[1]);
    assert.equal(hashes[0], hmac("priced"));
  });

  test("a number and a list are hashed as their text and their JSON", async () => {
    const spans = await exportSpans(entries, {
      hashAttributes: { key, names: ["gen_ai.usage.input_tokens", "gen_ai.response.finish_reasons"] },
    });
    const chat = spans.find((span) => span.name.startsWith("chat"));
    assert.equal(chat?.attributes["gen_ai.usage.input_tokens"], hmac("1500"));
    assert.equal(chat?.attributes["gen_ai.response.finish_reasons"], hmac('["tool_calls"]'));
  });
});

describe("options", () => {
  const bad = (options: Parameters<typeof exportSpans>[1]) =>
    exportSpans(entries, options).then(
      () => assert.fail("expected a rejection"),
      (error) => assert.ok(isHarnessError(error) && error.code === "invalid_telemetry_options", String(error)),
    );

  test("an empty key, an empty name and an unknown content level are refused before any span starts", async () => {
    await bad({ hashAttributes: { key: new Uint8Array(0), names: ["gen_ai.tool.name"] } });
    await bad({ hashAttributes: { key: new Uint8Array(1), names: [""] } });
    await bad({ content: "everything" as never });
  });

  test("hashing an attribute that the messages repeat is refused at content level attributes, and allowed otherwise", async () => {
    const key = new Uint8Array(32).fill(7);
    await bad({ content: "attributes", hashAttributes: { key, names: ["gen_ai.tool.call.arguments"] } });
    await bad({ content: "attributes", hashAttributes: { key, names: ["gen_ai.tool.name"] } });
    for (const name of GEN_AI_CONTENT_ATTRIBUTES) {
      await bad({ content: "attributes", hashAttributes: { key, names: [name] } });
    }
    await exportSpans(entries, { content: "attributes", hashAttributes: { key, names: ["gen_ai.request.model"] } });
    await exportSpans(entries, { content: "refs", hashAttributes: { key, names: ["gen_ai.tool.name"] } });
  });

  test("a tracer that throws rejects the projection with its error", async () => {
    const boom = new Error("exporter down");
    await assert.rejects(
      projectSpans(entries, {
        tracer: {
          startSpan() {
            throw boom;
          },
        },
        childContext: () => undefined,
      }),
      boom,
    );
  });
});

test("no source file of the telemetry module writes a GenAI attribute name as a string", () => {
  const dir = new URL("../../src/telemetry/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length >= 5, "the telemetry sources were not found");
  const offenders = files.filter((name) => readFileSync(new URL(name, dir), "utf8").includes("gen_ai."));
  assert.deepEqual(offenders, [], "the names come from @buildanagent/sdk/otel, which the live observer shares");
});
