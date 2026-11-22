// Rebuilding the SDK context from the log: the log is the only state, so a rebuilt context equals the run's own.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type Session } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { continueRun, defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { BACKENDS, type Backend, KEY } from "./session-helpers.js";

const lookup = defineTool({
  name: "lookup",
  description: "Looks up a customer.",
  inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  async execute(input: { id: number }) {
    return { content: [{ type: "text", text: `customer ${input.id}` }] };
  },
});

const scripted = (steps: ConstructorParameters<typeof ScriptedModel>[0]) => {
  const adapter = new ScriptedModel(steps);
  return { adapter, model: createModel({ adapter, id: "scripted-model", retries: 0 }) as Model };
};

function harnessOf(model: Model, system = "You triage tickets.") {
  const registry = createToolRegistry();
  registry.register({ name: "lookup", source: "builtin", definition: lookup as never });
  return createHarness({ registry, model, system });
}

const open = (backend: Backend, key = KEY): Promise<Session> =>
  openSession({ store: backend.store, index: backend.index, lock: backend.lock, key });

const twoSteps = () => [
  {
    content: [
      { type: "text" as const, text: "Looking." },
      { type: "tool_call" as const, callId: "c1", name: "lookup", input: { id: 7 } },
    ],
  },
  { content: [{ type: "text" as const, text: "Done." }] },
];

describe.each(BACKENDS)("%s", (_name, make) => {
  test("toContext() deep-equals the context of the run that wrote the log", async () => {
    const backend = make();
    const { model } = scripted(twoSteps());
    const session = await open(backend);
    const result = await runTurn(session, harnessOf(model), { input: "Triage 7." });
    assert.deepEqual(await session.toContext(), result.context);
    await session.close();
  });

  test("a rebuilt context is what a later turn sends, so a turn in a new process goes on from the log", async () => {
    const backend = make();
    const first = scripted(twoSteps());
    const session = await open(backend);
    await runTurn(session, harnessOf(first.model), { input: "Triage 7." });
    await session.close();
    const second = scripted([{ content: [{ type: "text", text: "Again." }] }]);
    const reopened = await open(backend);
    await runTurn(reopened, harnessOf(second.model), { input: "And 8?" });
    const sent = second.adapter.calls[0]?.context.messages.map((message) => message.role);
    assert.deepEqual(sent, ["user", "assistant", "tool", "assistant", "user"]);
    await reopened.close();
  });

  test("a rebuilt system prompt is the stored turn's, byte for byte, after the harness's prompt changes", async () => {
    const backend = make();
    const { model } = scripted([
      { content: [{ type: "text", text: "a" }] },
      { content: [{ type: "text", text: "b" }] },
    ]);
    const session = await open(backend);
    const oldPrompt = "You triage tickets.\n  Indented line.é ";
    const first = await runTurn(session, harnessOf(model, oldPrompt), { input: "one" });
    await runTurn(session, harnessOf(model, "A new prompt."), { input: "two" });
    assert.equal((await session.toContext(first.lastEntryId)).system, oldPrompt);
    assert.equal((await session.toContext()).system, "A new prompt.");
    await session.close();
  });

  test("continueRun() on a rebuilt context, after a JSON round trip, finishes the scripted run", async () => {
    const backend = make();
    const { model, adapter } = scripted(twoSteps());
    const session = await open(backend);
    const stopped = await runTurn(session, harnessOf(model), { input: "Triage 7.", maxSteps: 1 });
    assert.equal(stopped.stopReason, "max_steps");
    const context = JSON.parse(JSON.stringify(await session.toContext()));
    const finished = await continueRun(context, { model, tools: [lookup] }).result;
    assert.equal(finished.stopReason, "done");
    assert.equal(adapter.calls.length, 2);
    await session.close();
  });
});
