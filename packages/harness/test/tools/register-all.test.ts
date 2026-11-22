// `registerAll()` registers a list of tools or none of them.
import assert from "node:assert/strict";
import { createToolRegistry, DuplicateToolError, type ToolRegistration } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { test } from "vitest";

const tool = (name: string, source: ToolRegistration["source"] = "mcp:s"): ToolRegistration => ({
  name,
  source,
  definition: defineTool({
    name: "t",
    description: name,
    inputSchema: { type: "object" },
    execute: async () => ({ content: [] }),
  }) as never,
});

test("registers every tool of a list, in order", () => {
  const registry = createToolRegistry();
  const added = registry.registerAll([tool("a"), tool("b")]);
  assert.deepEqual(
    added.map((t) => t.canonicalName),
    ["mcp__s__a", "mcp__s__b"],
  );
  assert.equal(registry.list().length, 2);
});

test("a refused tool removes the tools the list registered before it, and the earlier tools stay", () => {
  const registry = createToolRegistry();
  registry.register(tool("keep", "builtin"));
  registry.register(tool("b"));
  assert.throws(() => registry.registerAll([tool("a"), tool("b")]), DuplicateToolError);
  assert.deepEqual(
    registry.list().map((t) => t.canonicalName),
    ["keep", "mcp__s__b"],
  );
});
