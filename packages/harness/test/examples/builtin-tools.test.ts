// Runs the README's coding agent on fakeSandbox(): the model greps the workspace, edits the file it found, and the
// change lands in the sandbox and nowhere on the host.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { fakeSandbox } from "@buildanagent/harness/testing";
import type { FetchProxy } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { codingAgent } from "../../examples/builtin-tools.js";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const proxy: FetchProxy = { fetch: async () => new Response(""), knownSecrets: async () => [] };

test("the coding agent greps, edits through the sandbox, and finishes", async () => {
  const spillDir = mkdtempSync(join(tmpdir(), "builtin-example-"));
  try {
    const client = fakeSandbox();
    const adapter = new ScriptedModel([
      { content: [{ type: "tool_call", callId: "c1", name: "grep", input: { pattern: "colour" } }] },
      {
        content: [
          {
            type: "tool_call",
            callId: "c2",
            name: "edit",
            input: { path: "src/theme.ts", old_string: "colour", new_string: "color" },
          },
        ],
      },
      { content: [{ type: "text", text: "Renamed it." }] },
    ]);
    const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
    const { sandbox, harness } = await codingAgent(client, proxy, model, { workspace: "/repo", spillDir, key: KEY });
    await sandbox.writeFile("src/theme.ts", new TextEncoder().encode("export const colour = 'teal';\n"));
    const backend = memoryBackend();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const result = await runTurn(session, harness, { input: "Rename colour to color." });
    assert.equal(result.stopReason, "done");
    const theme = client.files().get("/repo/src/theme.ts");
    assert.equal(new TextDecoder().decode(theme), "export const color = 'teal';\n");
    assert.deepEqual(
      client.execs.map((exec) => exec.command[0]),
      ["find", "grep"],
    );
  } finally {
    rmSync(spillDir, { recursive: true, force: true });
  }
});
