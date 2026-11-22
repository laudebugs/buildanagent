// The stdio client end to end: each server is a child process spawned with a cleared environment. These tests treat
// the server as hostile: what reaches it, what it may register, and what happens when it misbehaves.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { connectMcpServer, createMcpManager, McpError, type McpServerStatus } from "@buildanagent/harness/mcp";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createToolRegistry, type ToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { afterEach, describe, test } from "vitest";
import {
  alive,
  callLog,
  callStep,
  doneStep,
  eventually,
  runMcpTurn,
  scratchDir,
  stdioServer,
  toolResults,
} from "./helpers.js";

const KIB = 1024;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const signal = () => new AbortController().signal;

async function connected(registry: ToolRegistry, ...servers: Parameters<typeof createMcpManager>[0]["servers"]) {
  const manager = createMcpManager({ registry, servers });
  closers.push(() => manager.close());
  const statuses = await manager.connect();
  return { manager, statuses };
}

const failure = (status: McpServerStatus | undefined) => (status?.status === "failed" ? status.error : undefined);

describe("the server's environment", () => {
  test("holds spawnEnv's names and the declared variables, and no other parent variable", async () => {
    process.env.N24_CANARY = "canary-value-not-declared";
    process.env.N24_DECLARED = "declared-value";
    try {
      const connection = await connectMcpServer(
        stdioServer("lib", "library", ["legacy"], {
          transport: { env: ["N24_DECLARED"], setEnv: { N24_SET: "set-value" } },
        }),
      );
      closers.push(() => connection.close());
      const [block] = (await connection.callTool("env", {}, signal())).content;
      assert.ok(block?.type === "text");
      const { env } = JSON.parse(block.text) as { env: Record<string, string> };
      assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "N24_DECLARED", "N24_SET", "PATH", "TMPDIR"]);
      assert.equal(env.N24_DECLARED, "declared-value");
      assert.equal(env.N24_SET, "set-value");
      assert.ok(!block.text.includes("canary-value-not-declared"));
      assert.notEqual(env.HOME, process.env.HOME);
      assert.ok(existsSync(env.HOME as string), "the server gets a fresh HOME");
      await connection.close();
      assert.ok(!existsSync(env.HOME as string), "closing removes the fresh HOME");
    } finally {
      delete process.env.N24_CANARY;
      delete process.env.N24_DECLARED;
    }
  });

  test("a declared name that looks like a credential is refused before anything starts", async () => {
    await assert.rejects(
      () => connectMcpServer(stdioServer("lib", "library", ["legacy"], { transport: { env: ["GITHUB_TOKEN"] } })),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_spawn_env",
    );
  });
});

describe("the registered tools", () => {
  test("are named mcp__<server>__<tool>, deferred, untrusted, not first-party and writes, whatever their hints say", async () => {
    const registry = createToolRegistry();
    const { statuses } = await connected(registry, stdioServer("lib", "library", ["modern"]));
    assert.equal(statuses[0]?.status, "connected");
    const names = registry.list().map((tool) => tool.canonicalName);
    assert.ok(names.includes("mcp__lib__echo") && names.includes("mcp__lib__reader"), names.join(", "));
    for (const tool of registry.list()) {
      assert.equal(tool.source, "mcp:lib");
      assert.equal(tool.exposure, "deferred");
      assert.equal(tool.outputTrust, "untrusted");
    }
    const reader = registry.definitions().find((definition) => definition.name === "mcp__lib__reader");
    assert.equal(reader?.firstParty, false);
    assert.deepEqual(reader?.effect, { kind: "write" });
    assert.equal(reader?.annotations, undefined);
    assert.equal(reader?.resourceKey, undefined);
    assert.equal(reader?.exposure, "deferred");
  });

  test("keep the server's hints for display only", async () => {
    const connection = await connectMcpServer(stdioServer("lib", "library", ["modern"]));
    closers.push(() => connection.close());
    const reader = (await connection.listTools()).find((tool) => tool.name === "reader");
    assert.deepEqual(reader?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  });

  test("take the exposure the config names", async () => {
    const registry = createToolRegistry();
    await connected(registry, stdioServer("lib", "library", ["legacy"], { exposure: "direct" }));
    assert.ok(registry.list().every((tool) => tool.exposure === "direct"));
  });

  test("never shadow a built-in or take another server's prefix, whatever the server names them", async () => {
    const registry = createToolRegistry();
    const read = defineTool({
      name: "read",
      description: "Reads.",
      inputSchema: { type: "object" },
      execute: async () => ({ content: [] }),
    });
    registry.register({ name: "read", source: "builtin", definition: read as never });
    const { statuses } = await connected(registry, stdioServer("raw", "raw", ["legacy", "hostile-names"]));
    assert.equal(statuses[0]?.status, "connected", failure(statuses[0])?.message ?? "");
    assert.equal(registry.get("read")?.source, "builtin");
    const mcp = registry.list().filter((tool) => tool.source === "mcp:raw");
    assert.equal(mcp.length, 7);
    for (const tool of mcp) {
      assert.match(tool.canonicalName, /^mcp__raw__[A-Za-z0-9_-]+$/);
      assert.ok(tool.canonicalName.length <= 64);
      assert.ok(!tool.canonicalName.startsWith("mcp__other__"));
    }
    assert.ok(registry.get("tool_search") === undefined);
  });

  for (const [scenario, why] of [
    ["duplicate", /name one tool/],
    ["confusable", /name one tool/],
    ["case", /name one tool/],
    ["too-many", /300 tools, over the limit of 256/],
    ["control-name", /without control characters/],
    ["huge-schema", /input schema over 65536 bytes/],
    // The client library checks this one itself, before the harness's own check.
    ["not-object-schema", /expected \\"object\\"/],
  ] as const) {
    test(`a ${scenario} tool list is refused, the server is closed, and none of its tools is registered`, async () => {
      const registry = createToolRegistry();
      const { manager, statuses } = await connected(registry, stdioServer("raw", "raw", ["legacy", scenario]));
      const error = failure(statuses[0]);
      assert.ok(error instanceof McpError && error.code === "mcp_tool_list_refused", error?.message ?? "");
      assert.match(error.message, why);
      assert.equal(registry.list().length, 0);
      assert.equal(manager.connection("raw"), undefined);
    });
  }

  test("a long description is cut to 4,096 characters", async () => {
    const connection = await connectMcpServer(stdioServer("raw", "raw", ["legacy", "long-description"]));
    closers.push(() => connection.close());
    const [tool] = await connection.listTools();
    assert.equal(tool?.description.length, 4097);
  });

  test("a changed tool list is logged and changes nothing registered", async () => {
    const registry = createToolRegistry();
    const log = callLog();
    const logged: string[] = [];
    const manager = createMcpManager({
      registry,
      servers: [stdioServer("raw", "raw", ["legacy", "rename", log.path])],
      log: (line) => logged.push(line),
    });
    closers.push(() => manager.close());
    await manager.connect();
    const { entries } = await runMcpTurn(registry, [callStep("c1", "mcp__raw__alpha"), doneStep]);
    assert.equal(toolResults(entries).get("c1")?.text, "called alpha");
    assert.ok(await eventually(() => logged.some((line) => line.includes("tool list changed"))));
    assert.deepEqual(
      registry
        .list()
        .filter((tool) => tool.source === "mcp:raw")
        .map((tool) => tool.canonicalName),
      ["mcp__raw__alpha"],
    );
    assert.deepEqual(
      log.read().filter((line) => line.method === "tools/call"),
      [{ method: "tools/call", name: "alpha" }],
    );
  });
});

describe("every call goes through the turn's pipeline", () => {
  test("a denied call never reaches the server, and an allowed one does", async () => {
    const registry = createToolRegistry();
    const log = callLog();
    await connected(registry, stdioServer("lib", "library", ["modern", log.path]));
    const pipeline = createPermissionPipeline(
      {
        mode: "default",
        deny: [{ tool: "mcp__lib__echo", reason: "echo is denied" }],
        allow: [{ tool: "mcp__lib__*" }, { tool: "tool_search" }],
        interactive: false,
        policyVersion: "p1",
      },
      registry,
    );
    const { entries } = await runMcpTurn(
      registry,
      [
        {
          content: [
            ...callStep("c1", "mcp__lib__echo", { text: "denied" }).content,
            ...callStep("c2", "mcp__lib__fails").content,
          ],
        },
        doneStep,
      ],
      { pipeline },
    );
    const decisions = entries.filter((entry) => entry.type === "permission_decision");
    assert.deepEqual(
      decisions.map((entry) => (entry.type === "permission_decision" ? [entry.tool, entry.decision] : [])),
      [
        ["mcp__lib__echo", "deny"],
        ["mcp__lib__fails", "allow"],
      ],
    );
    assert.ok(toolResults(entries).get("c1")?.isError);
    // The server's own log: the allowed call arrived and the denied one never did.
    assert.deepEqual(
      log.read().map((line) => line.tool),
      ["fails"],
    );
  });

  test("a 200 KiB result is capped like any tool result, with the full text in the spill", async () => {
    const registry = createToolRegistry();
    await connected(registry, stdioServer("lib", "library", ["legacy"]));
    const spill = memorySpillStore();
    const { entries } = await runMcpTurn(registry, [callStep("c1", "mcp__lib__big", { bytes: 200 * KIB }), doneStep], {
      context: createContextPolicy({ spill }),
    });
    const entry = entries.find((e) => e.type === "tool_result");
    assert.ok(entry?.type === "tool_result" && entry.spill !== undefined);
    assert.equal(entry.tool, "mcp__lib__big");
    assert.equal(entry.trust, "untrusted");
    assert.equal(entry.spill.bytes, 200 * KIB);
    const stored = entry.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    assert.ok(stored.length <= 64 * KIB, `the model read ${stored.length} characters`);
    assert.ok(stored.includes(entry.spill.path));
    assert.equal(spill.read(entry.spill.path)?.length, 200 * KIB);
  });

  test("the server's own failure reaches the model as an error result", async () => {
    const registry = createToolRegistry();
    await connected(registry, stdioServer("lib", "library", ["legacy"]));
    const { entries } = await runMcpTurn(registry, [callStep("c1", "mcp__lib__fails"), doneStep]);
    assert.deepEqual(toolResults(entries).get("c1"), { text: "it broke", isError: true });
  });
});

describe("the switch", () => {
  test("mcp: false starts no server and registers nothing", async () => {
    const marker = join(scratchDir(), "started");
    const registry = createToolRegistry();
    const manager = createMcpManager({
      registry,
      mcp: false,
      servers: [
        {
          name: "never",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`],
          },
        },
      ],
    });
    assert.deepEqual(await manager.connect(), []);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(!existsSync(marker), "the server's command never ran");
    assert.equal(registry.list().length, 0);
    assert.equal(manager.connection("never"), undefined);
    await manager.close();
  });

  test("the same command with the switch on does run, so the check above can fail", async () => {
    const marker = join(scratchDir(), "started");
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [
        {
          name: "runs",
          connectTimeoutMs: 2000,
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`],
          },
        },
      ],
    });
    closers.push(() => manager.close());
    const [status] = await manager.connect();
    assert.equal(status?.status, "failed");
    assert.ok(existsSync(marker));
  });
});

describe("configs", () => {
  test("two servers with one name, in any letter case, are refused", () => {
    assert.throws(
      () =>
        createMcpManager({
          registry: createToolRegistry(),
          servers: [stdioServer("lib", "library", ["legacy"]), stdioServer("LIB", "library", ["legacy"])],
        }),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_mcp_config",
    );
  });

  for (const name of ["", "a_b", "has space", "x".repeat(33), "-lead", "mcp__x"]) {
    test(`the server name ${JSON.stringify(name)} is refused`, () => {
      assert.throws(
        () => createMcpManager({ registry: createToolRegistry(), servers: [stdioServer(name, "library", ["legacy"])] }),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_mcp_config",
      );
    });
  }
});

describe("a misbehaving server", () => {
  test("one that exits at start fails to connect, and the others still connect", async () => {
    const registry = createToolRegistry();
    const { statuses } = await connected(
      registry,
      stdioServer("dead", "raw", ["legacy", "exit-on-start"]),
      stdioServer("lib", "library", ["legacy"]),
    );
    const error = failure(statuses[0]);
    assert.ok(error instanceof McpError && error.code === "mcp_connect_failed", error?.message ?? "");
    assert.equal(statuses[1]?.status, "connected");
  });

  test("one that never finishes the handshake fails within its connect timeout and is killed", async () => {
    const started = Date.now();
    await assert.rejects(
      () => connectMcpServer(stdioServer("silent", "raw", ["legacy", "silent"], { connectTimeoutMs: 800 })),
      (error: unknown) => error instanceof McpError && error.code === "mcp_connect_failed",
    );
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
  });

  test("one that crashes mid-call fails the call as closed, with no hang", async () => {
    const connection = await connectMcpServer(stdioServer("lib", "library", ["legacy"]));
    closers.push(() => connection.close());
    await assert.rejects(
      () => connection.callTool("crash", {}, signal()),
      (error: unknown) => error instanceof McpError && error.failure === "closed",
    );
    assert.ok(await eventually(() => connection.closed));
    await assert.rejects(
      () => connection.callTool("echo", { text: "after" }, signal()),
      (error: unknown) => error instanceof McpError && error.failure === "closed",
    );
  });

  test("one that never answers a call times out within the request timeout", async () => {
    const connection = await connectMcpServer(stdioServer("lib", "library", ["legacy"], { requestTimeoutMs: 400 }));
    closers.push(() => connection.close());
    const started = Date.now();
    await assert.rejects(
      () => connection.callTool("hang", {}, signal()),
      (error: unknown) => error instanceof McpError && error.failure === "timeout",
    );
    assert.ok(Date.now() - started < 3000);
  });

  test("an aborted call fails as aborted", async () => {
    const connection = await connectMcpServer(stdioServer("lib", "library", ["legacy"]));
    closers.push(() => connection.close());
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop")), 100);
    await assert.rejects(
      () => connection.callTool("hang", {}, controller.signal),
      (error: unknown) => error instanceof McpError && error.failure === "aborted",
    );
  });

  test("its standard error is kept bounded and never reaches the result", async () => {
    const connection = await connectMcpServer(
      stdioServer("lib", "library", ["legacy"], { transport: { maxStderrBytes: 4 * KIB } }),
    );
    closers.push(() => connection.close());
    const result = await connection.callTool("noisy", {}, signal());
    assert.deepEqual(result.content, [{ type: "text", text: "done" }]);
    assert.ok(await eventually(() => connection.stderr().includes("last line of stderr")));
    assert.ok(connection.stderr().length <= 4 * KIB);
  });

  test("a line over maxLineBytes closes the connection and fails the call", async () => {
    const connection = await connectMcpServer(
      stdioServer("raw", "raw", ["legacy", "long-line"], { transport: { maxLineBytes: 1024 * KIB } }),
    );
    closers.push(() => connection.close());
    await assert.rejects(
      () => connection.callTool("echo", {}, signal()),
      (error: unknown) => error instanceof McpError && error.failure === "closed",
    );
    assert.ok(connection.closed);
  });

  test("lines that are not JSON objects are dropped, and the call still finishes", async () => {
    const logged: string[] = [];
    const connection = await connectMcpServer(stdioServer("raw", "raw", ["legacy", "garbage"]), {
      log: (line) => logged.push(line),
    });
    closers.push(() => connection.close());
    const result = await connection.callTool("echo", {}, signal());
    assert.deepEqual(result.content, [{ type: "text", text: "after the garbage" }]);
    assert.equal(logged.filter((line) => line.includes("not a JSON object")).length, 3);
  });

  test("content the model can't read becomes short notes", async () => {
    const connection = await connectMcpServer(stdioServer("raw", "raw", ["legacy", "mixed-content"]));
    closers.push(() => connection.close());
    const result = await connection.callTool("echo", {}, signal());
    assert.deepEqual(result.content, [
      { type: "text", text: "one" },
      { type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
      { type: "text", text: "[an image of type image/svg+xml was left out]" },
      { type: "text", text: "[a audio content block was left out]" },
      { type: "text", text: "resource text" },
      { type: "text", text: "[a link to the resource file:///b]" },
    ]);
  });
});

describe("closing", () => {
  test("ends the server process", async () => {
    const connection = await connectMcpServer(stdioServer("lib", "library", ["legacy"]));
    const [block] = (await connection.callTool("env", {}, signal())).content;
    const { pid } = JSON.parse(block?.type === "text" ? block.text : "{}") as { pid: number };
    assert.ok(alive(pid));
    await connection.close();
    assert.ok(!alive(pid));
    await connection.close();
  });

  test("kills a server that ignores its closed input and SIGTERM, within the grace periods", async () => {
    const connection = await connectMcpServer(
      stdioServer("stubborn", "raw", ["legacy", "ignore-term"], { transport: { closeGraceMs: 200 } }),
    );
    const started = Date.now();
    await connection.close();
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    assert.ok(connection.closed);
  });

  test("ends what the server started in its process group", async () => {
    const connection = await connectMcpServer(stdioServer("parent", "raw", ["legacy", "grandchild"]));
    const [block] = (await connection.callTool("echo", {}, signal())).content;
    const { pid, child } = JSON.parse(block?.type === "text" ? block.text : "{}") as { pid: number; child: number };
    assert.ok(alive(child));
    await connection.close();
    assert.ok(await eventually(() => !alive(pid) && !alive(child)), "the server and its child are gone");
  });

  test("the manager closes every server, and a tool of a closed server fails when called", async () => {
    const registry = createToolRegistry();
    const { manager } = await connected(registry, stdioServer("lib", "library", ["legacy"]));
    const connection = manager.connection("lib");
    const [block] = (await connection?.callTool("env", {}, signal()))?.content ?? [];
    const { pid } = JSON.parse(block?.type === "text" ? block.text : "{}") as { pid: number };
    await manager.close();
    assert.ok(!alive(pid));
    const { entries } = await runMcpTurn(registry, [callStep("c1", "mcp__lib__echo", { text: "late" }), doneStep]);
    const result = toolResults(entries).get("c1");
    assert.ok(result?.isError);
    assert.match(result.text, /connection closed/);
    await assert.rejects(() => manager.connect(), /was closed/);
  });
});

describe("the call log fixture", () => {
  test("reads what the server wrote", async () => {
    const log = callLog();
    const connection = await connectMcpServer(stdioServer("lib", "library", ["legacy", log.path]));
    closers.push(() => connection.close());
    await connection.callTool("echo", { text: "logged" }, signal());
    assert.deepEqual(log.read(), [{ tool: "echo", input: { text: "logged" } }]);
    assert.ok(readFileSync(log.path, "utf8").endsWith("\n"));
  });
});
