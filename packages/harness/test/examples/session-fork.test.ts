// Runs the fork example: the fork shares the first turn with its parent, its own question's request carries only that
// turn, and the parent's log is unchanged.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { askFrom } from "../../examples/session-fork.js";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const say = (text: string) => ({ usage: {}, content: [{ type: "text" as const, text }] });

test("a fork shares the first turn, adds its own entries and leaves the parent's log alone", async () => {
  const adapter = new ScriptedModel([say("One."), say("Two."), say("Fork answer.")]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const harness = createHarness({ registry: createToolRegistry(), model, system: "You help." });
  const backend = memoryBackend();
  const session = await openSession({ ...backend, key: KEY });
  const first = await runTurn(session, harness, { input: "First question." });
  await runTurn(session, harness, { input: "Second question." });
  const before = (await session.path()).length;

  const report = await askFrom(session, harness, first.lastEntryId, "Another question.");

  adapter.assertComplete();
  // The first turn's 9 entries: session_header, env_stamp, loadout, the input, turn_start, the answer, message_end,
  // usage and turn_end. The fork's own turn adds 6, as any later turn does.
  assert.equal(report.shared, 9);
  assert.equal(report.added, 6);
  assert.notEqual(report.forkId, KEY.sessionId);
  const request = adapter.calls[2]?.context.messages ?? [];
  assert.equal(request.length, 3);
  assert.equal((await session.path()).length, before);
  await session.close();
});
