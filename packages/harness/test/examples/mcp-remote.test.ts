// Runs the README's remote MCP example against a real 2026-07-28 server behind a stand-in proxy, in this process: the
// token reaches the server, its tool starts disabled because the empty pin store holds nothing, and an approval
// enables it from the next turn.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { test } from "vitest";
import { trackerHarness } from "../../examples/mcp-remote.js";
import { schema } from "../mcp/turns.js";
import { KEY, memoryBackend } from "../session/session-helpers.js";

test("the tracker server joins at the first turn, disabled until a person approves its tool", async () => {
  const authorizations: (string | null)[] = [];
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "tracker", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.registerTool(
      "issues",
      { description: "Lists issues.", inputSchema: schema({ type: "object" }) },
      (async () => ({
        content: [{ type: "text", text: "no issues" }],
      })) as never,
    );
    return server;
  });
  // The stand-in proxy hands each request to the server in this process, as the egress proxy would send it upstream.
  const proxy = {
    fetch: async (input: string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      authorizations.push(request.headers.get("authorization"));
      return handler.fetch(request);
    },
  };
  const registry = createToolRegistry();
  const adapter = new ScriptedModel([
    { content: [{ type: "text", text: "Done." }] },
    { content: [{ type: "text", text: "Done." }] },
  ]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const { manager, harness } = trackerHarness(registry, model, proxy, "t0k3n");
  try {
    const backend = memoryBackend();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    await runTurn(session, harness, { input: "List the issues." });
    assert.deepEqual(
      adapter.calls[0]?.context.tools.map((tool) => tool.name),
      ["mcp__tracker__issues"],
    );
    assert.ok(authorizations.length > 0 && authorizations.every((value) => value === "Bearer t0k3n"));
    const [pending] = manager.pending();
    assert.equal(pending?.canonicalName, "mcp__tracker__issues");
    await manager.approve("tracker", "issues", pending?.hash ?? "");
    await runTurn(session, harness, { input: "Again." });
    const [status] = manager.statuses();
    assert.deepEqual(status?.status === "connected" ? status.disabled : undefined, []);
    assert.deepEqual(manager.pending(), []);
  } finally {
    await manager.close();
    await handler.close();
  }
});
