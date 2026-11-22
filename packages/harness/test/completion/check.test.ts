// The completion check: configured or discovered checks run in the sandbox, diff flags are recorded, and the turn still ends done.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import type { ExecOptions, ExecResult, Sandbox, SandboxPolicy } from "@buildanagent/harness/sandbox";
import { createHarness } from "@buildanagent/harness/server";
import {
  type CompletionSettings,
  flagChanges,
  gitSnapshotter,
  openSession,
  resolveChecks,
  runCompletionCheck,
  runTurn,
  type SessionEntry,
  type WorkspaceSnapshot,
} from "@buildanagent/harness/session";
import { fakeSandbox } from "@buildanagent/harness/testing";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const POLICY: SandboxPolicy = { readRoots: ["/work"], writeRoots: ["/work"], network: { allow: [], deny: [] } };
const ENV = { PATH: "/usr/bin" };
const signal = new AbortController().signal;

/** A fake sandbox holding `files`, whose commands in `replies` (joined by spaces) answer as scripted. */
async function sandboxWith(files: Record<string, string>, replies: Record<string, ExecResult> = {}) {
  const client = fakeSandbox();
  const inner = await client.provision({ root: "/work", files }, POLICY);
  const ran: string[] = [];
  const sandbox: Sandbox = {
    readFile: (path) => inner.readFile(path),
    writeFile: (path, data) => inner.writeFile(path, data),
    dispose: () => inner.dispose(),
    exec(command: readonly string[], options: ExecOptions) {
      const key = command.join(" ");
      ran.push(key);
      return Promise.resolve(replies[key] ?? undefined).then((reply) => reply ?? inner.exec(command, options));
    },
  };
  return { sandbox, ran, client };
}

const exit = (exitCode: number): ExecResult => ({ exitCode, stdout: "", stderr: "" });
const snap = (files: Record<string, string>): WorkspaceSnapshot => new Map(Object.entries(files));
const settingsOf = (sandbox: Sandbox, extra: Partial<CompletionSettings> = {}): CompletionSettings => ({
  sandbox,
  env: ENV,
  ...extra,
});

describe("discovery", () => {
  test("a project with only a test script runs test and records its exit code", async () => {
    const { sandbox, ran } = await sandboxWith(
      { "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "tsc" } }) },
      { "npm run test": exit(3) },
    );
    const outcome = await runCompletionCheck(settingsOf(sandbox), undefined, signal);
    assert.deepEqual(outcome.checks, [{ command: "npm run test", exitCode: 3 }]);
    assert.equal(outcome.passed, false);
    assert.deepEqual(outcome.flagged, []);
    assert.deepEqual(ran, ["npm run test"]);
  });

  test("typecheck, test and check run in that order with the runner the lockfile names", async () => {
    const scripts = { check: "x", test: "x", typecheck: "x", lint: "x" };
    const { sandbox } = await sandboxWith({
      "package.json": JSON.stringify({ scripts }),
      "pnpm-lock.yaml": "lockfileVersion: 9",
    });
    assert.deepEqual(await resolveChecks(sandbox), {
      source: "discovered",
      commands: [
        ["pnpm", "run", "typecheck"],
        ["pnpm", "run", "test"],
        ["pnpm", "run", "check"],
      ],
    });
    const yarn = await sandboxWith({ "package.json": JSON.stringify({ scripts }), "yarn.lock": "" });
    assert.deepEqual((await resolveChecks(yarn.sandbox)).commands[0], ["yarn", "run", "typecheck"]);
  });

  test("a Makefile test target is the fallback, and scripts win over it", async () => {
    const make = await sandboxWith({ Makefile: "build:\n\tcc x\n\ntest: build\n\t./run\n" });
    assert.deepEqual((await resolveChecks(make.sandbox)).commands, [["make", "test"]]);
    const both = await sandboxWith({
      Makefile: "test:\n\ttrue\n",
      "package.json": JSON.stringify({ scripts: { check: "x" } }),
    });
    assert.deepEqual((await resolveChecks(both.sandbox)).commands, [["npm", "run", "check"]]);
    const none = await sandboxWith({ Makefile: "build:\n\ttrue\n", "package.json": "not json" });
    assert.deepEqual((await resolveChecks(none.sandbox)).commands, []);
  });
});

describe("configured checks", () => {
  test("completionChecks replace discovery, as a string or a list, and an empty list runs nothing", async () => {
    const { sandbox, ran } = await sandboxWith({
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
      ".agents/harness.json": JSON.stringify({ completionChecks: ["true", ["false"], "echo   two words"] }),
    });
    const outcome = await runCompletionCheck(settingsOf(sandbox), undefined, signal);
    assert.deepEqual(outcome.checks, [
      { command: "true", exitCode: 0 },
      { command: "false", exitCode: 1 },
      { command: "echo two words", exitCode: 0 },
    ]);
    assert.equal(outcome.passed, false);
    assert.ok(!ran.includes("npm run test"), "discovery did not run");
    const empty = await sandboxWith({
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
      ".agents/harness.json": JSON.stringify({ completionChecks: [] }),
    });
    const none = await runCompletionCheck(settingsOf(empty.sandbox), undefined, signal);
    assert.deepEqual(none, { checks: [], passed: true, flagged: [] });
  });

  test("a config without completionChecks leaves discovery on, and a bad config is refused", async () => {
    const other = await sandboxWith({
      ".agents/harness.json": JSON.stringify({ other: 1 }),
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
    });
    assert.equal((await resolveChecks(other.sandbox)).source, "discovered");
    for (const config of [
      "{",
      "[]",
      '{"completionChecks":"test"}',
      '{"completionChecks":[""]}',
      '{"completionChecks":[[]]}',
      '{"completionChecks":[1]}',
    ]) {
      const bad = await sandboxWith({ ".agents/harness.json": config });
      await assert.rejects(
        resolveChecks(bad.sandbox),
        (error) => isHarnessError(error) && error.code === "invalid_completion_config",
        config,
      );
    }
  });

  test("a check runs with the timeout, and a check that outlasts it exits 124", async () => {
    const { sandbox, client } = await sandboxWith({
      ".agents/harness.json": JSON.stringify({ completionChecks: ["sleep 5", "true"] }),
    });
    const outcome = await runCompletionCheck(settingsOf(sandbox, { timeoutMs: 20 }), undefined, signal);
    assert.deepEqual(outcome.checks, [
      { command: "sleep 5", exitCode: 124 },
      { command: "true", exitCode: 0 },
    ]);
    assert.deepEqual(
      client.execs.map((exec) => exec.timeoutMs),
      [20, 20],
    );
    assert.equal(outcome.passed, false);
  });

  test("a check the sandbox refuses is recorded with exit code 126 and a flag", async () => {
    const { sandbox } = await sandboxWith(
      { ".agents/harness.json": JSON.stringify({ completionChecks: ["pnpm test"] }) },
      { "pnpm test": { denied: { kind: "network", target: "registry", reason: "no network" } } },
    );
    const outcome = await runCompletionCheck(settingsOf(sandbox), undefined, signal);
    assert.deepEqual(outcome.checks, [{ command: "pnpm test", exitCode: 126 }]);
    assert.deepEqual(outcome.flagged, ["check refused by the sandbox: pnpm test: no network"]);
  });
});

describe("diff flags", () => {
  test("an added skip marker is flagged, in each of the three forms the plan names", () => {
    const before = snap({ "a.test.ts": "it('a', () => { expect(1).toBe(1); });\n" });
    const after = snap({
      "a.test.ts": [
        "it.skip('a', () => { expect(1).toBe(1); });",
        "test.skip('b', () => {});",
        "describe.skip('c', () => {});",
        "xit('d', () => {});",
      ].join("\n"),
      "t.py": "@pytest.mark.skip(reason='later')\ndef test_x(): pass\n",
    });
    const flags = flagChanges(before, after);
    assert.equal(flags.filter((flag) => flag.startsWith("skip marker added: a.test.ts")).length, 4);
    assert.ok(flags.includes("skip marker added: t.py: @pytest.mark.skip(reason='later')"));
  });

  test("a deleted test file is flagged, and a deleted source file is not", () => {
    const flags = flagChanges(
      snap({ "src/a.ts": "x", "src/a.test.ts": "expect(a)", "tests/b.py": "assert b", "docs/test.md": "y" }),
      snap({ "docs/test.md": "y" }),
    );
    assert.deepEqual(flags, ["test file deleted: src/a.test.ts", "test file deleted: tests/b.py"]);
  });

  test("a test file with fewer assertion lines is flagged, and one with as many or more is not", () => {
    const three = "expect(a).toBe(1);\nexpect(b).toBe(2);\nassert.equal(c, 3);\n";
    const flags = flagChanges(
      snap({
        "a.spec.ts": three,
        "b.spec.ts": three,
        "c.spec.ts": three,
        "lib.ts": three,
        "test_d.py": "assert x\nassert y\n",
      }),
      snap({
        "a.spec.ts": "expect(a).toBe(1);\n",
        "b.spec.ts": `${three}expect(d).toBe(4);\n`,
        "c.spec.ts": three.replace("expect(a)", "expect(a)  "),
        "lib.ts": "x",
        "test_d.py": "assert x\n",
      }),
    );
    assert.deepEqual(flags, [
      "fewer assertion lines in a.spec.ts: 3 before, 1 after",
      "fewer assertion lines in test_d.py: 2 before, 1 after",
    ]);
  });

  test("placeholders and mock, stub or fake file names are flagged, only when added", () => {
    const flags = flagChanges(
      snap({ "old.ts": "// TODO: later\n", "keep-mock.ts": "x" }),
      snap({
        "old.ts": "// TODO: later\nconst a = 1; // FIXME\nthrow new Error('Not implemented');\n",
        "keep-mock.ts": "x",
        "src/fake-db.ts": "x",
        "src/Stubs.ts": "x",
        "src/real.ts": "x",
      }),
    );
    assert.deepEqual(flags, [
      "placeholder added: old.ts: const a = 1; // FIXME",
      "placeholder added: old.ts: throw new Error('Not implemented');",
      "mock, stub or fake file added: src/Stubs.ts",
      "mock, stub or fake file added: src/fake-db.ts",
    ]);
  });

  test("a moved line is not an added one, and a long list of flags is cut", () => {
    assert.deepEqual(flagChanges(snap({ "a.ts": "a\nit.skip('x')\nb" }), snap({ "a.ts": "it.skip('x')\na\nb" })), []);
    const many = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`f${String(i).padStart(3, "0")}.ts`, "// TODO"]),
    );
    const flags = flagChanges(snap({}), snap(many));
    assert.equal(flags.length, 101);
    assert.equal(flags.at(-1), "20 more flags not listed");
  });
});

describe("the git snapshot", () => {
  test("it reads the listed text files and leaves out a deleted, binary or unlisted one", async () => {
    const { sandbox } = await sandboxWith(
      { "a.ts": "one", "bin.dat": "x", "unlisted.ts": "u" },
      {
        "git ls-files -z --cached --others --exclude-standard": {
          exitCode: 0,
          stdout: "a.ts\0gone.ts\0bin.dat\0",
          stderr: "",
        },
      },
    );
    await sandbox.writeFile("bin.dat", new Uint8Array([1, 0, 2]));
    const taken = await gitSnapshotter(sandbox, { env: ENV, signal });
    assert.deepEqual([...(taken ?? [])], [["a.ts", "one"]]);
  });

  test("it returns nothing where the workspace is no repository", async () => {
    const { sandbox } = await sandboxWith({}, { "git ls-files -z --cached --others --exclude-standard": exit(128) });
    assert.equal(await gitSnapshotter(sandbox, { env: ENV, signal }), undefined);
    const bare = await sandboxWith({});
    assert.equal(await gitSnapshotter(bare.sandbox, { env: ENV, signal }), undefined);
  });
});

/** A snapshotter that returns each scripted snapshot in turn: the start state first, then the end state. */
function scriptedDiff(...snapshots: WorkspaceSnapshot[]): NonNullable<CompletionSettings["snapshotter"]> {
  let next = 0;
  return async () => snapshots[Math.min(next++, snapshots.length - 1)];
}

const model = (adapter: ScriptedModel) => createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;

async function turn(
  settings: CompletionSettings,
  steps: ConstructorParameters<typeof ScriptedModel>[0],
  maxSteps?: number,
) {
  const registry = createToolRegistry();
  registry.register({
    name: "lookup",
    source: "builtin",
    definition: defineTool({
      name: "lookup",
      description: "Looks up.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: "found" }] };
      },
    }) as never,
  });
  const harness = createHarness({ registry, model: model(new ScriptedModel(steps)), system: "You fix bugs." });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  const events: SessionEntry[] = [];
  const result = await runTurn(session, harness, {
    input: "Fix it.",
    completion: settings,
    onCompletionCheck: (entry) => events.push(entry),
    ...(maxSteps === undefined ? {} : { maxSteps }),
  });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  return { result, entries, events };
}

describe("a turn that checks its completion", () => {
  const done = [{ content: [{ type: "text" as const, text: "Fixed." }] }];

  test("an added it.skip( is flagged and a failing check recorded, and the run still ends done", async () => {
    const { sandbox } = await sandboxWith({ ".agents/harness.json": JSON.stringify({ completionChecks: ["false"] }) });
    const snapshotter = scriptedDiff(
      snap({ "a.test.ts": "it('a', () => { expect(1).toBe(1); });" }),
      snap({ "a.test.ts": "it.skip('a', () => { expect(1).toBe(1); });" }),
    );
    const { result, entries, events } = await turn(settingsOf(sandbox, { snapshotter }), done);
    assert.equal(result.stopReason, "done");
    const check = entries.find((entry) => entry.type === "completion_check");
    assert.ok(check?.type === "completion_check");
    assert.deepEqual(check.checks, [{ command: "false", exitCode: 1 }]);
    assert.equal(check.passed, false);
    assert.deepEqual(check.flagged, ["skip marker added: a.test.ts: it.skip('a', () => { expect(1).toBe(1); });"]);
    assert.equal(check.origin, "harness");
    // The entry follows the turn's end, it is the log's last, and the callback saw the same entry.
    assert.equal(entries.at(-1)?.id, check.id);
    assert.equal(entries.at(-2)?.type, "turn_end");
    assert.equal(result.lastEntryId, check.id);
    assert.deepEqual(events, [check]);
  });

  test("a deleted test file and a test file with fewer expect lines are both flagged", async () => {
    const { sandbox } = await sandboxWith({ ".agents/harness.json": JSON.stringify({ completionChecks: ["true"] }) });
    const snapshotter = scriptedDiff(
      snap({ "gone.test.ts": "expect(1)", "kept.test.ts": "expect(1)\nexpect(2)" }),
      snap({ "kept.test.ts": "expect(1)" }),
    );
    const { result, entries } = await turn(settingsOf(sandbox, { snapshotter }), done);
    const check = entries.find((entry) => entry.type === "completion_check");
    assert.equal(result.stopReason, "done");
    assert.ok(check?.type === "completion_check");
    assert.equal(check.passed, true);
    assert.deepEqual(check.flagged, [
      "test file deleted: gone.test.ts",
      "fewer assertion lines in kept.test.ts: 2 before, 1 after",
    ]);
  });

  test("a turn that does not end done writes no completion_check entry", async () => {
    const { sandbox, ran } = await sandboxWith({
      ".agents/harness.json": JSON.stringify({ completionChecks: ["true"] }),
    });
    const steps = [{ content: [{ type: "tool_call" as const, callId: "c1", name: "lookup", input: {} }] }, ...done];
    const { result, entries, events } = await turn(
      settingsOf(sandbox, { snapshotter: scriptedDiff(snap({})) }),
      steps,
      1,
    );
    assert.equal(result.stopReason, "max_steps");
    assert.ok(!entries.some((entry) => entry.type === "completion_check"));
    assert.deepEqual(events, []);
    assert.deepEqual(ran, []);
  });

  test("a workspace that can't be diffed still gets its checks, with no flags", async () => {
    const { sandbox } = await sandboxWith({ ".agents/harness.json": JSON.stringify({ completionChecks: ["true"] }) });
    const { entries } = await turn(settingsOf(sandbox), done);
    const check = entries.find((entry) => entry.type === "completion_check");
    assert.ok(check?.type === "completion_check");
    assert.deepEqual([check.checks, check.passed, check.flagged], [[{ command: "true", exitCode: 0 }], true, []]);
  });

  test("a turn without completion settings writes no completion_check entry", async () => {
    const registry = createToolRegistry();
    const harness = createHarness({ registry, model: model(new ScriptedModel(done)), system: "s" });
    const backend = memoryBackend();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const result = await runTurn(session, harness, { input: "Hi." });
    assert.equal(result.stopReason, "done");
    for await (const entry of backend.store.load(KEY)) assert.notEqual(entry.type, "completion_check");
  });
});
