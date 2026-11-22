// Shared by the context tests: a harness whose `blob` tool returns a text of a chosen size, and a scripted model.
import { createModel, type Model } from "@buildanagent/gateway";
import type { ContextPolicy } from "@buildanagent/harness/context";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { KEY, memoryBackend } from "../session/session-helpers.js";

type Steps = ConstructorParameters<typeof ScriptedModel>[0];

export const call = (callId: string, size: number) => ({
  content: [{ type: "tool_call" as const, callId, name: "blob", input: { size } }],
});

/** A tool that returns `size` characters, a different letter per call so a mask or cap is visible in the text. */
function blobTool(fill: (callId: string, size: number) => string) {
  return defineTool({
    name: "blob",
    description: "Returns a text of the given size.",
    inputSchema: { type: "object", properties: { size: { type: "number" } }, required: ["size"] },
    async execute(input: { size: number }, ctx) {
      return { content: [{ type: "text", text: fill(ctx.callId, input.size) }] };
    },
  });
}

export async function runScripted(
  steps: Steps,
  context: ContextPolicy | undefined,
  fill: (callId: string, size: number) => string = (_id, size) => "x".repeat(size),
) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const registry = createToolRegistry();
  registry.register({ name: "blob", source: "builtin", definition: blobTool(fill) as never });
  const harness = createHarness({
    registry,
    model,
    system: "You read blobs.",
    ...(context === undefined ? {} : { context }),
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  const result = await runTurn(session, harness, { input: "Read them." });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  return { adapter, entries, result };
}
