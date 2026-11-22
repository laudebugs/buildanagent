// The pipeline's order, its fail-closed behaviour and what it writes. Each ordering rule is its own case.
import assert from "node:assert/strict";
import { createModel } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import {
  createPermissionPipeline,
  type Decision,
  PermissionConfigError,
  type PermissionHook,
} from "@buildanagent/harness/permissions";
import { hmacSigner, run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { base, call, input, recorder, registryOf, tool } from "./helpers.js";

const ALLOW_ALL: Decision = { decision: "allow", reason: "the callback allows it" };

test("a deny rule beats an allow rule, and beats bypass mode", async () => {
  const pipeline = createPermissionPipeline(
    { ...base, mode: "bypass", deny: [{ tool: "bash", reason: "no shell" }], allow: [{ tool: "bash" }] },
    registryOf(),
  );
  const decision = await pipeline.decide(call("bash"), input());
  assert.deepEqual([decision.decision, decision.rule, decision.reason], ["deny", "deny[0]", "no shell"]);
});

test("a hook deny beats an allow rule, bypass mode and a host callback that would allow", async () => {
  const hook: PermissionHook = async () => ({ decision: "deny", reason: "over the limit" });
  const pipeline = createPermissionPipeline(
    {
      ...base,
      mode: "bypass",
      hooks: [hook],
      hostCallback: async () => ALLOW_ALL,
      allow: [{ tool: "read", paths: ["**"] }],
    },
    registryOf(),
  );
  const decision = await pipeline.decide(call("read", { path: "a.txt" }), input());
  assert.deepEqual([decision.decision, decision.by, decision.rule], ["deny", "hook", "hook[0]"]);
});

test("a deny rule beats a hook's ask, because only a deny ends the decision", async () => {
  const hook: PermissionHook = async () => ({ decision: "ask", reason: "check with someone" });
  const pipeline = createPermissionPipeline({ ...base, hooks: [hook], deny: [{ tool: "write" }] }, registryOf());
  assert.equal((await pipeline.decide(call("write"), input())).decision, "deny");
});

test("a hook's ask stands when no deny rule matches, and it comes before an ask rule and the mode", async () => {
  const hook: PermissionHook = async () => ({ decision: "ask", reason: "over the daily count", rule: "daily_cap" });
  const pipeline = createPermissionPipeline(
    { ...base, mode: "bypass", hooks: [hook], ask: [{ tool: "read" }] },
    registryOf(),
  );
  const decision = await pipeline.decide(call("read"), input());
  assert.deepEqual([decision.decision, decision.rule], ["ask", "daily_cap"]);
});

test("an ask rule comes before the mode, so it still asks under bypass", async () => {
  const pipeline = createPermissionPipeline({ ...base, mode: "bypass", ask: [{ tool: "write" }] }, registryOf());
  assert.equal((await pipeline.decide(call("write"), input())).decision, "ask");
});

test("the mode comes before the allow rules and the host callback", async () => {
  let asked = 0;
  const pipeline = createPermissionPipeline(
    {
      ...base,
      mode: "accept_edits",
      hostCallback: async () => {
        asked += 1;
        return { decision: "deny", reason: "the callback refuses" };
      },
    },
    registryOf(),
  );
  const decision = await pipeline.decide(call("edit"), input());
  assert.deepEqual([decision.decision, decision.rule], ["allow", "mode:accept_edits"]);
  assert.equal(asked, 0, "the mode settled it, so the host callback never ran");
});

test("an allow rule comes before the host callback", async () => {
  let asked = 0;
  const pipeline = createPermissionPipeline(
    {
      ...base,
      allow: [{ tool: "bash", commandPrefix: ["git", "status"] }],
      hostCallback: async () => {
        asked += 1;
        return { decision: "deny", reason: "the callback refuses" };
      },
    },
    registryOf(),
  );
  assert.equal((await pipeline.decide(call("bash", { command: "git status" }), input())).decision, "allow");
  assert.equal(asked, 0);
  assert.equal((await pipeline.decide(call("bash", { command: "git push" }), input())).decision, "deny");
  assert.equal(asked, 1, "a command the rule does not cover reaches the host callback");
});

test("the host callback decides last, and its answer is recorded with who gave it", async () => {
  const pipeline = createPermissionPipeline(
    { ...base, hostCallback: async () => ({ ...ALLOW_ALL, by: "classifier:c1" }) },
    registryOf(),
  );
  const session = recorder();
  const decision = await pipeline.decide(call("read"), input(session));
  assert.equal(decision.by, "classifier:c1");
  assert.equal(session.entries[0]?.type === "permission_decision" ? session.entries[0].by : undefined, "classifier:c1");
});

test("a call no rule settles is denied when headless and asks when interactive", async () => {
  const headless = createPermissionPipeline({ ...base, interactive: false }, registryOf());
  const interactive = createPermissionPipeline({ ...base, interactive: true }, registryOf());
  const denied = await headless.decide(call("read"), input());
  const asked = await interactive.decide(call("read"), input());
  assert.deepEqual([denied.decision, denied.rule], ["deny", "no_match"]);
  assert.deepEqual([asked.decision, asked.rule], ["ask", "no_match"]);
});

test("an allow rule that covers every call to a tool throws at construction when a host callback is set", () => {
  const config = { ...base, hostCallback: async () => ALLOW_ALL };
  for (const rule of [{ tool: "read" }, { tool: /^re/ }, { tool: "fetch" }, { tool: "mcp__github__*" }]) {
    assert.throws(
      () => createPermissionPipeline({ ...config, allow: [rule] }, registryOf()),
      (error) =>
        error instanceof PermissionConfigError && isHarnessError(error) && error.code === "invalid_permission_config",
      `${String(rule.tool)} shadows the callback`,
    );
  }
});

test("a configuration of deny rules, hooks and a host callback with no allow rules constructs cleanly", () => {
  const hook: PermissionHook = async () => undefined;
  assert.doesNotThrow(() =>
    createPermissionPipeline(
      { ...base, deny: [{ tool: "bash" }], hooks: [hook], hostCallback: async () => ALLOW_ALL },
      registryOf(),
    ),
  );
  assert.doesNotThrow(
    () =>
      createPermissionPipeline(
        {
          ...base,
          allow: [
            { tool: "bash", commandPrefix: ["ls"] },
            { tool: "write", paths: ["src/**"] },
          ],
          hostCallback: async () => ALLOW_ALL,
        },
        registryOf(),
      ),
    "an allow rule with a path or a command prefix leaves the callback the calls it does not cover",
  );
});

test("a tool registered after construction that an allow rule covers fails closed when the callback is reached", async () => {
  const registry = registryOf(["read"]);
  const pipeline = createPermissionPipeline(
    { ...base, allow: [{ tool: "late" }], hostCallback: async () => ALLOW_ALL },
    registry,
  );
  registry.register({ name: "late", source: "builtin", definition: tool("late") });
  await assert.rejects(pipeline.decide(call("late"), input()), PermissionConfigError);
  const gated = await pipeline.gate(() => input()).beforeToolCall?.({ callId: "c1", tool: "late", input: {} } as never);
  assert.equal(gated?.decision, "deny", "the gate refuses the call and does not let it through");
});

test("a hook cannot return allow: a type error, and a denial at run time", async () => {
  // @ts-expect-error a hook's decision is "deny" or "ask"
  const allowing: PermissionHook = async () => ({ decision: "allow", reason: "trust me" });
  const pipeline = createPermissionPipeline(
    { ...base, hooks: [allowing], hostCallback: async () => ALLOW_ALL },
    registryOf(),
  );
  const decision = await pipeline.decide(call("read"), input());
  assert.deepEqual([decision.decision, decision.by], ["deny", "hook"]);
  assert.match(decision.reason, /may only deny or ask/);
});

test("a hook receives the session, the host context, the entries, the mode and the policy version", async () => {
  let seen: unknown;
  const hook: PermissionHook = async (_call, ctx) => {
    seen = ctx;
    return undefined;
  };
  const session = recorder();
  const entries = [{ type: "turn_end" }] as never;
  const pipeline = createPermissionPipeline({ ...base, mode: "read_only", hooks: [hook] }, registryOf());
  await pipeline.decide(call("read"), { session, hostContext: { user: "ada" }, entries });
  assert.deepEqual(seen, { session, hostContext: { user: "ada" }, entries, mode: "read_only", policyVersion: "p1" });
});

test("every decide() writes one permission_decision entry, for an allow as well as an ask and a deny", async () => {
  const pipeline = createPermissionPipeline(
    { ...base, deny: [{ tool: "bash" }], allow: [{ tool: "read" }] },
    registryOf(),
  );
  const session = recorder();
  await pipeline.decide(call("read", { path: "a" }, "c1"), input(session));
  await pipeline.decide(call("bash", { command: "ls" }, "c2"), input(session));
  await pipeline.decide(call("write", { path: "b" }, "c3"), input(session));
  assert.deepEqual(
    session.entries.map(
      (entry) =>
        entry.type === "permission_decision" && [entry.callId, entry.decision, entry.rule, entry.policyVersion],
    ),
    [
      ["c1", "allow", "allow[0]", "p1"],
      ["c2", "deny", "deny[0]", "p1"],
      ["c3", "ask", "no_match", "p1"],
    ],
  );
  const hashes = session.entries.map((entry) => (entry.type === "permission_decision" ? entry.inputHash : ""));
  assert.ok(
    hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash)),
    "each entry carries the hash of its input",
  );
  assert.equal(new Set(hashes).size, 3, "different inputs have different hashes");
});

test("the entry names the canonical tool when the call used an alias", async () => {
  const pipeline = createPermissionPipeline({ ...base, allow: [{ tool: "fetch" }] }, registryOf());
  const session = recorder();
  const decision = await pipeline.decide(call("web_fetch"), input(session));
  assert.equal(decision.decision, "allow", "a rule by alias matches the tool");
  assert.equal(session.entries[0]?.type === "permission_decision" ? session.entries[0].tool : "", "web_fetch");
});

test("a hook or host callback that throws, or returns nonsense, denies the call", async () => {
  const throwing: PermissionHook = async () => {
    throw new Error("store down");
  };
  const malformed = (async () => ({ decision: "maybe", reason: "?" })) as unknown as PermissionHook;
  for (const hook of [throwing, malformed]) {
    const pipeline = createPermissionPipeline({ ...base, mode: "bypass", hooks: [hook] }, registryOf());
    assert.equal((await pipeline.decide(call("read"), input())).decision, "deny");
  }
  const failing = createPermissionPipeline(
    {
      ...base,
      hostCallback: async () => {
        throw new Error("down");
      },
    },
    registryOf(),
  );
  assert.equal((await failing.decide(call("read"), input())).decision, "deny");
  const garbled = createPermissionPipeline(
    { ...base, hostCallback: (async () => ({ decision: "yes" })) as never },
    registryOf(),
  );
  assert.equal((await garbled.decide(call("read"), input())).decision, "deny");
});

test("an input with no canonical form is denied and still recorded", async () => {
  const pipeline = createPermissionPipeline({ ...base, mode: "bypass" }, registryOf());
  const session = recorder();
  const decision = await pipeline.decide(call("read", { size: 10n }), input(session));
  assert.deepEqual([decision.decision, decision.rule], ["deny", "unreadable_call"]);
  assert.equal(session.entries.length, 1);
});

test("an entry that can't be written fails the call: decide() rejects and the gate denies", async () => {
  const pipeline = createPermissionPipeline({ ...base, mode: "bypass" }, registryOf());
  const broken = {
    async append() {
      throw new Error("disk full");
    },
  };
  await assert.rejects(pipeline.decide(call("read"), input(broken)), /disk full/);
  const gated = await pipeline
    .gate(() => input(broken))
    .beforeToolCall?.({ callId: "c1", tool: "read", input: {} } as never);
  assert.equal(gated?.decision, "deny");
});

test("the gate maps allow, deny and ask, and an ask carries the policy version into the signed request", async () => {
  const adapter = new ScriptedModel([
    { content: [{ type: "tool_call", callId: "c1", name: "write", input: { path: "src/a.ts" } }] },
  ]);
  const ran: string[] = [];
  const registry = registryOf([]);
  registry.register({ name: "write", source: "builtin", definition: tool("write", () => ran.push("write")) });
  const pipeline = createPermissionPipeline({ ...base, ask: [{ tool: "write" }] }, registry);
  const session = recorder();
  const result = await run({
    model: createModel({ adapter, id: "scripted-model", retries: 0 }),
    system: "You use tools.",
    input: "Go.",
    tools: registry.definitions(),
    signer: hmacSigner({ keys: { k1: new Uint8Array(32).fill(3) }, current: "k1" }),
    interceptors: pipeline.gate(() => input(session)),
  }).result;
  assert.equal(result.stopReason, "awaiting_approval");
  assert.equal(result.stopReason === "awaiting_approval" ? result.pending[0]?.policyVersion : undefined, "p1");
  assert.deepEqual(ran, [], "the tool did not run");
  assert.equal(session.entries.length, 1);
});
