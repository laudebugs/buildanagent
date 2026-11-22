// Runs the README's memory example: a scripted model stores a record in one session, the next session's first request
// leads with its index line, a third session deletes it, and the purge pass leaves no session file holding the fact.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { readPurgeMarks } from "@buildanagent/harness/memory";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterAll, test } from "vitest";
import { memoryHarness, purgeDeleted } from "../../examples/memory-extension.js";

const dir = mkdtempSync(join(tmpdir(), "memory-example-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const FACT = "Release notes go in CHANGELOG.md through changesets, never by hand.";
const reply = { usage: {}, content: [{ type: "text" as const, text: "Done." }] };
const call = (input: unknown) => ({
  usage: {},
  content: [{ type: "tool_call" as const, callId: "c1", name: "memory", input }],
});

test("a record stored in one session is in the next one's index, and a delete and a purge remove it from the log", async () => {
  const root = join(dir, "project");
  mkdirSync(root);
  const log = {
    store: jsonlStore({ dir: join(dir, "sessions") }),
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks") }),
  };
  const run = async (sessionId: string, steps: unknown[]) => {
    const adapter = new ScriptedModel([...steps.map(call), reply]);
    const { harness } = memoryHarness(
      createToolRegistry(),
      createModel({ adapter, id: "m", retries: 0 }) as Model,
      root,
      sessionId,
    );
    const session = await openSession({ ...log, key: { userId: "ada", sessionId } });
    await runTurn(session, harness, { input: "Go." });
    await session.close();
    return adapter;
  };
  await run("s1", [
    {
      command: "create",
      path: ".agents/memory/releases.md",
      subject: "Release notes",
      fact: FACT,
      source: "AGENTS.md:40",
      type: "project",
    },
  ]);
  const second = await run("s2", [{ command: "view", path: ".agents/memory/releases.md" }]);
  const first = second.calls[0]?.context.messages[0];
  assert.ok(JSON.stringify(first).includes("- Release notes (project, trusted): .agents/memory/releases.md"));
  await run("s3", [{ command: "delete", path: ".agents/memory/releases.md" }]);
  await purgeDeleted(root, log, "ada", ["s1", "s2", "s3"]);
  for (const name of readdirSync(join(dir, "sessions/ada"))) {
    assert.ok(!readFileSync(join(dir, "sessions/ada", name), "utf8").includes(FACT), name);
  }
  assert.deepEqual(await readPurgeMarks(fileMemoryFiles(root)), []);
});
