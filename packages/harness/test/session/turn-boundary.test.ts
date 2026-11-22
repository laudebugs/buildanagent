// A turn boundary runs once at the start of each turn, before the turn's tools are built, and its notices go in
// front of the turn's input as text of origin `harness`, in the same user message, so the log stays append-only.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry, type TurnBoundary } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { KEY, memoryBackend } from "./session-helpers.js";

const done = { content: [{ type: "text" as const, text: "Done." }] };

test("a boundary's change lands before the turn's tools are built, and its notice leads the input", async () => {
  const registry = createToolRegistry();
  const signals: AbortSignal[] = [];
  let turns = 0;
  const boundary: TurnBoundary = {
    async beginTurn(signal) {
      signals.push(signal);
      turns += 1;
      if (turns !== 2) return [];
      registry.register({
        name: "late",
        source: "extension",
        definition: defineTool({
          name: "late",
          description: "Arrived between turns.",
          inputSchema: { type: "object" },
          execute: async () => ({ content: [] }),
        }),
      });
      return ["Harness notice: a tool arrived.", ""];
    },
  };
  const adapter = new ScriptedModel([done, done]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const harness = createHarness({ registry, model, system: "s", turnBoundaries: [boundary] });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  await runTurn(session, harness, { input: "one" });
  await runTurn(session, harness, { input: [{ type: "text", text: "two" }] });
  assert.equal(signals.length, 2);
  assert.deepEqual(
    adapter.calls.map((call) => call.context.tools.map((tool) => tool.name)),
    [[], ["late"]],
  );
  const second = adapter.calls[1]?.context.messages.at(-1);
  assert.deepEqual(second, {
    role: "user",
    content: [
      { type: "text", text: "Harness notice: a tool arrived." },
      { type: "text", text: "two" },
    ],
  });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  const inputs = entries.filter((entry) => entry.type === "message_block" && entry.delivery === "input");
  assert.deepEqual(
    inputs.map((entry) => (entry.type === "message_block" ? [entry.origin, entry.index, entry.block] : [])),
    [
      ["user", 0, { type: "text", text: "one" }],
      ["harness", 0, { type: "text", text: "Harness notice: a tool arrived." }],
      ["user", 1, { type: "text", text: "two" }],
    ],
  );
  const [first, notice] = inputs;
  assert.notEqual(first?.type === "message_block" ? first.messageId : "", "");
  const messageIds = new Set(inputs.slice(1).map((entry) => (entry.type === "message_block" ? entry.messageId : "")));
  assert.equal(messageIds.size, 1, "the notice and the input are one message");
  assert.ok(notice);
});
