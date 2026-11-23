// Runs the compaction example: two long questions fill a small budget, the third turn starts with a summary written by
// the scripted model, the next request reads the summary and the newest messages, and the log keeps every entry.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { memorySpillStore } from "@buildanagent/harness/context";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { chatWithCompaction } from "../../examples/compaction.js";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const reply = (text: string) => ({ usage: {}, content: [{ type: "text" as const, text }] });
const SUMMARY = "## Goal\nFix E_INVOICE_TOTAL in src/billing/invoice.ts";
const long = (detail: string) =>
  `Remember src/billing/invoice.ts and E_INVOICE_TOTAL. ${`${detail} detail. `.repeat(600)}`;

const textOf = (message: { content: unknown } | undefined): string =>
  Array.isArray(message?.content) ? message.content.map((block) => block.text ?? "").join("") : "";

test("a chat past its budget gets a summary, the next request reads it, and the log keeps every entry", async () => {
  // One scripted model serves the turns and the summary call, in the order they happen.
  const adapter = new ScriptedModel([reply("First."), reply("Second."), reply(SUMMARY), reply("Third.")]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const report = await chatWithCompaction(memoryBackend(), model, memorySpillStore(), KEY, [
    long("Early"),
    long("Later"),
    "And the third question?",
  ]);
  adapter.assertComplete();
  assert.ok(report !== undefined);
  assert.equal(report.summary, SUMMARY);
  assert.ok(report.tokensBefore > 2_000 && report.tokensAfter < report.tokensBefore);
  assert.ok(report.replacedEntries > 0 && report.replacedEntries < report.logEntries);
  const request = adapter.calls.at(-1)?.context.messages ?? [];
  assert.ok(textOf(request[0]).includes("src/billing/invoice.ts"), "the summary stands first");
  // The summary replaced the first question; the newest messages stay word for word, starting at an answer.
  assert.ok(!request.some((message) => textOf(message).includes("Early detail.")));
  assert.deepEqual(
    request.map((message) => message.role),
    ["user", "assistant", "user", "assistant", "user"],
  );
  assert.ok(textOf(request[2]).includes("Later detail."));
  assert.equal(textOf(request.at(-1)), "And the third question?");
  const summaryRequest = textOf(adapter.calls[2]?.context.messages[0]);
  assert.ok(summaryRequest.includes("Pay particular attention to: file names and error messages"));
});

test("a short chat under its budget writes no summary", async () => {
  const adapter = new ScriptedModel([reply("One."), reply("Two.")]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const report = await chatWithCompaction(memoryBackend(), model, memorySpillStore(), KEY, ["Hi.", "And?"]);
  assert.equal(report, undefined);
  adapter.assertComplete();
});
