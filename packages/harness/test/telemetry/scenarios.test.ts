// Projection cases a real run makes awkward to reach: what a call was sent after a compaction or a code call, a crash
// that leaves open spans, and a usage entry that belongs to a superseded call.
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  assistant,
  call,
  codeCall,
  compaction,
  header,
  log,
  messageEnd,
  result,
  text,
  turnEnd,
  turnStart,
  usage,
  user,
} from "./scenarios.js";
import { exportSpans } from "./spans.js";

const inputOf = (span: { attributes: Record<string, unknown> } | undefined): string =>
  String(span?.attributes["gen_ai.input.messages"] ?? "");

describe("what a call was sent", () => {
  test("after a compaction, a call's input is the summary and the kept messages, not the whole history", async () => {
    const entries = log(
      header(),
      turnStart("r1"),
      user("u1", "FIRST-QUESTION"),
      assistant("a1", text("first answer")),
      messageEnd("a1"),
      usage(),
      user("u2", "SECOND-QUESTION", "keep-from-here"),
      compaction("keep-from-here", "SUMMARY-OF-OLD-TURNS"),
      turnEnd("r1"),
      turnStart("r2"),
      assistant("a2", text("second answer")),
      messageEnd("a2"),
      usage(),
      turnEnd("r2"),
    );
    const chats = (await exportSpans(entries, { content: "attributes" })).filter((s) => s.name === "chat m1");
    assert.equal(chats.length, 2);
    assert.ok(inputOf(chats[0]).includes("FIRST-QUESTION"), "the first call was sent the first question");
    const second = inputOf(chats[1]);
    assert.ok(second.includes("SUMMARY-OF-OLD-TURNS") && second.includes("SECOND-QUESTION"));
    assert.ok(!second.includes("FIRST-QUESTION"), "the compacted question was not sent");
  });

  test("a code call's result is in no call's input, because the model never reads it", async () => {
    const entries = log(
      header(),
      turnStart("r1"),
      user("u1", "refund it"),
      codeCall("cc1", "refund", { orderId: "o9" }),
      result("cc1", "refund", "CODE-CALL-RESULT-WITH-CUSTOMER-DATA"),
      assistant("a1", text("done")),
      messageEnd("a1"),
      usage(),
      turnEnd("r1"),
    );
    const spans = await exportSpans(entries, { content: "attributes" });
    assert.ok(!inputOf(spans.find((s) => s.name === "chat m1")).includes("CODE-CALL-RESULT"));
    const tool = spans.find((s) => s.name === "execute_tool refund");
    assert.ok(String(tool?.attributes["gen_ai.tool.call.result"]).includes("CODE-CALL-RESULT"), "its own span has it");
  });

  test("level refs lists the system prompt, the compaction, each input message and the answer", async () => {
    const entries = log(
      header(),
      turnStart("r1"),
      user("u1", "q1"),
      assistant("a1", text("x")),
      messageEnd("a1"),
      usage(),
      user("u2", "q2", "kept"),
      compaction("kept", "S"),
      assistant("a2", text("y"), "answer-block"),
      messageEnd("a2"),
    );
    const last = (await exportSpans(entries, { content: "refs" })).filter((s) => s.name === "chat m1")[1];
    const refs = last?.attributes["buildanagent.content.ref"] as string[];
    const id = (type: string, from = 0) => entries.findLast((e, i) => e.type === type && i >= from)?.id;
    assert.ok(refs.includes(id("turn_start") as string), "the system prompt's entry");
    assert.ok(refs.includes(id("compaction") as string), "the summary's entry");
    assert.ok(refs.includes("kept"), "the first kept message's entry");
    assert.ok(refs.includes("answer-block") && refs.includes(entries.at(-1)?.id as string), "the answer");
  });
});

describe("a log that ends mid-work", () => {
  test("a turn that never ended, and a call that streamed and never finished, are marked unfinished", async () => {
    const entries = log(header(), turnStart("r1"), user("u1", "hi"), assistant("a1", text("partial")));
    const spans = await exportSpans(entries);
    const unfinished = (name: string) => spans.find((s) => s.name === name)?.attributes["buildanagent.span.unfinished"];
    assert.equal(unfinished("turn"), true);
    assert.equal(unfinished("chat"), true, "the interrupted model call is not lost");
  });

  test("a turn that a new turn_start closes is marked unfinished, and one a turn_end closes is not", async () => {
    const entries = log(header(), turnStart("r1"), turnStart("r2"), turnEnd("r2"));
    const turns = (await exportSpans(entries)).filter((s) => s.name === "turn");
    assert.deepEqual(turns.map((s) => s.attributes["buildanagent.span.unfinished"]).sort(), [true, undefined]);
  });
});

describe("usage", () => {
  test("a usage entry that is not right after a message's end prices no earlier call", async () => {
    const entries = log(
      header(),
      turnStart("r1"),
      user("u1", "hi"),
      assistant("a1", text("crashed")),
      messageEnd("a1"),
      turnEnd("r1"),
      turnStart("r2"),
      usage(),
    );
    const spans = await exportSpans(entries);
    const crashed = spans.find((s) => s.name === "chat m1");
    assert.ok(!("buildanagent.cost.basis" in (crashed?.attributes ?? {})), "the crashed call has no price to show");
    const other = spans.filter((s) => s.name === "chat" && s.attributes["buildanagent.usage.source"] === "model_call");
    assert.equal(other.length, 1, "the superseded call's usage has a span of its own");
  });

  test("a tool call's span starts at its message's end and ends at its result", async () => {
    const entries = log(
      header(),
      turnStart("r1"),
      user("u1", "hi"),
      assistant("a1", call("c1", "lookup", { id: 1 })),
      messageEnd("a1", "tool_calls"),
      usage(),
      result("c1", "lookup", "found"),
      turnEnd("r1"),
    );
    const tool = (await exportSpans(entries)).find((s) => s.name === "execute_tool lookup");
    assert.equal(tool?.duration[0], 2, "from the message's end at 4s to the result at 6s");
  });
});
