// Composing extensions: the SDK's rules for each moment, in registration order, plus tools and the log's records.
import assert from "node:assert/strict";
import { createModel, type Message, type Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { composeExtensions, type Extension, recordsOf, registerExtensionTools } from "@buildanagent/harness/extensions";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, type Interceptors, type ToolCallEvent } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const gate = (decision: "allow" | "deny" | "ask"): Interceptors => ({
  beforeToolCall: () => (decision === "deny" ? { decision, reason: "no" } : { decision }),
});
const extension = (name: string, rest: Partial<Extension> = {}): Extension => ({ name, version: "1.0.0", ...rest });
const callEvent = (): ToolCallEvent => ({
  runId: "r",
  stepIndex: 0,
  callId: "c1",
  tool: "t",
  input: {},
  signal: new AbortController().signal,
  timestamp: "2026-11-22T00:00:00.000Z",
});
const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });

describe("composeExtensions", () => {
  test("a deny and an allow on the gate yield deny, in either order", async () => {
    for (const order of [
      ["allow", "deny"],
      ["deny", "allow"],
    ] as const) {
      const { interceptors } = composeExtensions(order.map((d, i) => extension(`e${i}`, { interceptors: gate(d) })));
      const decision = await interceptors.beforeToolCall?.(callEvent());
      assert.equal(decision?.decision, "deny");
    }
  });

  test("any ask on the gate yields ask, and an allow alone yields allow", async () => {
    const asked = composeExtensions([
      extension("a", { interceptors: gate("allow") }),
      extension("b", { interceptors: gate("ask") }),
    ]);
    assert.equal((await asked.interceptors.beforeToolCall?.(callEvent()))?.decision, "ask");
    const allowed = composeExtensions([extension("a", { interceptors: gate("allow") })]);
    assert.equal((await allowed.interceptors.beforeToolCall?.(callEvent()))?.decision, "allow");
  });

  test("two transformContext extensions chain in registration order", async () => {
    const add = (text: string): Interceptors => ({
      transformContext: (event) => [...event.messages, user(text)],
    });
    const { interceptors } = composeExtensions([
      extension("first", { interceptors: add("A") }),
      extension("second", { interceptors: add("B") }),
    ]);
    const view = await interceptors.transformContext?.({
      runId: "r",
      stepIndex: 0,
      signal: new AbortController().signal,
      timestamp: "2026-11-22T00:00:00.000Z",
      system: "s",
      messages: [user("start")],
      model: { api: "a", provider: "p", id: "m" },
    });
    assert.deepEqual(
      (view ?? []).map((m) => (m.role === "user" ? m.content[0] : null)),
      [
        { type: "text", text: "start" },
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
    );
  });

  test("observers are joined in registration order", () => {
    const seen: string[] = [];
    const { observers } = composeExtensions([
      extension("a", { observers: [() => void seen.push("a")] }),
      extension("b", { observers: [() => void seen.push("b")] }),
    ]);
    for (const observer of observers) observer({ type: "run_end" } as never);
    assert.deepEqual(seen, ["a", "b"]);
  });

  test("a tools-only extension does not turn another's lenient onFailure back into fail-closed", () => {
    const { interceptors } = composeExtensions([
      extension("lenient", { interceptors: { ...gate("allow"), onFailure: "continue" } }),
      extension("tools-only", { tools: [] }),
    ]);
    assert.equal(interceptors.onFailure, "continue");
  });

  test("tools-only extensions compose to an empty set that leaves a host's own onFailure alone", () => {
    assert.deepEqual(composeExtensions([extension("t", { tools: [] })]).interceptors, {});
  });

  test("an extension with no name, or a name another one has, is refused", () => {
    for (const bad of [[extension("")], [extension("same"), extension("same")]]) {
      assert.throws(
        () => composeExtensions(bad),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_extension",
      );
    }
  });
});

describe("extension tools and records", () => {
  const tool = (toolName: string) => ({
    name: toolName,
    definition: defineTool({
      name: toolName,
      description: "A tool.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: toolName }] };
      },
    }) as never,
  });

  test("an extension's tools register with source extension, and override replaces a built-in", () => {
    const registry = createToolRegistry();
    registry.register({ source: "builtin", ...tool("read") });
    registerExtensionTools(registry, [
      extension("e", { tools: [tool("lookup"), { ...tool("read"), override: true }] }),
    ]);
    assert.equal(registry.get("lookup")?.source, "extension");
    assert.equal(registry.get("read")?.source, "extension");
  });

  test("a tool name that is taken, or repeated, leaves the registry as it was", () => {
    const registry = createToolRegistry();
    registry.register({ source: "builtin", ...tool("read") });
    assert.throws(
      () => registerExtensionTools(registry, [extension("e", { tools: [tool("fresh"), tool("read")] })]),
      (error: unknown) => isHarnessError(error) && error.code === "duplicate_tool",
    );
    assert.equal(registry.get("fresh"), undefined);
  });

  test("a harness writes an extension_loaded entry once per extension and hash", async () => {
    const records = await recordsOf([extension("audit")]);
    const adapter = new ScriptedModel([
      { usage: {}, content: [{ type: "text", text: "One." }] },
      { usage: {}, content: [{ type: "text", text: "Two." }] },
    ]);
    const harness = createHarness({
      registry: createToolRegistry(),
      model: createModel({ adapter, id: "m", retries: 0 }) as Model,
      system: "You help.",
      extensionRecords: records,
    });
    const backend = memoryBackend();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    await runTurn(session, harness, { input: "Hi" });
    await runTurn(session, harness, { input: "Again" });
    const loaded = [];
    for await (const entry of backend.store.load(KEY)) if (entry.type === "extension_loaded") loaded.push(entry);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.name, "audit");
    assert.equal(loaded[0]?.tier, "in_process");
    assert.match(loaded[0]?.contentHash ?? "", /^sha256:[0-9a-f]{64}$/);
  });
});
