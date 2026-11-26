// Runs the quick-start example on a scripted model in a temporary folder, one behaviour in each test.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterEach, test } from "vitest";
import { askTwice } from "../../examples/quick-start.js";
import { say } from "../session/session-helpers.js";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const KEY = { userId: "ada", sessionId: "chat-1" };
const modelOf = (adapter: ScriptedModel) => createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
const folderOf = () => {
  const folder = mkdtempSync(join(tmpdir(), "quick-start-"));
  folders.push(folder);
  return folder;
};
const sessionIn = (folder: string) =>
  openSession({
    store: jsonlStore({ dir: join(folder, "sessions") }),
    index: fileIndex({ dir: join(folder, "pointers") }),
    lock: fileLock({ dir: join(folder, "locks") }),
    key: KEY,
  });

async function twoTurns() {
  const folder = folderOf();
  const adapter = new ScriptedModel([say("Noted: PELICAN."), say("The codeword was PELICAN.")]);
  const run = await askTwice(modelOf(adapter), folder, KEY);
  return { folder, adapter, run };
}

test("each turn's answer is the text the model wrote", async () => {
  const { adapter, run } = await twoTurns();
  adapter.assertComplete();
  assert.deepEqual(run.answers, ["Noted: PELICAN.", "The codeword was PELICAN."]);
});

test("the second request carries the first question, its answer and the new question", async () => {
  const { adapter } = await twoTurns();
  assert.equal(adapter.calls[0]?.context.messages.length, 1);
  assert.equal(adapter.calls[1]?.context.messages.length, 3);
});

test("two turns write the header entries once, then six entries for each turn", async () => {
  const { run } = await twoTurns();
  const turn = ["message_block", "turn_start", "message_block", "message_end", "usage", "turn_end"];
  assert.deepEqual(run.entryTypes, ["session_header", "env_stamp", "loadout", ...turn, ...turn]);
});

test("the log is one file under the user's folder", async () => {
  const { folder } = await twoTurns();
  assert.deepEqual(readdirSync(join(folder, "sessions", "ada")), ["chat-1.jsonl"]);
});

test("a session object made later on the same folder reads the same entries", async () => {
  const { folder, run } = await twoTurns();
  const again = await sessionIn(folder);
  const types: string[] = [];
  for await (const entry of again.playback()) types.push(entry.type);
  await again.close();
  assert.deepEqual(types, run.entryTypes);
});

test("a third turn from a new harness and session reads the earlier turns from the log", async () => {
  const { folder } = await twoTurns();
  const adapter = new ScriptedModel([say("Still PELICAN.")]);
  const harness = createHarness({ registry: createToolRegistry(), model: modelOf(adapter), system: "You keep notes." });
  const session = await sessionIn(folder);
  await runTurn(session, harness, { input: "And the codeword again?" });
  await session.close();
  const sent = JSON.stringify(adapter.calls[0]?.context.messages);
  assert.equal(adapter.calls[0]?.context.messages.length, 5);
  assert.ok(sent.includes("Remember the codeword PELICAN.") && sent.includes("The codeword was PELICAN."));
});
