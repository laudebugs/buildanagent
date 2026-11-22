// The five modes, and shadow mode's wrapper that records a call instead of running it.
import assert from "node:assert/strict";
import { createModel } from "@buildanagent/gateway";
import { createPermissionPipeline, type PermissionMode } from "@buildanagent/harness/permissions";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { base, call, input, recorder, registryOf, tool } from "./helpers.js";

const decide = (mode: PermissionMode, name: string, extra = {}) => {
  const pipeline = createPermissionPipeline({ ...base, interactive: false, mode, ...extra }, registryOf());
  pipeline.shadowWrapper(recorder());
  return pipeline.decide(call(name), input());
};

test("default mode adds no rule of its own, so only rules and the no-match default decide", async () => {
  assert.equal((await decide("default", "write")).decision, "deny");
  assert.equal((await decide("default", "write", { allow: [{ tool: "write" }] })).decision, "allow");
});

test("accept_edits allows the edit tools and leaves every other tool to the later steps", async () => {
  for (const name of ["write", "edit"]) assert.equal((await decide("accept_edits", name)).decision, "allow", name);
  assert.equal((await decide("accept_edits", "bash")).decision, "deny", "bash is not an edit, so headless denies it");
  assert.equal((await decide("accept_edits", "bash", { allow: [{ tool: "bash" }] })).decision, "allow");
  assert.equal(
    (await decide("accept_edits", "bash", { editTools: ["bash"] })).decision,
    "allow",
    "the edit set is configurable",
  );
});

test("read_only allows the read tools, denies everything else, and a rule can't widen it", async () => {
  for (const name of ["read", "grep", "glob"]) assert.equal((await decide("read_only", name)).decision, "allow", name);
  const write = await decide("read_only", "write", { allow: [{ tool: "write" }] });
  assert.deepEqual([write.decision, write.rule], ["deny", "mode:read_only"]);
  assert.equal(
    (await decide("read_only", "mcp__github__search", { readOnlyTools: ["mcp__github__*"] })).decision,
    "allow",
  );
});

test("bypass allows what no deny or ask rule stopped, and skips the no-match default", async () => {
  assert.equal((await decide("bypass", "bash")).decision, "allow");
  assert.equal((await decide("bypass", "bash", { deny: [{ tool: "bash" }] })).decision, "deny");
});

test("shadow mode allows a call after the hooks and deny rules, and skips questions because nothing runs", async () => {
  assert.equal((await decide("shadow", "bash")).decision, "allow");
  assert.equal((await decide("shadow", "bash", { ask: [{ tool: "bash" }] })).decision, "allow");
  assert.equal(
    (await decide("shadow", "bash", { hooks: [async () => ({ decision: "ask" as const, reason: "?" })] })).decision,
    "allow",
  );
  assert.equal(
    (await decide("shadow", "bash", { deny: [{ tool: "bash" }] })).decision,
    "deny",
    "a deny is still recorded as the answer",
  );
});

async function shadowRun(mode: PermissionMode) {
  const ran: string[] = [];
  const registry = createToolRegistry();
  registry.register({ name: "write", source: "builtin", definition: tool("write", () => ran.push("write")) });
  const session = recorder();
  const pipeline = createPermissionPipeline({ ...base, mode }, registry);
  const adapter = new ScriptedModel([
    { content: [{ type: "tool_call", callId: "c1", name: "write", input: { path: "a.txt" } }] },
    { content: [{ type: "text", text: "Done." }] },
  ]);
  const result = await run({
    model: createModel({ adapter, id: "scripted-model", retries: 0 }),
    system: "You use tools.",
    input: "Go.",
    tools: registry.definitions(pipeline.shadowWrapper(session)),
    interceptors: pipeline.gate(() => input(session)),
  }).result;
  return { ran, session, result };
}

test("in shadow mode the tool's execute never runs, and a shadow_call entry is written beside the decision", async () => {
  const { ran, session, result } = await shadowRun("shadow");
  assert.equal(result.stopReason, "done");
  assert.deepEqual(ran, [], "the real tool did not run");
  assert.deepEqual(
    session.entries.map((entry) => entry.type),
    ["permission_decision", "shadow_call"],
  );
  const shadow = session.entries[1];
  assert.equal(shadow?.type === "shadow_call" ? shadow.tool : "", "write");
  assert.equal(shadow?.type === "shadow_call" ? shadow.callId : "", "c1");
});

test("outside shadow mode the wrapper leaves the tool as registered", async () => {
  const { ran, session } = await shadowRun("bypass");
  assert.deepEqual(ran, ["write"]);
  assert.deepEqual(
    session.entries.map((entry) => entry.type),
    ["permission_decision"],
  );
});

test("a pipeline in shadow mode refuses every call until its shadowWrapper() has been taken", async () => {
  const pipeline = createPermissionPipeline({ ...base, mode: "shadow" }, registryOf());
  const refused = await pipeline.decide(call("bash"), input());
  assert.deepEqual([refused.decision, refused.rule], ["deny", "shadow_unwrapped"]);
  pipeline.shadowWrapper(recorder());
  assert.equal((await pipeline.decide(call("bash"), input())).decision, "allow");
});

test("an ask rule or a hook's ask can't widen read_only, because the mode's denial comes first", async () => {
  const hook = async () => ({ decision: "ask" as const, reason: "?" });
  for (const extra of [{ ask: [{ tool: "write" }] }, { hooks: [hook] }]) {
    const decision = await decide("read_only", "write", extra);
    assert.deepEqual([decision.decision, decision.rule], ["deny", "mode:read_only"]);
  }
  assert.equal(
    (await decide("read_only", "read", { ask: [{ tool: "read" }] })).decision,
    "ask",
    "an allowed tool can still ask",
  );
});
