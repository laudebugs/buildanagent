// Ablation switches: every removable component has one flag, a deterministic hash stamped into session_header,
// fail-safe removal (proxy off -> no credentials, sandbox "none" -> unsafe: true), and a scripted offline matrix.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import {
  type AblationConfig,
  type AblationOverrides,
  ablationHash,
  credentialEnvOf,
  DEFAULT_ABLATION,
  defaultAblation,
  validateAblation,
} from "@buildanagent/harness/ablation";
import { createContextPolicy, type SpillStore } from "@buildanagent/harness/context";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionStore } from "@buildanagent/harness/session";
import { fakeSandbox } from "@buildanagent/harness/testing";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { KEY, memoryBackend } from "./session/session-helpers.js";

const scripted = (steps: ConstructorParameters<typeof ScriptedModel>[0]) => {
  const adapter = new ScriptedModel(steps);
  return createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
};

const memorySpill = (): SpillStore => {
  const files = new Map<string, string>();
  return {
    async write(_key, callId, text) {
      const path = `/spills/${callId}.txt`;
      files.set(path, text);
      return path;
    },
  };
};

async function entriesOf(store: SessionStore) {
  const found = [];
  for await (const entry of store.load(KEY)) found.push(entry);
  return found;
}

describe("AblationConfig and ablationHash", () => {
  test("omits the non-removable spine (log, permission pipeline, protocol)", () => {
    const keys = Object.keys(DEFAULT_ABLATION);
    for (const forbidden of ["log", "sessionLog", "pipeline", "permissions", "protocol"]) {
      assert.ok(!keys.includes(forbidden), `AblationConfig must not expose ${forbidden}`);
    }
  });

  test("produces the same sha256 hash regardless of object key order", () => {
    const a: AblationConfig = {
      context: { write_cap: true, mask: false, summarize: true, mid_turn: true, overflow_retry: false },
      mcp: true,
      extensions: { inProcess: true, mcp: false, skills: true },
      toolSearch: false,
      credentialProxy: true,
      telemetry: true,
      completionCheck: false,
      sandbox: "os",
    };
    const b: AblationConfig = {
      sandbox: "os",
      completionCheck: false,
      telemetry: true,
      credentialProxy: true,
      toolSearch: false,
      extensions: { skills: true, mcp: false, inProcess: true },
      mcp: true,
      context: { overflow_retry: false, mid_turn: true, summarize: true, mask: false, write_cap: true },
    };
    const hashA = ablationHash(a);
    assert.match(hashA, /^sha256:[0-9a-f]{64}$/);
    assert.equal(hashA, ablationHash(b));
  });

  test("changes the hash whenever any single flag differs", () => {
    const base = defaultAblation();
    const variants: [string, AblationConfig][] = [
      ["context.write_cap", defaultAblation({ context: { write_cap: false } })],
      ["context.mask", defaultAblation({ context: { mask: false } })],
      ["context.summarize", defaultAblation({ context: { summarize: false } })],
      ["context.mid_turn", defaultAblation({ context: { mid_turn: false } })],
      ["context.overflow_retry", defaultAblation({ context: { overflow_retry: false } })],
      ["mcp", defaultAblation({ mcp: false })],
      ["extensions.inProcess", defaultAblation({ extensions: { inProcess: false } })],
      ["extensions.mcp", defaultAblation({ extensions: { mcp: false } })],
      ["extensions.skills", defaultAblation({ extensions: { skills: false } })],
      ["toolSearch", defaultAblation({ toolSearch: false })],
      ["credentialProxy", defaultAblation({ credentialProxy: false })],
      ["telemetry", defaultAblation({ telemetry: false })],
      ["completionCheck", defaultAblation({ completionCheck: false })],
      ["sandbox: container", defaultAblation({ sandbox: "container" })],
      ["sandbox: none", defaultAblation({ sandbox: "none", unsafe: true })],
    ];
    const seen = new Map<string, string>([[ablationHash(base), "baseline"]]);
    for (const [label, config] of variants) {
      const hash = ablationHash(config);
      assert.ok(!seen.has(hash), `${label} collided with ${seen.get(hash)}`);
      seen.set(hash, label);
    }
  });

  test("refuses sandbox: none unless unsafe: true is explicitly set", () => {
    const unacknowledged: AblationConfig = { ...DEFAULT_ABLATION, sandbox: "none" };
    const expectUnsafe = (fn: () => unknown) => {
      assert.throws(fn, (err: unknown) => isHarnessError(err) && err.code === "unsafe_sandbox_not_acknowledged");
    };
    expectUnsafe(() => validateAblation(unacknowledged));
    expectUnsafe(() => ablationHash(unacknowledged));
    expectUnsafe(() => defaultAblation({ sandbox: "none" }));
    expectUnsafe(() =>
      createHarness({
        registry: createToolRegistry(),
        model: scripted([{ content: [{ type: "text", text: "ok" }] }]),
        system: "sys",
        ablation: unacknowledged,
      }),
    );

    const acknowledged = defaultAblation({ sandbox: "none", unsafe: true });
    assert.equal(acknowledged.sandbox, "none");
    assert.match(ablationHash(acknowledged), /^sha256:[0-9a-f]{64}$/);
  });

  test("credentialEnvOf returns no credentials when credentialProxy is false", () => {
    const creds = { SERVICE_TOKEN: "tok_live_123" };
    assert.deepEqual(credentialEnvOf(defaultAblation({ credentialProxy: true }), creds), creds);
    assert.deepEqual(credentialEnvOf(defaultAblation({ credentialProxy: false }), creds), {});
  });
});

function assertArmEntries(
  entries: Awaited<ReturnType<typeof entriesOf>>,
  ablation: AblationConfig,
  observed: readonly string[],
) {
  const header = entries.find((e) => e.type === "session_header");
  assert.ok(header !== undefined && header.type === "session_header");
  assert.equal(header.ablationHash, ablationHash(ablation));

  const stamp = entries.find((e) => e.type === "env_stamp");
  assert.ok(stamp !== undefined && stamp.type === "env_stamp");
  assert.equal(stamp.sandbox, ablation.sandbox);

  assert.equal(observed.length > 0, ablation.telemetry);
  assert.equal(entries.filter((e) => e.type === "completion_check").length, ablation.completionCheck ? 1 : 0);

  if (!ablation.credentialProxy) {
    const toolResults = entries.filter((e) => e.type === "tool_result");
    assert.equal(toolResults.length, 1);
    assert.equal(toolResults[0]?.isError, true);
  }

  const loadedNames = entries.filter((e) => e.type === "extension_loaded").map((e) => e.name);
  if (!ablation.extensions.inProcess) assert.ok(!loadedNames.includes("ext-inproc"));
  if (!ablation.mcp || !ablation.extensions.mcp) assert.ok(!loadedNames.includes("ext-mcp"));
}

describe("scripted ablation matrix", () => {
  const arms: readonly {
    readonly name: string;
    readonly overrides: AblationOverrides;
    readonly callCredTool?: boolean;
  }[] = [
    { name: "baseline (all on)", overrides: {} },
    { name: "context.write_cap off", overrides: { context: { write_cap: false } } },
    { name: "context.mask off", overrides: { context: { mask: false } } },
    { name: "context.summarize off", overrides: { context: { summarize: false } } },
    { name: "context.mid_turn off", overrides: { context: { mid_turn: false } } },
    { name: "context.overflow_retry off", overrides: { context: { overflow_retry: false } } },
    { name: "mcp off", overrides: { mcp: false } },
    { name: "extensions.inProcess off", overrides: { extensions: { inProcess: false } } },
    { name: "extensions.mcp off", overrides: { extensions: { mcp: false } } },
    { name: "extensions.skills off", overrides: { extensions: { skills: false } } },
    { name: "toolSearch off", overrides: { toolSearch: false } },
    { name: "credentialProxy off", overrides: { credentialProxy: false }, callCredTool: true },
    { name: "telemetry off", overrides: { telemetry: false } },
    { name: "completionCheck off", overrides: { completionCheck: false } },
    { name: "sandbox none (unsafe: true)", overrides: { sandbox: "none", unsafe: true } },
  ];

  test.each(arms)(
    "$name completes offline and stamps session_header.ablationHash",
    async ({ overrides, callCredTool }) => {
      const ablation = defaultAblation(overrides);
      // Keep fakeSandbox() for every arm; the sandbox: "none" arm never invokes host tools (bash, write, edit).
      const sandboxClient = fakeSandbox();
      const sandbox = await sandboxClient.provision(
        { root: "/workspace" },
        { readRoots: ["/workspace"], writeRoots: ["/workspace"], network: { allow: [], deny: [] } },
      );

      try {
        const registry = createToolRegistry();
        const credEnv = credentialEnvOf(ablation, { SERVICE_TOKEN: "tok_secret" });
        const apiCall = defineTool({
          name: "call_service",
          description: "Calls an external service that requires SERVICE_TOKEN.",
          inputSchema: { type: "object", properties: {} },
          async execute() {
            if (!credEnv.SERVICE_TOKEN) {
              return { isError: true, content: [{ type: "text", text: "missing credential: SERVICE_TOKEN" }] };
            }
            return { content: [{ type: "text", text: "service ok" }] };
          },
        });
        registry.register({ name: "call_service", source: "builtin", definition: apiCall as never });

        const model =
          ablation.sandbox === "none"
            ? scripted([{ content: [{ type: "text", text: "done without host tools" }] }])
            : scripted([
                { content: [{ type: "tool_call", callId: "c1", name: "call_service", input: {} }] },
                { content: [{ type: "text", text: callCredTool ? "reported missing credential" : "done" }] },
              ]);

        const context = createContextPolicy({
          ...(ablation.context.write_cap ? { spill: memorySpill() } : {}),
          layers: ablation.context,
        });

        const observed: string[] = [];
        const harness = createHarness({
          registry,
          model,
          system: "You run scripted ablation checks.",
          ablation,
          context,
          observers: [
            (event) => {
              observed.push(event.type);
            },
          ],
          extensionRecords: [
            { name: "ext-inproc", tier: "in_process", contentHash: "sha256:01" },
            { name: "ext-mcp", tier: "mcp", contentHash: "sha256:02" },
          ],
          skills: [{ name: "demo", description: "Demo skill", path: "/workspace/.agents/skills/demo/SKILL.md" }],
        });

        const backend = memoryBackend();
        const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
        const result = await runTurn(session, harness, {
          input: "run arm",
          completion: { sandbox, env: {} },
        });

        assert.equal(result.stopReason, "done");
        assertArmEntries(await entriesOf(backend.store), ablation, observed);
      } finally {
        await sandbox.dispose();
      }
    },
  );
});
