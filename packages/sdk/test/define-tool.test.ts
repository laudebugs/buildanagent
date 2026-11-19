import assert from "node:assert/strict";
import { defineTool, isSdkError, type ToolDefinition, type ToolEffect } from "@buildanagent/sdk";
import { test } from "vitest";
import { runToolCall } from "../src/tools/pipeline.js";
import { call, pipelineContext } from "./tool-helpers.js";

const OBJECT_SCHEMA = { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as const;

function readFile(overrides: Partial<ToolDefinition<{ path: string }>> = {}): ToolDefinition<{ path: string }> {
  return {
    name: "read_file",
    description: "Read a file.",
    inputSchema: OBJECT_SCHEMA,
    async execute() {
      return { content: [] };
    },
    ...overrides,
  };
}

const isDefinitionError = (error: unknown) => isSdkError(error) && error.code === "invalid_tool_definition";

test("a name that breaks the tool-name rule throws an SdkError", () => {
  assert.throws(() => defineTool(readFile({ name: "read file" })), isDefinitionError);
});

test("a raw schema that does not compile throws an SdkError", () => {
  assert.throws(() => defineTool(readFile({ inputSchema: { $ref: "#/$defs/missing" } })), isDefinitionError);
});

test("a raw schema that names a draft other than 2020-12 or 7 throws an SdkError", () => {
  const draft4 = { $schema: "http://json-schema.org/draft-04/schema#", type: "object" };
  assert.throws(() => defineTool(readFile({ inputSchema: draft4 })), isDefinitionError);
});

test("defineTool returns a frozen copy", () => {
  const definition = readFile();
  const tool = defineTool(definition);
  assert.notEqual(tool, definition);
  assert.ok(Object.isFrozen(tool));
});

test("a draft 7 schema is checked with draft 7 rules", async () => {
  // In draft 7, an `items` array is a tuple and `additionalItems: false` rejects a third item.
  const tool = defineTool<[string, number]>({
    name: "set_pair",
    description: "Set a pair.",
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "string" }, { type: "number" }],
      additionalItems: false,
    },
    async execute() {
      return { content: [] };
    },
  });
  const ok = await runToolCall(call("set_pair", ["a", 1]), [tool], pipelineContext());
  const tooLong = await runToolCall(call("set_pair", ["a", 1, true]), [tool], pipelineContext());
  assert.equal(ok.isError, undefined);
  assert.equal(tooLong.isError, true);
});

test("a format is checked, as provider strict modes check it", async () => {
  const tool = defineTool<{ email: string }>({
    name: "invite",
    description: "Invite a user.",
    inputSchema: { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] },
    async execute() {
      return { content: [] };
    },
  });
  const result = await runToolCall(call("invite", { email: "not an email" }), [tool], pipelineContext());
  assert.equal(result.isError, true);
});

test("a write tool keeps its effect declaration, and its business key reads the typed input", () => {
  const tool = defineTool(readFile({ effect: { kind: "write", businessKey: (input) => `write:${input.path}` } }));
  assert.equal(tool.effect?.kind, "write");
  assert.equal(tool.effect?.businessKey?.({ path: "a.txt" }), "write:a.txt");
});

test("a tool without an effect declaration has none, so it counts as read-only", () => {
  assert.equal(defineTool(readFile()).effect, undefined);
});

// Type tests: `pnpm typecheck` fails if these rules stop holding.
// @ts-expect-error: an effect's kind is only "write".
const _readEffect: ToolEffect<unknown> = { kind: "read" };
// @ts-expect-error: a business key receives the tool's typed input, which has no `order`.
readFile({ effect: { kind: "write", businessKey: (input) => input.order } });
void _readEffect;
