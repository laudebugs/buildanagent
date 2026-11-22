// A connected MCP server's `extension_loaded` entry, tier `mcp`: what it records, the hashes it records instead of
// arguments, and that nothing secret reaches the log.
import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
import { createModel, type Model } from "@buildanagent/gateway";
import { createMcpManager, type McpChannel, type McpServerConfig } from "@buildanagent/harness/mcp";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterEach, describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";
import { callLog, stdioServer } from "./helpers.js";
import { serveModern } from "./library-server.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function recordOf(...servers: McpServerConfig[]) {
  const manager = createMcpManager({ registry: createToolRegistry(), servers });
  closers.push(() => manager.close());
  const statuses = await manager.connect();
  return { records: manager.records(), statuses };
}

const done = { content: [{ type: "text" as const, text: "Done." }] };

describe("the record of a connected server", () => {
  test("is tier mcp with the transport, era and hashes, and no secret reaches the entry or the log", async () => {
    process.env.N24_RECORD_DECLARED = "declared-canary-value";
    try {
      const registry = createToolRegistry();
      const manager = createMcpManager({
        registry,
        servers: [
          stdioServer("lib", "library", ["modern", callLog().path, "--token=arg-canary-value"], {
            transport: { env: ["N24_RECORD_DECLARED"], setEnv: { SECRET_TOKEN: "setenv-canary-value" } },
          }),
        ],
      });
      closers.push(() => manager.close());
      await manager.connect();
      const [record] = manager.records();
      assert.equal(record?.tier, "mcp");
      assert.equal(record?.name, "lib");
      assert.equal(record?.mcp?.transport, "stdio");
      assert.equal(record?.mcp?.era, "2026-07-28");
      assert.match(record?.mcp?.commandHash ?? "", /^sha256:[0-9a-f]{64}$/);
      assert.match(record?.mcp?.toolsHash ?? "", /^sha256:[0-9a-f]{64}$/);
      assert.match(record?.contentHash ?? "", /^sha256:[0-9a-f]{64}$/);

      const backend = memoryBackend();
      const model = createModel({ adapter: new ScriptedModel([done, done]), id: "m", retries: 0 }) as Model;
      const harness = createHarness({ registry, model, system: "s", extensionRecords: manager.records() });
      const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
      await runTurn(session, harness, { input: "one" });
      // The second turn rebuilds its context from a log that holds the entry, and writes the entry only once.
      const second = await runTurn(session, harness, { input: "two" });
      assert.equal(second.stopReason, "done");
      const entries: SessionEntry[] = [];
      for await (const entry of backend.store.load(KEY)) entries.push(entry);
      const loaded = entries.filter((entry) => entry.type === "extension_loaded");
      assert.equal(loaded.length, 1);
      assert.deepEqual(
        { ...loaded[0], id: undefined, parentId: undefined, timestamp: undefined, seq: undefined, origin: undefined },
        {
          ...record,
          type: "extension_loaded",
          id: undefined,
          parentId: undefined,
          timestamp: undefined,
          seq: undefined,
          origin: undefined,
        },
      );
      const log = JSON.stringify(entries);
      for (const canary of ["declared-canary-value", "setenv-canary-value", "arg-canary-value", "--token"]) {
        assert.ok(!log.includes(canary), `the log holds ${canary}`);
      }
    } finally {
      delete process.env.N24_RECORD_DECLARED;
    }
  });

  test("an in-process server has no command hash", async () => {
    const { records } = await recordOf({
      name: "inproc",
      transport: { kind: "in_process", channel: serveModern() as unknown as McpChannel },
    });
    assert.equal(records[0]?.mcp?.transport, "in_process");
    assert.equal(records[0]?.mcp?.commandHash, undefined);
  });

  test("a server that fails to connect has no record", async () => {
    const { records, statuses } = await recordOf(stdioServer("dead", "raw", ["legacy", "exit-on-start"]));
    assert.equal(statuses[0]?.status, "failed");
    assert.deepEqual(records, []);
  });
});

describe("the hashes", () => {
  test("are stable across reconnects of an unchanged server", async () => {
    const log = callLog().path;
    const first = await recordOf(stdioServer("lib", "library", ["legacy", log]));
    const second = await recordOf(stdioServer("lib", "library", ["legacy", log]));
    assert.deepEqual(second.records, first.records);
  });

  test("the command hash changes with an argument and with the command, and the tools hash does not", async () => {
    const log = callLog().path;
    const [base] = (await recordOf(stdioServer("lib", "library", ["legacy", log]))).records;
    const [otherArg] = (await recordOf(stdioServer("lib", "library", ["legacy", log, "extra"]))).records;
    // The same program through a longer path: a different command string, which path.join would have normalised away.
    const sameNode = `${dirname(process.execPath)}/../${basename(dirname(process.execPath))}/${basename(process.execPath)}`;
    const [otherCommand] = (
      await recordOf(stdioServer("lib", "library", ["legacy", log], { transport: { command: sameNode } }))
    ).records;
    assert.notEqual(otherArg?.mcp?.commandHash, base?.mcp?.commandHash);
    assert.notEqual(otherCommand?.mcp?.commandHash, base?.mcp?.commandHash);
    assert.notEqual(otherArg?.contentHash, base?.contentHash);
    assert.equal(otherArg?.mcp?.toolsHash, base?.mcp?.toolsHash);
    assert.equal(otherCommand?.mcp?.toolsHash, base?.mcp?.toolsHash);
  });

  test("the tools hash changes when the tool list changes", async () => {
    const [one] = (await recordOf(stdioServer("raw", "raw", ["legacy", "plain"]))).records;
    const [two] = (await recordOf(stdioServer("raw", "raw", ["legacy", "two-tools"]))).records;
    assert.notEqual(two?.mcp?.toolsHash, one?.mcp?.toolsHash);
  });
});
