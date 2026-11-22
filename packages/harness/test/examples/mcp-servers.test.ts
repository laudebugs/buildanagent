// Runs the README's MCP example against the fixture server as a stdio child: the server connects in its era, its
// tools are registered deferred under the docs prefix, and the token reaches it while an undeclared variable doesn't.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { test } from "vitest";
import { connectDocs } from "../../examples/mcp-servers.js";

const script = fileURLToPath(new URL("../mcp/library-server.ts", import.meta.url));

test("the docs server connects, its tools are deferred, and only the declared variables reach it", async () => {
  process.env.DOCS_REGION = "eu";
  process.env.N24_EXAMPLE_CANARY = "undeclared";
  const registry = createToolRegistry();
  const { manager, era, tools } = await connectDocs(
    registry,
    process.execPath,
    ["--import", "tsx", script, "modern"],
    "t0k3n",
  );
  try {
    assert.equal(era, "2026-07-28");
    assert.ok(tools.includes("mcp__docs__echo"));
    assert.equal(registry.get("mcp__docs__echo")?.exposure, "deferred");
    const result = await manager.connection("docs")?.callTool("env", {}, new AbortController().signal);
    const block = result?.content[0];
    const { env } = JSON.parse(block?.type === "text" ? block.text : "{}") as { env: Record<string, string> };
    assert.equal(env.DOCS_REGION, "eu");
    assert.equal(env.DOCS_TOKEN, "t0k3n");
    assert.equal(env.N24_EXAMPLE_CANARY, undefined);
  } finally {
    await manager.close();
    delete process.env.DOCS_REGION;
    delete process.env.N24_EXAMPLE_CANARY;
  }
});
