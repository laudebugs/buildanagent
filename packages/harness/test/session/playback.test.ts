// Playback reads the log and nothing else, and a deterministic run writes the same bytes every time.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { fixedClock, ScriptedModel, sequentialIds } from "@buildanagent/sdk/testing";
import { expect, test } from "vitest";
import { type Backend, fileBackend, KEY, memoryBackend } from "./session-helpers.js";

let executed = 0;
const lookup = defineTool({
  name: "lookup",
  description: "Looks up a customer.",
  inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  async execute(input: { id: number }) {
    executed += 1;
    return { content: [{ type: "text", text: `customer ${input.id}` }] };
  },
});

const steps = () => [
  { content: [{ type: "tool_call" as const, callId: "c1", name: "lookup", input: { id: 7 } }] },
  { content: [{ type: "text" as const, text: "Done." }] },
];

function harnessOf(model: Model) {
  const registry = createToolRegistry();
  registry.register({ name: "lookup", source: "builtin", definition: lookup as never });
  return createHarness({ registry, model, system: "You triage tickets." });
}

/** One deterministic session on `backend`: the same script, clock and ids every time. */
async function writeSession(backend: Backend) {
  const adapter = new ScriptedModel(steps());
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const clock = fixedClock("2026-11-22T00:00:00.000Z", 1000);
  const ids = sequentialIds("id");
  const session = await openSession({
    store: backend.store,
    index: backend.index,
    lock: backend.lock,
    key: KEY,
    now: () => new Date(clock.now()),
    newId: ids,
  });
  await runTurn(session, harnessOf(model), { input: "Triage 7.", clock, newId: ids });
  await session.close();
  return { adapter };
}

function filesOf(backend: Backend): string[] {
  const root = join(backend.dir as string, "sessions");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => readFileSync(join(root, name), "utf8"));
}

test("two identical scripted sessions write byte-identical JSONL files", async () => {
  const first = fileBackend();
  const second = fileBackend();
  await writeSession(first);
  await writeSession(second);
  const left = filesOf(first);
  assert.ok(left.length > 0 && left.every((text) => text.length > 0));
  assert.deepEqual(left, filesOf(second));
});

test("playback makes no model call and runs no tool, and yields the entries the run wrote, in order", async () => {
  const backend = memoryBackend();
  const { adapter } = await writeSession(backend);
  const calls = adapter.calls.length;
  const ran = executed;
  const session = await openSession({ store: backend.store, index: backend.index, key: KEY });
  const played = [];
  for await (const entry of session.playback()) played.push(entry);
  const stored = [];
  for await (const entry of backend.store.load(KEY)) stored.push(entry);
  assert.deepEqual(played, stored);
  assert.equal(adapter.calls.length, calls, "no model call");
  assert.equal(executed, ran, "no tool call");
  expect(played.map((entry) => entry.type)).toContain("tool_result");
});

test("playback stops at the entry it is given", async () => {
  const backend = memoryBackend();
  await writeSession(backend);
  const session = await openSession({ store: backend.store, index: backend.index, key: KEY });
  const all = [];
  for await (const entry of session.playback()) all.push(entry);
  const cut = all.findIndex((entry) => entry.type === "tool_result");
  const part = [];
  for await (const entry of session.playback(all[cut]?.id)) part.push(entry);
  assert.equal(part.length, cut + 1);
});
