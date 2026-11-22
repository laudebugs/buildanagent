// The book's transcript recorder on our SDK (examples/lib/transcript.ts) records an answer's usage only in the classes
// its script set. ScriptedModel fills every count a script leaves out with a zero, and autoResponder() reports
// `usage: {}`, so without the script the recorder would show zeros that no script chose. The recorder attaches only
// when the runner preloads it, so this file installs a recorder of its own before it imports the examples' helper.
import { expect, test } from "vitest";
import type { TranscriptEvent } from "../../../scripts/transcripts/events.js";
import { autoResponder } from "../src/testing/index.js";

const events: TranscriptEvent[] = [];
(globalThis as Record<symbol, unknown>)[Symbol.for("buildanagent.transcript")] = {
  record: (event: TranscriptEvent) => events.push(event),
  atCaller: <T>(run: () => T) => run(),
  enterCaller: () => {},
};
const { scripted } = await import("../examples/lib/check.js");

const ask = {
  system: "",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Hi." }] }],
  tools: [],
};
const text = (value: string) => [{ type: "text" as const, text: value }];

test("an answer records only the usage classes its script set, and none for an empty or absent usage", async () => {
  const { model } = scripted([
    { content: text("one"), usage: { cacheRead: 1500, output: 200 } },
    async () => ({ content: text("two"), usage: { uncachedInput: 7, cacheWrite: { "5m": 3, "1h": 2 } } }),
    { content: text("three") },
    autoResponder(),
  ]);
  for (let call = 0; call < 4; call++) await model.complete(ask);
  const answers = events.filter((event) => event.kind === "response");
  expect(answers.map((answer) => answer.usage)).toEqual([
    { cacheRead: 1500, output: 200 },
    { uncachedInput: 7, cacheWrite: 5 },
    undefined,
    undefined,
  ]);
  expect(answers.every((answer) => answer.modelId === undefined)).toBe(true);
});
