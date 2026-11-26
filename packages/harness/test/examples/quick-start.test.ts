// Runs the quick-start example on a scripted model in a temporary folder: the second request carries the first turn,
// the log holds both turns, and a new session object on the same folder reads the same log.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { openSession } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterEach, test } from "vitest";
import { askTwice } from "../../examples/quick-start.js";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const say = (text: string) => ({ usage: {}, content: [{ type: "text" as const, text }] });
const KEY = { userId: "ada", sessionId: "chat-1" };

test("two turns share one log: the second request carries the first turn, and the log holds both", async () => {
  const folder = mkdtempSync(join(tmpdir(), "quick-start-"));
  folders.push(folder);
  const adapter = new ScriptedModel([say("Noted: PELICAN."), say("The codeword was PELICAN.")]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const run = await askTwice(model, folder, KEY);
  adapter.assertComplete();
  assert.deepEqual(run.answers, ["Noted: PELICAN.", "The codeword was PELICAN."]);
  assert.equal(adapter.calls[0]?.context.messages.length, 1);
  assert.equal(adapter.calls[1]?.context.messages.length, 3);
  assert.deepEqual(run.entryTypes, [
    "session_header",
    "env_stamp",
    "loadout",
    "message_block",
    "turn_start",
    "message_block",
    "message_end",
    "usage",
    "turn_end",
    "message_block",
    "turn_start",
    "message_block",
    "message_end",
    "usage",
    "turn_end",
  ]);
  assert.deepEqual(readdirSync(join(folder, "sessions", "ada")), ["chat-1.jsonl"]);
  // A session object made later on the same folder reads the same entries.
  const again = await openSession({
    store: jsonlStore({ dir: join(folder, "sessions") }),
    index: fileIndex({ dir: join(folder, "pointers") }),
    lock: fileLock({ dir: join(folder, "locks") }),
    key: KEY,
  });
  const types: string[] = [];
  for await (const entry of again.playback()) types.push(entry.type);
  await again.close();
  assert.deepEqual(types, run.entryTypes);
});
